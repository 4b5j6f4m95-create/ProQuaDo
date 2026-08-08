-- Tenant isolation (ADR-006) and database-level integrity rules for the
-- Phase 4 quality tables, following the same pattern as the Phase 2 and
-- Phase 3 migrations.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  non_conformances, non_conformance_evidence,
  production_holds, measuring_equipment, calibrations
TO proquado_app;

DO $$
DECLARE
  scoped_tables text[] := ARRAY[
    'non_conformances', 'non_conformance_evidence',
    'production_holds', 'measuring_equipment', 'calibrations'
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

-- A hold without a scope target would silently block nothing while looking
-- active. Each scope type must carry the column it scopes on.
ALTER TABLE production_holds
  ADD CONSTRAINT production_holds_scope_target_present
  CHECK (
    (scope_type = 'PROJECT' AND project_id IS NOT NULL) OR
    (scope_type = 'ORDER' AND production_order_id IS NOT NULL) OR
    (scope_type = 'SERIAL' AND serial_number IS NOT NULL) OR
    (scope_type = 'WORK_STEP' AND work_step_instance_id IS NOT NULL)
  );

-- A released hold must say who released it and when; an active one must not
-- claim a release. Without this, "is_active = false" could hide an
-- unattributed release from the audit.
ALTER TABLE production_holds
  ADD CONSTRAINT production_holds_release_fields_consistent
  CHECK (
    (is_active AND released_at IS NULL AND released_by_id IS NULL) OR
    (NOT is_active AND released_at IS NOT NULL AND released_by_id IS NOT NULL)
  );

-- A calibration interval that ends before it starts is a data-entry error
-- that would make "currently calibrated" unanswerable.
ALTER TABLE calibrations
  ADD CONSTRAINT calibrations_interval_ordered
  CHECK (next_calibration_due_at > calibrated_at);

-- Derived steps (rework, reinspection) must name their origin, production
-- steps must not — the chain "Fehlerhafter Schritt → Nacharbeit →
-- Nachprüfung" stays reconstructible from the data alone
-- (MASTERPROMPT.md Kap. 9).
ALTER TABLE work_step_instances
  ADD CONSTRAINT work_step_instances_derived_steps_have_origin
  CHECK (
    (step_kind = 'PRODUCTION' AND origin_work_step_instance_id IS NULL) OR
    (step_kind IN ('REWORK', 'REINSPECTION') AND origin_work_step_instance_id IS NOT NULL)
  );

-- Only one open (not CLOSED/CANCELLED) NCR per work step and inspection
-- characteristic, so the automatic NCR raised on an out-of-tolerance
-- measurement stays idempotent across repeated completion attempts.
CREATE UNIQUE INDEX non_conformances_open_per_step_characteristic_key
  ON non_conformances (organization_id, work_step_instance_id, inspection_characteristic_id)
  WHERE status NOT IN ('CLOSED', 'CANCELLED')
    AND work_step_instance_id IS NOT NULL
    AND inspection_characteristic_id IS NOT NULL;
