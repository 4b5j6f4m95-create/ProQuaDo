import { withOrgContext } from '@/lib/db/tenant-context';
import { writeAuditEvent } from '@/lib/audit/write-audit-event';
import { assertPermission } from '@/lib/authz/assert-permission';
import { NotFoundError, ValidationError } from '@/lib/domain-errors';
import type { Actor } from '@/domain/shared/actor';

/**
 * Benutzer einladen, Rollen zuweisen, eine vergessene PIN löschen.
 *
 * ## Einladen heißt: die Zeile schreiben, die der erste Login findet
 *
 * Ein Konto entsteht hier **nicht** fertig. Angelegt wird ein `users`-Satz mit
 * `external_id = 'pending:<E-Mail>'` — dem Sentinel, den `resolve_org_for_login`
 * beim ersten SSO-Login gegen die echte Subject-ID des Identitätsanbieters
 * tauscht (src/lib/auth/resolve-login.ts). Das ist der bestehende Mechanismus,
 * kein neuer: das System vergibt keine Passwörter und kennt keine, die
 * Anmeldung gehört dem Anbieter.
 *
 * Folge für den Betrieb: nach dem Einladen muss die Person sich **einmal
 * anmelden** und ihre Bestätigungs-PIN setzen, bevor sie arbeiten kann.
 *
 * ## Warum es kein Setzen einer PIN gibt, sondern nur ein Löschen
 *
 * Die PIN ist die Unterschrift. Wer sie für jemanden vergibt, kennt sie — und
 * ab da trägt die Zurechnung im Audit-Trail nicht mehr. `clearConfirmationPin`
 * nimmt deshalb die hinterlegte weg und **setzt keine**: das Konto steht
 * danach wie ein frisches da, und der Inhaber vergibt seine eigene neu
 * (set-confirmation-pin.ts). Das ist der vorgesehene Weg bei einer vergessenen
 * PIN, und der einzige.
 */

/**
 * Die Benutzerliste der Administration — mit Rollen und dem, was für die
 * Betreuung zählt: ob eine PIN hinterlegt ist und ob das Konto noch auf seinen
 * ersten Login wartet.
 *
 * Eigene Abfrage statt `listAssignableUsers`: die hängt an
 * `production_order.assign`, das die Administration nicht hat — und sie liefert
 * bewusst nur Name und E-Mail, weil sie eine Auswahlliste für die
 * Auftragszuweisung füllt und kein Verwaltungsbild.
 */
export async function listUsersForAdministration(actor: Actor) {
  await assertPermission(actor, 'user.manage');
  return withOrgContext(actor.organizationId, async (tx) => {
    const users = await tx.user.findMany({
      select: {
        id: true,
        email: true,
        displayName: true,
        externalId: true,
        isActive: true,
        confirmationPinHash: true,
        userRoles: { select: { role: { select: { code: true } }, expiresAt: true } },
        employee: { select: { employeeNumber: true } },
      },
      orderBy: { email: 'asc' },
    });

    // Der Hash verlässt die Funktion nicht — gefragt ist, OB eine PIN
    // hinterlegt ist, nicht welche.
    return users.map(({ confirmationPinHash, externalId, ...user }) => ({
      ...user,
      hasConfirmationPin: confirmationPinHash !== null,
      awaitingFirstLogin: externalId.startsWith('pending:'),
      roleCodes: user.userRoles.map((assignment) => assignment.role.code),
    }));
  });
}

export interface InviteUserCommand {
  actor: Actor;
  email: string;
  displayName: string;
  employeeNumber: string;
  roleCode: string;
  siteId?: string;
}

