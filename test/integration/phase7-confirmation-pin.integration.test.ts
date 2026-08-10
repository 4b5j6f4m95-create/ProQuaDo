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
let setConfirmationPin: typeof import('@/domain/identity/set-confirmation-pin').setConfirmationPin;
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
  ({ setConfirmationPin } = await import('@/domain/identity/set-confirmation-pin'));
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

async function pinHashOf(userId: string): Promise<string | null> {
  const user = await ownerClient.user.findUniqueOrThrow({
    where: { id: userId },
    select: { confirmationPinHash: true },
  });
  return user.confirmationPinHash;
}

describe('Erstvergabe', () => {
  it('macht ein Konto ohne PIN arbeitsfähig', async () => {
    const { fresh } = await seedAccounts('first');

    // Ausgangszustand: keine Unterschrift, also keine Bestätigung möglich.
    expect(await pinHashOf(fresh.userId)).toBeNull();
    await expect(confirmWithPin(fresh, '4071', { purpose: 'test' })).rejects.toMatchObject({
      code: 'CONFIRMATION_FAILED',
    });

    const result = await setConfirmationPin({ actor: fresh, newPin: '4071' });
    expect(result.wasFirstTime).toBe(true);

    // Der eigentliche Punkt: danach trägt die Unterschrift.
    await expect(confirmWithPin(fresh, '4071', { purpose: 'test' })).resolves.toBeUndefined();
  });

  it('verlangt beim ersten Mal keine bisherige PIN', async () => {
    const { fresh } = await seedAccounts('first-no-current');
    await expect(setConfirmationPin({ actor: fresh, newPin: '8305' })).resolves.toMatchObject({
      wasFirstTime: true,
    });
  });

  it('schreibt ein Audit-Ereignis, aber nie die PIN', async () => {
    const { fresh } = await seedAccounts('first-audit');
    await setConfirmationPin({ actor: fresh, newPin: '9042' });

    const events = await ownerClient.auditEvent.findMany({
      where: { resourceId: fresh.userId, eventType: { startsWith: 'confirmation_pin.' } },
      select: { eventType: true, newValues: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.eventType).toBe('confirmation_pin.set');
    expect(JSON.stringify(events[0]!.newValues)).not.toContain('9042');
  });

  it('weist eine PIN zurück, die die Regel nicht erfüllt', async () => {
    const { fresh } = await seedAccounts('first-policy');
    await expect(setConfirmationPin({ actor: fresh, newPin: '1234' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    // Und hinterlässt dabei nichts.
    expect(await pinHashOf(fresh.userId)).toBeNull();
  });
});

describe('Wechsel', () => {
  it('verlangt die bisherige PIN und ersetzt sie danach', async () => {
    const { established } = await seedAccounts('change');

    await expect(setConfirmationPin({ actor: established, newPin: '5566' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });

    const result = await setConfirmationPin({
      actor: established,
      newPin: '5566',
      currentPin: '4711',
    });
    expect(result.wasFirstTime).toBe(false);

    await expect(confirmWithPin(established, '5566', { purpose: 'test' })).resolves.toBeUndefined();
    // Die alte Unterschrift gilt nicht mehr — sonst hätte ein Wechsel nach
    // einem Verdacht auf Kenntnisnahme keinen Wert.
    await expect(confirmWithPin(established, '4711', { purpose: 'test' })).rejects.toMatchObject({
      code: 'CONFIRMATION_FAILED',
    });
  });

  it('zählt eine falsche bisherige PIN als Fehlversuch und sperrt schließlich', async () => {
    const { established } = await seedAccounts('change-lock');

    for (let attempt = 1; attempt < PIN_ATTEMPTS_BEFORE_LOCK; attempt += 1) {
      await expect(
        setConfirmationPin({ actor: established, newPin: '5566', currentPin: '0000' }),
      ).rejects.toMatchObject({ code: 'CONFIRMATION_FAILED' });
    }

    // Der fünfte Fehlversuch sperrt — der Wechsel hängt an derselben Sperre
    // wie jede andere Bestätigung, weil er über confirmWithPin geht und
    // nicht über eine zweite Prüfung.
    await expect(
      setConfirmationPin({ actor: established, newPin: '5566', currentPin: '0000' }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_LOCKED' });

    // Und die richtige PIN kommt währenddessen ebenfalls nicht durch.
    await expect(
      setConfirmationPin({ actor: established, newPin: '5566', currentPin: '4711' }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_LOCKED' });

    expect(await pinHashOf(established.userId)).not.toBeNull();
  });

  it('setzt den Fehlversuchszähler nach einem erfolgreichen Wechsel zurück', async () => {
    const { established } = await seedAccounts('change-reset');

    await expect(
      setConfirmationPin({ actor: established, newPin: '5566', currentPin: '0000' }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_FAILED' });

    await setConfirmationPin({ actor: established, newPin: '5566', currentPin: '4711' });

    const user = await ownerClient.user.findUniqueOrThrow({
      where: { id: established.userId },
      select: { confirmationPinFailedAttempts: true, confirmationPinLockedUntil: true },
    });
    expect(user.confirmationPinFailedAttempts).toBe(0);
    expect(user.confirmationPinLockedUntil).toBeNull();
  });
});

describe('Fremde Konten', () => {
  it('kennt keinen Weg, die PIN eines anderen zu setzen', async () => {
    const { fresh, established } = await seedAccounts('foreign');

    // Der Befehl nimmt keine Benutzerkennung entgegen — geschrieben wird
    // ausschließlich für actor.userId. Dass das so bleibt, hält dieser Test
    // fest: wer hier ein `userId`-Feld ergänzt, muss diese Zeile ändern und
    // dabei erklären, warum.
    await setConfirmationPin({ actor: fresh, newPin: '7788' });

    expect(await pinHashOf(fresh.userId)).not.toBeNull();
    // Das zweite Konto blieb unberührt: seine ursprüngliche PIN trägt noch.
    await expect(confirmWithPin(established, '4711', { purpose: 'test' })).resolves.toBeUndefined();
  });
});
