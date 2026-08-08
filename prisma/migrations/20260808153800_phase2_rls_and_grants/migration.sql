-- Extends the Phase 1 tenant-isolation pattern (ADR-006, see
-- 20260808151300_rls_and_audit_hardening) to every table added in Phase 2.
-- Unlike audit_events, these are ordinary mutable business tables — full
-- CRUD is granted to proquado_app; correctness of "a released document
-- revision is immutable" is enforced by the domain service layer (state
-- machine guards), not by database grants, since legitimate updates still
-- happen pre-release (metadata edits, upload completion, status transitions).

GRANT SELECT, INSERT, UPDATE, DELETE ON
  customers, projects, project_members,
  products, assemblies, parts,
  documents, document_revisions, document_approvals,
  production_plans, production_plan_revisions,
  plan_steps, plan_step_dependencies, step_document_bindings,
  checklist_items
TO proquado_app;

DO $$
DECLARE
  scoped_tables text[] := ARRAY[
    'customers', 'projects', 'project_members',
    'products', 'assemblies', 'parts',
    'documents', 'document_revisions', 'document_approvals',
    'production_plans', 'production_plan_revisions',
    'plan_steps', 'plan_step_dependencies', 'step_document_bindings',
    'checklist_items'
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
