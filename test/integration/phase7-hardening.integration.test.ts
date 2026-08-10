import { execSync } from 'node:child_process';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Phase 7 hardening — the two controls that cannot be proved by unit tests
 * because both are about a real external dependency being real.
 *
 * 1. **The malware scanner actually scans.** The unit tests prove the
 *    selection rules and that an unreachable clamd fails closed. Neither of
 *    them proves that the INSTREAM implementation speaks a protocol clamd
 *    understands — for that, a clamd has to answer. This is the check to point
 *    at the pilot environment before the first upload happens there:
 *
 *      docker compose up -d clamav      # wait for "healthy"
 *      CLAMAV_HOST=… CLAMAV_PORT=… pnpm run test:integration -- phase7-hardening
 *
 *    Gated on `CLAMAV_TESTS=1` rather than on probing whether clamd answers.
 *    Probing looks friendlier and is worse: "skip when the dependency is
 *    missing" and "skip when the dependency is broken" are the same branch, so
 *    the one run that should have gone red is the one that quietly goes green.
 *    Opting in is an assertion that clamd ought to be there — and if it is
 *    not, these tests fail, which is the point.
 *
 * 2. **The shared rate-limit store is actually shared.** The property that
 *    matters is the one process-local counting does not have: two application
 *    instances must count against the same budget. Two store objects against
 *    one database is that situation, reduced to what it actually is.
 */

const CLAMAV_HOST = process.env.CLAMAV_HOST ?? '127.0.0.1';
const CLAMAV_PORT = Number(process.env.CLAMAV_PORT ?? 3310);
/** Read at module load, because that is when Jest decides what to run — a
 *  value computed in beforeAll arrives after the decision has been made. */
const CLAMAV_TESTS = process.env.CLAMAV_TESTS === '1';

/**
 * The EICAR anti-malware test file — a harmless string every scanner is
 * required to report as a signature match, by agreement rather than because it
 * does anything. Assembled from pieces so that a scanner running over this
 * repository does not quarantine the test that uses it.
 */
const EICAR = ['X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-', 'ANTIVIRUS-TEST-FILE!$H+H*'].join(
  '',
);

let pgContainer: StartedPostgreSqlContainer;
let minioContainer: StartedTestContainer;
let ownerClient: PrismaClient;
let s3: S3Client;
let ClamAvScanner: typeof import('@/lib/storage/malware-scan').ClamAvScanner;
let PostgresRateLimitStore: typeof import('@/lib/api/rate-limit').PostgresRateLimitStore;

const BUCKET = 'test-hardening';

beforeAll(async () => {
  pgContainer = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('proquado')
    .withUsername('proquado')
    .withPassword('proquado_dev_only')
    .start();

  const host = pgContainer.getHost();
  const port = pgContainer.getPort();
  const ownerUrl = `postgresql://proquado:proquado_dev_only@${host}:${port}/proquado?schema=public`;
  const appUrl = `postgresql://proquado_app:proquado_app_dev_only@${host}:${port}/proquado?schema=public`;

  execSync('pnpm exec prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: appUrl, DIRECT_DATABASE_URL: ownerUrl },
    stdio: 'pipe',
  });

  process.env.DATABASE_URL = appUrl;
  process.env.DIRECT_DATABASE_URL = ownerUrl;

  minioContainer = await new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({ MINIO_ROOT_USER: 'testuser', MINIO_ROOT_PASSWORD: 'testpassword' })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
    .start();

  const minioEndpoint = `http://${minioContainer.getHost()}:${minioContainer.getMappedPort(9000)}`;
  process.env.S3_ENDPOINT = minioEndpoint;
  process.env.S3_REGION = 'us-east-1';
  process.env.S3_BUCKET = BUCKET;
  process.env.S3_ACCESS_KEY_ID = 'testuser';
  process.env.S3_SECRET_ACCESS_KEY = 'testpassword';
  process.env.S3_FORCE_PATH_STYLE = 'true';
  process.env.MALWARE_SCANNER = 'stub';

  s3 = new S3Client({
    endpoint: minioEndpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'testuser', secretAccessKey: 'testpassword' },
  });
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));

  ({ ClamAvScanner } = await import('@/lib/storage/malware-scan'));
  ({ PostgresRateLimitStore } = await import('@/lib/api/rate-limit'));

  ownerClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl }) });
}, 240_000);

