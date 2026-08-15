import type { Prisma } from '@prisma/client';
import { withOrgContext } from '@/lib/db/tenant-context';
import { allow, deny, type Decision } from './decision';
import type { PermissionCode } from '@/domain/identity/permissions-catalog';

export interface AuthzCheck {
  userId: string;
  organizationId: string;
  action: PermissionCode;
  /** Qualification code required for this specific action, if any (ABAC). */
  requiredQualification?: string;
  /** Execution time to check qualification validity against — defaults to
   *  now. Pass the actual execution timestamp when validating a completion
   *  that happened earlier, per docs/04 "Qualifikationen und Gültigkeit". */
  atTimestamp?: Date;
}

/**
 * Serverside RBAC + ABAC authorization check. This is the ONLY function
 * that may answer "is this action allowed" — no route handler or domain
 * service should inline a permission check. See docs/04_ROLES_PERMISSIONS_MATRIX.md.
 *
 * Organization boundary is enforced twice: once implicitly by withOrgContext
 * (RLS makes cross-org rows invisible) and once explicitly by requiring the
 * caller to pass organizationId matching the session — defense in depth
 * matching ADR-006.
 */
export async function can(check: AuthzCheck): Promise<Decision> {
  return withOrgContext(check.organizationId, async (tx) => {
    const hasPermission = await userHasPermission(
      tx,
      check.userId,
      check.organizationId,
      check.action,
    );
    if (!hasPermission) {
      return deny('PERMISSION_DENIED');
    }

    if (check.requiredQualification) {
      const qualified = await isCurrentlyQualified(
        tx,
        check.userId,
        check.requiredQualification,
        check.atTimestamp ?? new Date(),
      );
      if (!qualified) {
        return deny('NOT_QUALIFIED');
      }
    }

    return allow();
  });
}

/**
 * Alle Berechtigungsatome einer Person auf einmal — für Oberflächen, die
 * über **viele** Ziele gleichzeitig entscheiden müssen.
 *
 * **Warum das hier steht und nicht in der Navigation.** Der Kopfkommentar
 * oben sagt, `can()` sei die einzige Stelle, die „darf das jemand"
 * beantwortet. Eine Menüleiste, die sich ihre Antwort selbst
 * zusammensucht, wäre ein zweiter Pfad — und zwei Pfade driften. Deshalb
 * dieselbe Datei, dieselbe Bedingung: dieselbe `userRole`-Abfrage mit
 * demselben Ablaufdatum, nur ohne Filter auf ein einzelnes Atom.
 *
 * **Warum überhaupt eine Sammelabfrage.** Zehn Menüpunkte einzeln zu
 * prüfen hieße zehn `withOrgContext`-Transaktionen bei **jedem**
 * Seitenaufruf. Der Sync-Durchsatz ist der einzige Zielwert aus docs/09,
 * der ohne Reserve besteht; eine Leiste, die zehn Abfragen kostet, ist
 * nichts, was man nebenbei einführt.
 *
 * **Qualifikationen bleiben außen vor.** `can()` prüft zusätzlich, ob eine
 * Person aktuell qualifiziert ist (ABAC). Das hängt am Zeitpunkt der
 * Ausführung und lässt sich nicht vorab für ein Menü beantworten — wer ein
 * Ziel sieht, hat damit die Berechtigung, nicht die Erlaubnis für jede
 * Handlung dahinter. Die Bildschirme dahinter prüfen weiterhin selbst.
 */
export async function listPermissions(
  userId: string,
  organizationId: string,
): Promise<Set<PermissionCode>> {
  return withOrgContext(organizationId, async (tx) => {
    const now = new Date();
    const grants = await tx.userRole.findMany({
      where: {
        userId,
        organizationId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: {
        role: {
          select: { rolePermissions: { select: { permission: { select: { code: true } } } } },
        },
      },
    });
    const codes = new Set<PermissionCode>();
    for (const grant of grants) {
      for (const rolePermission of grant.role.rolePermissions) {
        codes.add(rolePermission.permission.code as PermissionCode);
      }
    }
    return codes;
  });
}

async function userHasPermission(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string,
  action: PermissionCode,
): Promise<boolean> {
  const now = new Date();
  const grant = await tx.userRole.findFirst({
    where: {
      userId,
      organizationId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      role: {
        rolePermissions: {
          some: { permission: { code: action } },
        },
      },
    },
    select: { id: true },
  });
  return grant !== null;
}

async function isCurrentlyQualified(
  tx: Prisma.TransactionClient,
  userId: string,
  qualificationCode: string,
  atTimestamp: Date,
): Promise<boolean> {
  const record = await tx.employeeQualification.findFirst({
    where: {
      employee: { userId },
      qualification: { code: qualificationCode },
      certifiedAt: { lte: atTimestamp },
      OR: [{ expiresAt: null }, { expiresAt: { gt: atTimestamp } }],
    },
    select: { id: true },
  });
  return record !== null;
}
