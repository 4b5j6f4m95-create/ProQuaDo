-- Extends the tenant-isolation pattern (ADR-006, see
-- 20260808151300_rls_and_audit_hardening and 20260808153800_phase2_rls_and_grants)
-- to every table added in Phase 3, and adds the integrity rules from
-- docs/02_DOMAIN_MODEL.md "Integritätsregeln & Constraints" that belong in
-- the database rather than in application code — the ones that must hold
-- even if a future service, script or migration gets them wrong.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  inspection_characteristics, photo_requirements,
  production_orders, order_assignments,
  work_step_instances, work_step_releases,
  completion_submissions, step_confirmations,
  checklist_responses, measurement_results, photo_evidence,
  second_approvals
TO proquado_app;

DO $$
DECLARE
  scoped_tables text[] := ARRAY[
    'inspection_characteristics', 'photo_requirements',
    'production_orders', 'order_assignments',
    'work_step_instances', 'work_step_releases',
    'completion_submissions', 'step_confirmations',
    'checklist_responses', 'measurement_results', 'photo_evidence',
    'second_approvals'
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

-- Vier-Augen-Prinzip (docs/04 "Vier-Augen-Prinzip (Enforcement)"): the
-- person who executed a step can never be the person who independently
-- reviews it. Enforced here so no service, import or admin shortcut can
-- write such a row at all (Negativtest #9).
ALTER TABLE second_approvals
  ADD CONSTRAINT second_approvals_executor_differs_from_reviewer
  CHECK (reviewer_id IS NULL OR executor_id <> reviewer_id);

-- The tolerance verdict must agree with the values it was derived from.
-- Without this, "in tolerance" would be whatever the writing code claimed;
-- with it, a wrong verdict is a failed transaction (Negativtest #8).
ALTER TABLE measurement_results
  ADD CONSTRAINT measurement_results_tolerance_verdict_consistent
  CHECK (
    is_within_tolerance = (
      measured_value >= COALESCE(lower_limit, measured_value) AND
      measured_value <= COALESCE(upper_limit, measured_value)
    )
  );

ALTER TABLE checklist_responses
  ADD CONSTRAINT checklist_responses_response_values
  CHECK (response IN ('OK', 'NOK', 'N/A'));

-- "Seriennummer eindeutig je Projekt" (docs/02). Partial index because
-- serial numbers are assigned late — many orders legitimately have none.
CREATE UNIQUE INDEX production_orders_org_project_serial_key
  ON production_orders (organization_id, project_id, serial_number)
  WHERE serial_number IS NOT NULL;
