-- Tenant isolation (ADR-006) and database-level integrity rules for the
-- Phase 6 dossier/export/notification tables, following the same pattern as
-- Phases 2–5.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  production_dossiers, dossier_exports, notifications
TO proquado_app;

DO $$
DECLARE
  scoped_tables text[] := ARRAY[
    'production_dossiers', 'dossier_exports', 'notifications'
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

-- Only the two formats Masterprompt Kap. 10 names ("Export als PDF sowie ZIP
-- mit Originalnachweisen und Manifest").
ALTER TABLE dossier_exports
  ADD CONSTRAINT dossier_exports_format_known
  CHECK (format IN ('PDF', 'ZIP'));

ALTER TABLE dossier_exports
  ADD CONSTRAINT dossier_exports_status_known
  CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED'));

-- A completed export must be able to prove what it produced: where the file
-- is, what it hashes to, and when it finished. Without this, a row could
-- claim success while pointing at nothing — and an export whose file cannot
-- be verified is not evidence, which is the export's entire purpose.
ALTER TABLE dossier_exports
  ADD CONSTRAINT dossier_exports_completed_fields_present
  CHECK (
    status <> 'COMPLETED' OR
    (storage_key IS NOT NULL AND file_hash_sha256 IS NOT NULL
     AND file_size_bytes IS NOT NULL AND completed_at IS NOT NULL)
  );

-- A failed export must say why. "FAILED" with no reason sends whoever finds
-- it back to the logs, if they still exist.
ALTER TABLE dossier_exports
  ADD CONSTRAINT dossier_exports_failure_has_reason
  CHECK (status <> 'FAILED' OR failure_reason IS NOT NULL);

-- The ZIP is the format that carries a manifest; a ZIP without one would be
-- a bag of files nobody can check against anything (Abnahmeszenario F).
ALTER TABLE dossier_exports
  ADD CONSTRAINT dossier_exports_zip_has_manifest
  CHECK (status <> 'COMPLETED' OR format <> 'ZIP' OR manifest IS NOT NULL);

-- data_as_of records the moment the primary records were read. A value in
-- the future would make the dossier claim to prove something that had not
-- happened yet; generated_at may not precede it either.
ALTER TABLE production_dossiers
  ADD CONSTRAINT production_dossiers_data_as_of_not_after_generation
  CHECK (data_as_of <= generated_at);

ALTER TABLE notifications
  ADD CONSTRAINT notifications_severity_known
  CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL'));
