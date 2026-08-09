-- One binding per (plan step, document revision).
--
-- Implicit until Phase 7, when the planning screen finally offered the
-- binding as a button: the only previous caller was an integration test that
-- bound each revision deliberately, so a duplicate had no way to arise. A
-- double click is a different matter.
--
-- Duplicates are not merely untidy. `hashIdSet` (src/lib/security/release-token.ts)
-- hashes the sorted list of bound revision ids into `documentSetHash`, which
-- travels inside every release token; a repeated id changes that hash for an
-- unchanged document set, so a token would disagree with the plan it was
-- minted from.
--
-- Deliberately NOT unique per (plan_step_id, document_id): binding two page
-- markers of the same drawing to one step is legitimate, binding two
-- *revisions* of it is a contradiction — and that case is already refused by
-- bindDocumentToPlanStep, which accepts only the RELEASED revision, of which
-- there is one.
CREATE UNIQUE INDEX step_document_bindings_step_revision_unique
  ON step_document_bindings (plan_step_id, document_revision_id);
