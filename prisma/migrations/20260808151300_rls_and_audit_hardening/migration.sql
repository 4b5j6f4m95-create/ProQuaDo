-- ADR-004 (Audit-Härtung) + ADR-006 (Mandantenmodell: Row-Level Multi-Tenancy)
--
-- This migration must run as the database OWNER role (see DIRECT_DATABASE_URL).
-- It creates a separate, least-privileged role for the running application
-- (proquado_app) and enables PostgreSQL Row-Level Security so that even a bug
-- in the application layer cannot leak data across organizations or mutate
-- append-only audit rows. Table owners bypass RLS by default, so migrations
-- and Prisma Studio (run as the owner role) are unaffected.

-- ─────────────────────────────────────────────────────────────
-- 1. Least-privileged application role
-- ─────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'proquado_app') THEN
    CREATE ROLE proquado_app LOGIN PASSWORD 'proquado_app_dev_only';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE proquado TO proquado_app;
GRANT USAGE ON SCHEMA public TO proquado_app;

-- Default: full CRUD on business tables (fine-grained restriction happens
-- via RLS policies below, not via table-level grants, except for the
-- append-only tables which are restricted at the grant level too).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  organizations, sites, departments, work_centers,
  users, devices, sessions, employees,
  roles, permissions, user_roles, role_permissions,
  qualifications, employee_qualifications, delegations
TO proquado_app;

-- audit_events is append-only for the application role: INSERT + SELECT only.
-- No UPDATE, no DELETE — enforced at the grant level (ADR-004, layer 1).
GRANT SELECT, INSERT ON audit_events TO proquado_app;

-- outbox_events: application may insert new events and mark them processed,
-- but never delete (retained for replay/debugging; cleanup is a separate
-- ops job running as the owner role, not the app role).
GRANT SELECT, INSERT, UPDATE ON outbox_events TO proquado_app;

-- Future tables created by later migrations are NOT automatically granted —
-- each new organization-scoped table must be added here explicitly. This is
-- intentional friction: it forces a conscious decision about RLS policy and
-- audit-append-only status for every new table (see ADR-006 "Konsequenzen").

-- ─────────────────────────────────────────────────────────────
-- 2. Row-Level Security: audit_events append-only (ADR-004, layer 2)
-- ─────────────────────────────────────────────────────────────

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_events_select ON audit_events
  FOR SELECT
  USING (organization_id = current_setting('app.current_org_id', true));

CREATE POLICY audit_events_insert ON audit_events
  FOR INSERT
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));

-- Defense in depth: explicit deny-all policies for UPDATE/DELETE. Redundant
-- with the missing GRANT above, but survives a future accidental GRANT.
CREATE POLICY audit_events_no_update ON audit_events
  FOR UPDATE
  USING (false);

CREATE POLICY audit_events_no_delete ON audit_events
  FOR DELETE
  USING (false);

-- ─────────────────────────────────────────────────────────────
-- 3. Row-Level Security: tenant isolation (ADR-006)
-- ─────────────────────────────────────────────────────────────
-- Every request handler sets `app.current_org_id` via `SET LOCAL` at the
-- start of its database transaction (see src/lib/db/tenant-context.ts).
-- If it is not set, current_setting(..., true) returns NULL and every
-- policy below evaluates to false — i.e. fail closed, not fail open.

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_isolation ON organizations
  USING (id = current_setting('app.current_org_id', true))
  WITH CHECK (id = current_setting('app.current_org_id', true));

-- Reusable pattern for all remaining organization_id-scoped tables.
DO $$
DECLARE
  scoped_tables text[] := ARRAY[
    'sites', 'departments', 'work_centers',
    'users', 'employees',
    'roles', 'permissions', 'user_roles', 'role_permissions',
    'qualifications', 'employee_qualifications', 'delegations',
    'outbox_events'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY scoped_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = current_setting(''app.current_org_id'', true)) WITH CHECK (organization_id = current_setting(''app.current_org_id'', true))',
      t || '_isolation', t
    );
  END LOOP;
END
$$;

-- NOTE: `devices` and `sessions` intentionally have NO organization_id
-- column (they are user-scoped, not directly org-scoped) and therefore no
-- RLS policy here. Tenant isolation for these two tables is enforced at the
-- application layer via a join through users.organization_id until a
-- dedicated policy is designed (tracked for Phase 1 auth work, see
-- src/lib/auth). Every other business table added from Phase 2 onward MUST
-- either get an RLS policy in its own migration or document why not.
