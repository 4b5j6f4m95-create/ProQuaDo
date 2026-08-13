-- Nachgereichte Unterlagen an einer Schrittinstanz.
--
-- Der Anlass ist eine Aussage aus der Fertigung: „Detailzeichnungen oder
-- Zulassungen werden nachträglich zugeordnet." Das kollidierte mit dem
-- System, weil `step_document_bindings` nur im Status DRAFT der Planrevision
-- geschrieben werden darf — nach dem Einreichen ist der Plan zu.
--
-- Zum Zuschnitt, und das ist die eigentliche Entscheidung: diese Tabelle
-- hängt an der **Schrittinstanz**, nicht am Planschritt. Damit ändert eine
-- nachgereichte Unterlage den Plan nicht, geht nicht in den
-- `documentSetHash` der Freigabe ein und löst keinen Revisionskonflikt aus.
-- Sie ist ein **Nachweis**, keine Arbeitsanweisung. Wer eine Zeichnung
-- nachreicht, die die Ausführung ändert, braucht weiterhin eine neue
-- Planrevision — dafür ist das hier ausdrücklich nicht gedacht.
--
-- `reason` ist Pflicht: eine Unterlage, die nach der Freigabe des Plans
-- dazukommt, muss sagen, warum. Ohne diesen Satz steht in der Akte eine
-- Datei ohne Anlass, und ein Prüfer kann nicht unterscheiden, ob sie
-- vergessen wurde oder erst später entstanden ist.

CREATE TABLE work_step_supplements (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL REFERENCES organizations (id),
  work_step_instance_id TEXT NOT NULL REFERENCES work_step_instances (id),
  document_revision_id  TEXT NOT NULL REFERENCES document_revisions (id),
  reason                TEXT NOT NULL,
  added_by_id           TEXT NOT NULL REFERENCES users (id),
  added_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  version               INTEGER NOT NULL DEFAULT 1
);

-- Dieselbe Revision zweimal an denselben Schritt zu hängen, sagt nichts
-- Zusätzliches und verdoppelt sie in der Akte.
CREATE UNIQUE INDEX work_step_supplements_instance_revision_key
  ON work_step_supplements (work_step_instance_id, document_revision_id);
CREATE INDEX work_step_supplements_organization_id_idx
  ON work_step_supplements (organization_id);
CREATE INDEX work_step_supplements_work_step_instance_id_idx
  ON work_step_supplements (work_step_instance_id);

-- Eine Begründung aus Leerzeichen ist keine. Die Grenze ist bewusst niedrig:
-- sie soll das gedankenlose Leerfeld verhindern, nicht Prosa erzwingen.
ALTER TABLE work_step_supplements
  ADD CONSTRAINT work_step_supplements_reason_not_blank
  CHECK (length(btrim(reason)) >= 3);

GRANT SELECT, INSERT, UPDATE, DELETE ON work_step_supplements TO proquado_app;

ALTER TABLE work_step_supplements ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_step_supplements_isolation ON work_step_supplements
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));