export async function inviteUser(command: InviteUserCommand) {
  await assertPermission(command.actor, 'user.manage');

  const email = command.email.trim().toLowerCase();
  const displayName = command.displayName.trim();
  const employeeNumber = command.employeeNumber.trim().toUpperCase();
  if (!email || !displayName || !employeeNumber) {
    throw new ValidationError('E-Mail, Anzeigename und Personalnummer sind erforderlich.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new ValidationError('Die E-Mail-Adresse ist nicht gültig.');
  }

  return withOrgContext(command.actor.organizationId, async (tx) => {
    const existingUser = await tx.user.findFirst({ where: { email } });
    if (existingUser) {
      throw new ValidationError(`Für ${email} existiert bereits ein Konto.`);
    }
    const existingEmployee = await tx.employee.findFirst({ where: { employeeNumber } });
    if (existingEmployee) {
      throw new ValidationError(`Die Personalnummer „${employeeNumber}" ist bereits vergeben.`);
    }

    const role = await tx.role.findFirst({ where: { code: command.roleCode } });
    if (!role) throw new NotFoundError(`Rolle ${command.roleCode}`);

    if (command.siteId) {
      const site = await tx.site.findFirst({ where: { id: command.siteId } });
      if (!site) throw new NotFoundError('Standort');
    }

    const user = await tx.user.create({
      data: {
        organizationId: command.actor.organizationId,
        externalId: `pending:${email}`,
        email,
        displayName,
      },
    });

    await tx.employee.create({
      data: {
        organizationId: command.actor.organizationId,
        userId: user.id,
        employeeNumber,
        siteId: command.siteId,
      },
    });

    await tx.userRole.create({
      data: {
        organizationId: command.actor.organizationId,
        userId: user.id,
        roleId: role.id,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'user.invited',
      resourceType: 'user',
      resourceId: user.id,
      actorId: command.actor.userId,
      newValues: { email, displayName, employeeNumber, roleCode: role.code },
      source: 'web',
    });

    return user;
  });
}

export interface AssignRoleCommand {
  actor: Actor;
  userId: string;
  roleCode: string;
  expiresAt?: Date;
}

export async function assignRole(command: AssignRoleCommand): Promise<void> {
  await assertPermission(command.actor, 'role.manage');

  await withOrgContext(command.actor.organizationId, async (tx) => {
    const user = await tx.user.findFirst({ where: { id: command.userId } });
    if (!user) throw new NotFoundError('Benutzer');

    const role = await tx.role.findFirst({ where: { code: command.roleCode } });
    if (!role) throw new NotFoundError(`Rolle ${command.roleCode}`);

    const existing = await tx.userRole.findFirst({
      where: { userId: user.id, roleId: role.id },
    });
    if (existing) {
      throw new ValidationError(`Diese Person hat die Rolle ${role.code} bereits.`);
    }

    await tx.userRole.create({
      data: {
        organizationId: command.actor.organizationId,
        userId: user.id,
        roleId: role.id,
        // Zeitlich begrenzte Zuweisungen gibt es im Modell seit Phase 1 und
        // die Berechtigungsprüfung wertet sie aus — hier wird sie erstmals
        // von außen erreichbar.
        expiresAt: command.expiresAt,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'user_role.assigned',
      resourceType: 'user',
      resourceId: user.id,
      actorId: command.actor.userId,
      newValues: { roleCode: role.code, expiresAt: command.expiresAt?.toISOString() ?? null },
      source: 'web',
    });
  });
}

export interface RevokeRoleCommand {
  actor: Actor;
  userId: string;
  roleCode: string;
}

export async function revokeRole(command: RevokeRoleCommand): Promise<void> {
  await assertPermission(command.actor, 'role.manage');

  await withOrgContext(command.actor.organizationId, async (tx) => {
    const role = await tx.role.findFirst({ where: { code: command.roleCode } });
    if (!role) throw new NotFoundError(`Rolle ${command.roleCode}`);

    const assignment = await tx.userRole.findFirst({
      where: { userId: command.userId, roleId: role.id },
    });
    if (!assignment) throw new NotFoundError('Rollenzuweisung');

    await tx.userRole.delete({ where: { id: assignment.id } });

    // Die Zuweisung wird gelöscht, das Ereignis bleibt — ohne den
    // Audit-Eintrag wäre nachher nicht mehr feststellbar, dass jemand die
    // Rolle je hatte, und damit auch nicht, wieso er etwas tun durfte.
    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'user_role.revoked',
      resourceType: 'user',
      resourceId: command.userId,
      actorId: command.actor.userId,
      previousValues: { roleCode: role.code },
      source: 'web',
    });
  });
}

export interface ClearConfirmationPinCommand {
  actor: Actor;
  userId: string;
  reason: string;
}

/**
 * Löscht die hinterlegte Bestätigungs-PIN eines Kontos — der Weg bei einer
 * vergessenen PIN.
 *
 * Es gibt bewusst kein Gegenstück, das eine PIN **setzt**: siehe oben. Nach
 * diesem Vorgang kann das Konto nichts bestätigen, bis sein Inhaber unter
 * „Mein Konto" eine neue vergeben hat — das ist der Preis dafür, dass die
 * Unterschrift niemandem sonst bekannt ist.
 */
export async function clearConfirmationPin(command: ClearConfirmationPinCommand): Promise<void> {
  await assertPermission(command.actor, 'user.manage');

  const reason = command.reason.trim();
  if (!reason) {
    throw new ValidationError('Für das Zurücksetzen einer PIN ist eine Begründung erforderlich.');
  }

  await withOrgContext(command.actor.organizationId, async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: command.userId },
      select: { id: true, email: true, confirmationPinHash: true },
    });
    if (!user) throw new NotFoundError('Benutzer');
    if (!user.confirmationPinHash) {
      throw new ValidationError('Für dieses Konto ist keine PIN hinterlegt.');
    }

    await tx.user.update({
      where: { id: user.id },
      data: {
        confirmationPinHash: null,
        confirmationPinFailedAttempts: 0,
        confirmationPinLockedUntil: null,
      },
    });

    await writeAuditEvent(tx, {
      organizationId: command.actor.organizationId,
      eventType: 'confirmation_pin.cleared',
      resourceType: 'user',
      resourceId: user.id,
      actorId: command.actor.userId,
      // Die Begründung gehört dazu: ein gelöschtes Bestätigungsmittel ist ein
      // Eingriff in die Zurechenbarkeit und muss beantwortbar bleiben.
      reason,
      source: 'web',
    });
  });
}