afterAll(async () => {
  await ownerClient?.$disconnect();
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();
  await minioContainer?.stop();
  await pgContainer?.stop();
});

async function putObject(key: string, body: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body }));
}

// ─────────────────────────────────────────────────────────────

const describeClamav = CLAMAV_TESTS ? describe : describe.skip;

describeClamav('Malware-Scan gegen echtes clamd', () => {
  it('answers the PING that /api/health/ready uses', async () => {
    const scanner = new ClamAvScanner(CLAMAV_HOST, CLAMAV_PORT, 10_000);
    await expect(scanner.ping()).resolves.toBe(true);
  }, 60_000);

  it('reports a harmless file as CLEAN', async () => {
    await putObject('hardening/sauber.txt', 'Ein ganz gewöhnlicher Prüfbericht.');
    const scanner = new ClamAvScanner(CLAMAV_HOST, CLAMAV_PORT, 30_000);
    await expect(scanner.scan('hardening/sauber.txt')).resolves.toBe('CLEAN');
  }, 120_000);

  it('reports the EICAR test file as INFECTED', async () => {
    // The one assertion that proves the INSTREAM framing is right. A broken
    // implementation reports ERROR here, which callers also refuse — so the
    // upload would be blocked either way and the bug would stay invisible
    // until a real infected file was waved through by a scanner that had
    // never actually been asked.
    await putObject('hardening/eicar.txt', EICAR);
    const scanner = new ClamAvScanner(CLAMAV_HOST, CLAMAV_PORT, 30_000);
    await expect(scanner.scan('hardening/eicar.txt')).resolves.toBe('INFECTED');
  }, 120_000);
});

describe('Gemeinsamer Rate-Limit-Speicher', () => {
  const RULE = { limit: 3, windowMs: 60_000, subject: 'user' as const };

  it('counts two application instances against one budget', async () => {
    // Two store objects, one database — the situation the in-memory store
    // cannot represent, and the entire reason this class exists. With
    // process-local counting both instances would answer "allowed" six times.
    const instanceA = new PostgresRateLimitStore();
    const instanceB = new PostgresRateLimitStore();
    const key = `SHARED:${Date.now()}-${Math.round(process.hrtime()[1])}`;
    const now = 1_000_000;

    expect((await instanceA.hit(key, RULE, now)).allowed).toBe(true);
    expect((await instanceB.hit(key, RULE, now)).allowed).toBe(true);
    expect((await instanceA.hit(key, RULE, now)).allowed).toBe(true);

    // Fourth hit against a limit of three, no matter which instance serves it.
    expect((await instanceB.hit(key, RULE, now)).allowed).toBe(false);
    expect((await instanceA.hit(key, RULE, now)).allowed).toBe(false);
  }, 60_000);

  it('rolls the window over instead of blocking forever', async () => {
    const store = new PostgresRateLimitStore();
    const key = `ROLLOVER:${Date.now()}`;
    const now = 2_000_000;

    for (let i = 0; i < RULE.limit; i++) {
      expect((await store.hit(key, RULE, now)).allowed).toBe(true);
    }
    const blocked = await store.hit(key, RULE, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    expect((await store.hit(key, RULE, now + RULE.windowMs + 1)).allowed).toBe(true);
  }, 60_000);

  it('stores no identifier that could be read back', async () => {
    const store = new PostgresRateLimitStore();
    const key = `STANDARD_API:${'b7f1d0c2-0000-4000-8000-000000000001'}`;
    await store.hit(key, RULE, 3_000_000);

    // The table sits outside RLS by necessity (it is consulted before any org
    // context exists), so it must not double as a cross-tenant list of who is
    // currently active. The stored key is a hash, not the id.
    const rows = await ownerClient.$queryRaw<Array<{ key: string }>>`
      SELECT key FROM rate_limit_windows
    `;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.key.includes('b7f1d0c2'))).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.key))).toBe(true);
  }, 60_000);
});
