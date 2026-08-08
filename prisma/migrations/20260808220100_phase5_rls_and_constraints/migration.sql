-- Tenant isolation (ADR-006) and database-level integrity rules for the
-- Phase 5 sync tables, following the same pattern as Phases 2–4.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  sync_sequences, sync_cursors, sync_commands,
  sync_conflicts, conflict_decisions, photo_upload_chunks
TO proquado_app;

DO $$
DECLARE
  scoped_tables text[] := ARRAY[
    'sync_sequences', 'sync_cursors', 'sync_commands',
    'sync_conflicts', 'conflict_decisions', 'photo_upload_chunks',
    -- devices carries organization_id since this phase's first migration;
    -- the Phase 1 note "tenant isolation for devices is enforced at the
    -- application layer until a dedicated policy is designed" ends here.
    'devices'
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

-- The event cursor is 1-based and gap-free per organization. A zero or
-- negative number would make "everything after cursor 0" ambiguous, which
-- is exactly the initial state of every device.
ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_events_sequence_positive CHECK (sequence > 0);

-- The four outcomes docs/05 defines, plus PENDING. PENDING is never sent to
-- a client: it is the row written BEFORE the command is executed, so that a
-- crash between "applied" and "acknowledged" leaves evidence that the
-- command was received. A retry finds the PENDING row and re-executes
-- idempotently rather than treating an unfinished command as a duplicate.
--
-- A conflict type is present exactly when the outcome is CONFLICT — a
-- CONFLICT row without a type would reach the conflict centre with nothing
-- to decide about.
ALTER TABLE sync_commands
  ADD CONSTRAINT sync_commands_status_known
  CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CONFLICT', 'DUPLICATE'));

ALTER TABLE sync_commands
  ADD CONSTRAINT sync_commands_conflict_type_iff_conflict
  CHECK (
    (status = 'CONFLICT' AND conflict_type IS NOT NULL) OR
    (status <> 'CONFLICT' AND conflict_type IS NULL)
  );

-- A device may not number its commands ambiguously: the batch is processed
-- in this order, and order is what makes "checklist answer before
-- completion" hold (docs/06 "Stabile Reihenfolge").
ALTER TABLE sync_commands
  ADD CONSTRAINT sync_commands_sequence_number_positive CHECK (sequence_number > 0);

-- A resolved conflict must name the person and the moment; an open one must
-- not claim either. Without this, "status = RESOLVED" could hide an
-- unattributed decision from the audit — the same rule production_holds got
-- in Phase 4.
ALTER TABLE sync_conflicts
  ADD CONSTRAINT sync_conflicts_resolution_fields_consistent
  CHECK (
    (status = 'OPEN' AND resolved_at IS NULL AND resolved_by_id IS NULL) OR
    (status IN ('RESOLVED', 'CANCELLED') AND resolved_at IS NOT NULL AND resolved_by_id IS NOT NULL)
  );

-- Every conflict points at something a person can look at. A conflict with
-- no anchor is undecidable and would sit in the centre forever.
ALTER TABLE sync_conflicts
  ADD CONSTRAINT sync_conflicts_anchor_present
  CHECK (sync_command_id IS NOT NULL OR work_step_instance_id IS NOT NULL);

-- Chunks are 0-indexed and non-empty. An empty chunk would advance the
-- resume offset by nothing while looking like progress.
ALTER TABLE photo_upload_chunks
  ADD CONSTRAINT photo_upload_chunks_index_non_negative CHECK (chunk_index >= 0);

ALTER TABLE photo_upload_chunks
  ADD CONSTRAINT photo_upload_chunks_size_positive CHECK (size_bytes > 0);

ALTER TABLE photo_evidence
  ADD CONSTRAINT photo_evidence_upload_mode_known
  CHECK (upload_mode IN ('SINGLE', 'CHUNKED'));

-- A chunked upload must declare what it is going to send. The server needs
-- the total to know when the last chunk has arrived; without it, "complete"
-- would be the client's claim rather than the server's observation.
ALTER TABLE photo_evidence
  ADD CONSTRAINT photo_evidence_chunked_uploads_declare_size
  CHECK (
    upload_mode = 'SINGLE' OR
    (declared_size_bytes IS NOT NULL AND chunk_size_bytes IS NOT NULL AND chunk_count IS NOT NULL)
  );
