import type { Prisma } from '@prisma/client';
import { prisma } from './client';

/**
 * Every business-data query MUST go through this function. It opens a
 * transaction, sets the PostgreSQL session variable `app.current_org_id`
 * via `SET LOCAL` (scoped to this transaction only — never leaks to other
 * requests sharing the same pooled connection), and runs the callback with
 * a transaction client that Row-Level Security policies enforce against.
 *
 * Without this call, RLS policies see `current_org_id` as NULL and every
 * policy evaluates to false — the app role gets zero rows, not a leak. See
 * prisma/migrations/20260808151300_rls_and_audit_hardening and ADR-006.
 */
export async function withOrgContext<T>(
  organizationId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!isValidUuid(organizationId)) {
    throw new Error(`withOrgContext: invalid organizationId "${organizationId}"`);
  }

  return prisma.$transaction(async (tx) => {
    // set_config(..., true) is the parameterized equivalent of `SET LOCAL`,
    // scoped to the current transaction and safe against injection.
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
    return fn(tx);
  });
}

// NOTE on the "which org does this user belong to" bootstrap problem: the
// `prisma` client always connects as `proquado_app`, which never bypasses
// RLS (it is not the table owner) — so there is deliberately no "unsafe"
// escape hatch here. Resolving a user's organization right after an OIDC
// callback, before any org context exists, is solved in src/lib/auth via a
// narrow SECURITY DEFINER SQL function that returns only an organization_id
// for a given external_id — never a full row. See src/lib/auth for details.

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
