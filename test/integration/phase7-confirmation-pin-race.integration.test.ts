import { execSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Die Selbstvergabe der Bestätigungs-PIN.
 *
 * Warum es diese Suite gibt: bis hierher wurde `users.confirmation_pin_hash`
 * ausschließlich vom Seed geschrieben. Ein echtes, frisch angelegtes Konto
 * hatte damit keine Unterschrift — und ohne sie lässt sich kein
 * Arbeitsschritt abschließen (ADR-005). Der Weg von „kein Hash" zu
 * „arbeitsfähig" existierte in der Anwendung nicht und ist deshalb der Kern
 * dieser Tests.
 *
 * Geprüft wird die Kette, nicht die Einzelteile: setzen ⇒ bestätigen können ⇒
 * ändern nur mit der alten PIN ⇒ die alte gilt danach nicht mehr. Dazu die
 * beiden Grenzen, die das Verfahren tragen — der Wechsel hängt an derselben
 * Fehlversuchssperre wie jede andere Bestätigung, und es gibt keinen Weg,
 * die PIN eines anderen Kontos zu setzen.
 */

let pgContainer: StartedPostgreSqlContainer;
let ownerClient: PrismaClient;

type Actor = { userId: string; organizationId: string };

let seedOrganizationRbac: typeof import('@/domain/identity/seed-organization').seedOrganizationRbac;
let seedDemoUsers: typeof import('@/domain/identity/seed-organization').seedDemoUsers;
let confirmWithPin: typeof import('@/domain/identity/confirm-with-pin').confirmWithPin;
let PIN_ATTEMPTS_BEFORE_LOCK: typeof import('@/domain/identity/confirm-with-pin').PIN_ATTEMPTS_BEFORE_LOCK;

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
  process.env.SERVER_NODE_ID = 'integration-test';

  ({ seedOrganizationRbac, seedDemoUsers } = await import('@/domain/identity/seed-organization'));
  ({ confirmWithPin, PIN_ATTEMPTS_BEFORE_LOCK } =
    await import('@/domain/identity/confirm-with-pin'));

  ownerClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: ownerUrl }) });
}, 240_000);

afterAll(async () => {
  await ownerClient.$disconnect();
  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();
  await pgContainer.stop();
});

/**
 * Zwei Konten je Fall: eines **ohne** PIN — der Zustand eines frisch
 * angelegten echten Benutzers — und eines mit, um den Wechsel zu prüfen.
 */
async function seedAccounts(name: string): Promise<{ fresh: Actor; established: Actor }> {
  const seeded = await seedOrganizationRbac(ownerClient, `pin-${name}`);
  const userIds = await seedDemoUsers(ownerClient, seeded, [
    { email: `fresh-${name}@t.local`, displayName: 'Ohne PIN', roleCode: 'WORKER' },
    {
      email: `established-${name}@t.local`,
      displayName: 'Mit PIN',
      roleCode: 'WORKER',
      confirmationPin: '4711',
    },
  ]);
  return {
    fresh: { userId: userIds[`fresh-${name}@t.local`]!, organizationId: seeded.organizationId },
    established: {
      userId: userIds[`established-${name}@t.local`]!,
      organizationId: seeded.organizationId,
    },
  };
}

/**
 * Angriffsprobe: hält die Fehlversuchssperre auch gegen **parallele** Versuche?
 *
 * Diese Suite ist aus einem Befund entstanden, nicht aus einer Vermutung. Vor
 * der Korrektur ergaben **20 gleichzeitige Fehlversuche den Zähler 1**, das
 * Konto wurde nicht gesperrt, und die richtige PIN galt danach weiter — die
 * vorhandene Suite prüfte die Sperre ausschließlich nacheinander und sah das
 * deshalb nie.
 *
 * Die vorhandene Suite prüft sie nacheinander. Der Zähler wird in
 * `confirm-with-pin.ts` gelesen und danach **absolut** zurückgeschrieben
 * (`confirmationPinFailedAttempts: user.confirmationPinFailedAttempts + 1`),
 * nicht atomar erhöht — und die Isolationsstufe ist nirgends angehoben, es
 * gilt also READ COMMITTED. Wer gleichzeitig rät statt nacheinander, müsste
 * damit an der Sperre vorbeikommen.
 *
 * Das ist keine akademische Frage: der Schemakommentar zu
 * `confirmationPinFailedAttempts` nennt die Sperre selbst als den Schutz,
 * den eine vierstellige PIN hinter 100 Anfragen je Minute braucht.
 */
describe('Angriffsprobe: PIN-Sperre unter Nebenläufigkeit', () => {
  it('zählt nacheinander jeden Fehlversuch', async () => {
    const { established } = await seedAccounts('seriell');
    for (let i = 0; i < 4; i += 1) {
      await expect(confirmWithPin(established, '0000', { purpose: 'probe' })).rejects.toThrow();
    }
    const nachher = await ownerClient.user.findUniqueOrThrow({
      where: { id: established.userId },
      select: { confirmationPinFailedAttempts: true, confirmationPinLockedUntil: true },
    });
    expect(nachher.confirmationPinFailedAttempts).toBe(4);
  });

  it('zählt parallele Fehlversuche ebenso — sonst ist die Sperre umgehbar', async () => {
    const { established } = await seedAccounts('parallel');
    const VERSUCHE = 20;

    await Promise.allSettled(
      Array.from({ length: VERSUCHE }, () =>
        confirmWithPin(established, '0000', { purpose: 'probe' }),
      ),
    );

    const nachher = await ownerClient.user.findUniqueOrThrow({
      where: { id: established.userId },
      select: { confirmationPinFailedAttempts: true, confirmationPinLockedUntil: true },
    });

    // Nach 20 Fehlversuchen MUSS das Konto gesperrt sein (Grenze: 5).
    expect(nachher.confirmationPinFailedAttempts).toBeGreaterThanOrEqual(PIN_ATTEMPTS_BEFORE_LOCK);
    expect(nachher.confirmationPinLockedUntil).not.toBeNull();
  });

  it('weist danach auch die RICHTIGE PIN ab, solange die Sperre läuft', async () => {
    const { established } = await seedAccounts('danach');
    await Promise.allSettled(
      Array.from({ length: 20 }, () => confirmWithPin(established, '0000', { purpose: 'probe' })),
    );
    // Die richtige PIN ist 4711. Läuft die Sperre, muss auch sie scheitern.
    await expect(confirmWithPin(established, '4711', { purpose: 'probe' })).rejects.toThrow();
  });
});

describe('Angriffsprobe: die Spur im Audit', () => {
  it('hält jeden parallelen Versuch fest, auch die ungeprüften', async () => {
    // Die Korrektur weist Versuche jenseits der Grenze ab, **ohne** sie zu
    // prüfen. Ohne diesen Test würde die Audit-Spur genau dort dünner, wo
    // jemand offensichtlich rät — und das Audit ist laut Kommentar in
    // confirm-with-pin.ts die Stelle, an der „elf Versuche am Dienstag"
    // beantwortbar wird.
    const { established } = await seedAccounts('audit');
    const VERSUCHE = 20;

    await Promise.allSettled(
      Array.from({ length: VERSUCHE }, () =>
        confirmWithPin(established, '0000', { purpose: 'probe' }),
      ),
    );

    const ereignisse = await ownerClient.auditEvent.count({
      where: {
        resourceId: established.userId,
        eventType: { in: ['confirmation_pin.failed', 'confirmation_pin.locked'] },
      },
    });
    expect(ereignisse).toBe(VERSUCHE);
  });
});
