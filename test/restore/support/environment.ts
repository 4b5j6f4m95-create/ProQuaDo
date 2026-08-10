import { execFileSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import {
  S3Client,
  CreateBucketCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

/**
 * Zwei vollständig getrennte Umgebungen für die Restore-Probe (docs/09 Ebene
 * 10): die **Quelle**, in der Daten entstehen, und das **Ziel**, in das
 * zurückgesichert wird. Getrennte Container, getrennte Buckets, getrennte
 * Anmeldedaten.
 *
 * Die Trennung ist der Kern der Übung. Ein Restore, der in dieselbe Datenbank
 * zurückschreibt, prüft, ob ein Dump lesbar ist — nicht, ob aus Backup allein
 * ein arbeitsfähiges System entsteht. Genau das ist aber die Frage, die man am
 * Tag des Ausfalls stellt.
 */

export interface Environment {
  name: string;
  /** Verbindung der schemabesitzenden Rolle. */
  ownerUrl: string;
  /** Verbindung der Anwendungsrolle — mit ihr läuft die Anwendung. */
  appUrl: string;
  containerId: string;
  s3: { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string };
  owner: PrismaClient;
  stop(): Promise<void>;
}

export async function startEnvironment(
  name: string,
  options: { applyMigrations: boolean },
): Promise<Environment> {
  const pg = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('proquado')
    .withUsername('proquado')
    .withPassword('proquado_dev_only')
    .start();

  const host = pg.getHost();
  const port = pg.getPort();
  const ownerUrl = `postgresql://proquado:proquado_dev_only@${host}:${port}/proquado?schema=public`;
  const appUrl = `postgresql://proquado_app:proquado_app_dev_only@${host}:${port}/proquado?schema=public`;

  if (options.applyMigrations) {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: appUrl, DIRECT_DATABASE_URL: ownerUrl },
      stdio: 'pipe',
    });
  }

  const minio = await new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({ MINIO_ROOT_USER: `${name}user`, MINIO_ROOT_PASSWORD: `${name}password` })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
    .start();

  const s3 = {
    endpoint: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
    bucket: `${name}-evidence`,
    accessKeyId: `${name}user`,
    secretAccessKey: `${name}password`,
  };
  await client(s3).send(new CreateBucketCommand({ Bucket: s3.bucket }));

  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

  return {
    name,
    ownerUrl,
    appUrl,
    containerId: pg.getId(),
    s3,
    owner,
    async stop() {
      await owner.$disconnect();
      await pg.stop();
      await minio.stop();
    },
  };
}

function client(s3: Environment['s3']): S3Client {
  return new S3Client({
    endpoint: s3.endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
  });
}

/** Setzt die Umgebungsvariablen, mit denen die Anwendung gegen diese Umgebung
 *  läuft — für Kindprozesse, die eine Akte auslesen. */
export function envFor(environment: Environment): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DATABASE_URL: environment.appUrl,
    DIRECT_DATABASE_URL: environment.ownerUrl,
    S3_ENDPOINT: environment.s3.endpoint,
    S3_REGION: 'us-east-1',
    S3_BUCKET: environment.s3.bucket,
    S3_ACCESS_KEY_ID: environment.s3.accessKeyId,
    S3_SECRET_ACCESS_KEY: environment.s3.secretAccessKey,
    S3_FORCE_PATH_STYLE: 'true',
    MALWARE_SCANNER: 'stub',
    RELEASE_TOKEN_SECRET: 'restore-drill-release-token-secret',
    SERVER_NODE_ID: `restore-${environment.name}`,
    LOG_LEVEL: 'error',
  };
}

/** Alle Objektschlüssel eines Buckets. */
export async function listObjects(environment: Environment): Promise<string[]> {
  const s3 = client(environment.s3);
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: environment.s3.bucket, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    token = page.NextContinuationToken;
  } while (token);
  return keys.sort();
}

export async function readObject(environment: Environment, key: string): Promise<Buffer> {
  const response = await client(environment.s3).send(
    new GetObjectCommand({ Bucket: environment.s3.bucket, Key: key }),
  );
  const chunks: Buffer[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteObject(environment: Environment, key: string): Promise<void> {
  await client(environment.s3).send(
    new DeleteObjectCommand({ Bucket: environment.s3.bucket, Key: key }),
  );
}

export async function writeObject(
  environment: Environment,
  key: string,
  body: Buffer,
): Promise<void> {
  await client(environment.s3).send(
    new PutObjectCommand({ Bucket: environment.s3.bucket, Key: key, Body: body }),
  );
}
