-- Solves the RLS bootstrap problem for login: right after an OIDC callback
-- we know the external_id (OIDC `sub`) and email, but not yet which
-- organization_id to put into `SET LOCAL app.current_org_id` — and without
-- that, RLS makes the `users` table invisible (fail-closed, see ADR-006).
--
-- This function is the ONLY place in the schema allowed to look across
-- organization boundaries, and it is deliberately narrow: it returns a
-- single organization_id (or NULL), never a full row, never a list, never
-- anything else about the user. SECURITY DEFINER makes it run with the
-- privileges of its owner (proquado, which bypasses RLS as table owner),
-- not the privileges of the calling proquado_app role.

CREATE FUNCTION resolve_org_for_login(p_external_id text, p_email text)
RETURNS TABLE (organization_id text, matched_by text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  -- 1. Already-linked account: match by external_id (the common case).
  SELECT u.organization_id, 'external_id'::text
  FROM users u
  WHERE u.external_id = p_external_id
    AND u.is_active = true
  UNION ALL
  -- 2. Pre-provisioned invite: an admin created the user row with a known
  --    email but the person has never logged in yet (external_id is a
  --    placeholder, never NULL — see users.external_id NOT NULL). Invited
  --    rows use the sentinel 'pending:<email>' so this query can find them
  --    without weakening the NOT NULL constraint.
  SELECT u.organization_id, 'pending_invite'::text
  FROM users u
  WHERE u.external_id = 'pending:' || p_email
    AND u.is_active = true
  LIMIT 1;
$$;

-- Only the application role may call it, and only EXECUTE — it cannot
-- select from `users` directly through this grant.
REVOKE ALL ON FUNCTION resolve_org_for_login(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_org_for_login(text, text) TO proquado_app;
