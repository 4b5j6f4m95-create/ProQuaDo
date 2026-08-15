import { execSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

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

/**
 * Begrenzt Datenbank und Objektspeicher auf einen Bruchteil der CPU — für
 * die eine Frage, an der die Hochrechnung auf größere Hardware hängt:
 * **wächst der Durchsatz mit der Kernzahl?**
 *
 * **Warum das nicht mit `taskset` geht.** Der Engpass ist die Datenbank,
 * und die läuft in einem Container: ein `taskset` auf den Node-Prozess
 * beschränkt sie **nicht**. Gemessen wäre dann etwas, das wie ein
 * Ein-Kern-Lauf aussieht und keiner ist.
 *
 * `LOAD_CPU_QUOTA=1` gibt beiden Containern eine CPU, `=2` zwei; leer
 * bleibt alles wie bisher. Der Vergleich zweier Quoten isoliert die
 * Skalierung der **Datenbank** — der Node-Prozess bleibt in beiden Fällen
 * unbeschränkt, und genau das macht den Unterschied aussagekräftig: was
 * sich ändert, ist nur die Quote.
 *
 * Eine Quote ist keine Kernbindung. Sie begrenzt Rechenzeit, nicht
 * Parallelität — für „doppelt so viel Maschine" ist das die passendere
 * Nachbildung, weil eine größere Anlage ebenfalls mehr Zeit und nicht
 * andere Kerne bekommt.
 */
function cpuQuota(): number | undefined {
  const raw = process.env.LOAD_CPU_QUOTA;
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`LOAD_CPU_QUOTA muss eine positive Zahl sein, war: ${raw}`);
  }
  return value;
}

export async function startInfra(): Promise<LoadTestInfra> {
  const connectionLimit = Number(process.env.LOAD_DB_CONNECTION_LIMIT ?? 25);
  const quota = cpuQuota();

  let pgBuilder = new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('proquado')
    .withUsername('proquado')
    .withPassword('proquado_dev_only');
  if (quota !== undefined) pgBuilder = pgBuilder.withResourcesQuota({ cpu: quota });
  const pg = await pgBuilder.start();

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

  const minio = await startMinio(quota);

  // Seit Prisma 7 steuert nicht mehr die URL die Poolgröße, sondern der
  // Treiber-Adapter — siehe src/lib/db/client.ts. `connection_limit` bleibt
  // in der URL stehen, weil `prisma migrate` sie weiterhin liest; wirksam für
  // die Anwendung ist DATABASE_POOL_MAX.
  process.env.DATABASE_POOL_MAX = String(connectionLimit);
  process.env.DATABASE_URL = appUrl;
  process.env.DIRECT_DATABASE_URL = ownerUrl;
  process.env.RELEASE_TOKEN_SECRET = 'load-test-release-token-secret';
  process.env.SERVER_NODE_ID = 'load-test';
  process.env.MALWARE_SCANNER = 'stub';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';

  const ownerClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl }) });

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

async function startMinio(quota?: number): Promise<StartedTestContainer> {
  let builder = new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({ MINIO_ROOT_USER: 'loaduser', MINIO_ROOT_PASSWORD: 'loadpassword' })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000));
  if (quota !== undefined) builder = builder.withResourcesQuota({ cpu: quota });
  const container = await builder.start();

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
