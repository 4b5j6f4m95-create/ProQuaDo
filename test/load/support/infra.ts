import { execSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';

/**
 * Infrastruktur für den Lasttest (docs/09 Ebene 8) — echtes Postgres, echtes
 * MinIO, echte Migrationen, wie in den Integrationstests.
 *
 * **Was hier gemessen wird und was nicht.** Der Harness ruft die
 * Domänendienste direkt auf, nicht die HTTP-API. Gemessen wird damit die
 * Arbeit, die der Server tatsächlich leistet: Transaktionen, RLS,
 * Berechtigungsprüfungen, Audit- und Outbox-Schreibvorgänge, PDF- und
 * ZIP-Erzeugung. **Nicht** gemessen werden HTTP, TLS, Next.js und der
 * Netzweg. Das ist eine bewusste Grenze und keine Bequemlichkeit: die API
 * hängt an NextAuth-Sitzungscookies, ein Lastwerkzeug bräuchte also für 200
 * Geräte 200 echte Anmeldungen über Keycloak — und gemessen würde am Ende
 * überwiegend die Anmeldung. Wo der Engpass dieses Systems zu erwarten ist,
 * sagt docs/06 selbst: die Serialisierung der Outbox je Organisation
 * (`sync_sequences`). Die sitzt in der Datenbank, nicht im Netz.
 *
 * Die Verbindungsobergrenze steht ausdrücklich in der URL, weil sie den p95
 * bei 200 gleichzeitigen Geräten stärker bestimmt als alles andere im Code —
 * eine Zahl, die man beim Lesen der Messwerte kennen muss.
 */

export interface LoadTestInfra {
  ownerClient: PrismaClient;
  connectionLimit: number;
  stop(): Promise<void>;
}

export async function startInfra(): Promise<LoadTestInfra> {
  const connectionLimit = Number(process.env.LOAD_DB_CONNECTION_LIMIT ?? 25);

  const pg = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('proquado')
    .withUsername('proquado')
    .withPassword('proquado_dev_only')
    .start();

  const host = pg.getHost();
  const port = pg.getPort();
  const ownerUrl = `postgresql://proquado:proquado_dev_only@${host}:${port}/proquado?schema=public`;
  const appUrl =
    `postgresql://proquado_app:proquado_app_dev_only@${host}:${port}/proquado?schema=public` +
    `&connection_limit=${connectionLimit}`;

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: appUrl, DIRECT_DATABASE_URL: ownerUrl },
    stdio: 'pipe',
  });

  const minio = await startMinio();

  process.env.DATABASE_URL = appUrl;
  process.env.DIRECT_DATABASE_URL = ownerUrl;
  process.env.RELEASE_TOKEN_SECRET = 'load-test-release-token-secret';
  process.env.SERVER_NODE_ID = 'load-test';
  process.env.MALWARE_SCANNER = 'stub';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';

  const ownerClient = new PrismaClient({ datasources: { db: { url: ownerUrl } } });

  return {
    ownerClient,
    connectionLimit,
    async stop() {
      await ownerClient.$disconnect();
      const { prisma } = await import('@/lib/db/client');
      await prisma.$disconnect();
      await pg.stop();
      await minio.stop();
    },
  };
}

async function startMinio(): Promise<StartedTestContainer> {
  const container = await new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({ MINIO_ROOT_USER: 'loaduser', MINIO_ROOT_PASSWORD: 'loadpassword' })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
    .start();

  const endpoint = `http://${container.getHost()}:${container.getMappedPort(9000)}`;
  process.env.S3_ENDPOINT = endpoint;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_BUCKET = 'load-test-evidence';
  process.env.S3_ACCESS_KEY_ID = 'loaduser';
  process.env.S3_SECRET_ACCESS_KEY = 'loadpassword';
  process.env.S3_FORCE_PATH_STYLE = 'true';

  const s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'loaduser', secretAccessKey: 'loadpassword' },
  });
  await s3.send(new CreateBucketCommand({ Bucket: 'load-test-evidence' }));

  return container;
}

/** Postgres-Container werden von Testcontainers gestartet; ohne laufenden
 *  Docker-Daemon ist die Fehlermeldung sonst wenig hilfreich. */
export function assertDockerAvailable(): void {
  try {
    execSync('docker info', { stdio: 'pipe' });
  } catch {
    throw new Error(
      'Docker antwortet nicht. Der Lasttest startet Postgres und MinIO über Testcontainers.',
    );
  }
}
