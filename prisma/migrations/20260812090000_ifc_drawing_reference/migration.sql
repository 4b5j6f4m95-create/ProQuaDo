-- Zeichnungen, die ein Gebäudemodell einem Arbeitsschritt zuordnet.
--
-- Zum Zuschnitt: getrennt von `step_document_bindings`, und das ist der
-- Punkt. Eine Bindung sagt, welche Revision der Schritt verwendet; sie geht
-- in den `documentSetHash` der Freigabe ein und trägt damit Verantwortung.
-- Eine Zeile hier sagt nur, was in der IFC-Datei stand — eine Behauptung des
-- Planungsprogramms. Findet der Import ein Dokument dieser Nummer, entsteht
-- zusätzlich eine Bindung und `document_revision_id` zeigt darauf; bleibt es
-- leer, ist der Verweis unerledigt und muss im Schritt sichtbar sein.

CREATE TABLE ifc_drawing_references (
  id                   TEXT PRIMARY KEY,
  organization_id      TEXT NOT NULL REFERENCES organizations (id),
  ifc_import_id        TEXT NOT NULL REFERENCES ifc_imports (id),
  plan_step_id         TEXT NOT NULL REFERENCES plan_steps (id),
  name                 TEXT,
  identification       TEXT,
  location             TEXT,
  description          TEXT,
  document_id          TEXT REFERENCES documents (id),
  document_revision_id TEXT REFERENCES document_revisions (id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  version              INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX ifc_drawing_references_organization_id_idx
  ON ifc_drawing_references (organization_id);
CREATE INDEX ifc_drawing_references_plan_step_id_idx
  ON ifc_drawing_references (plan_step_id);

-- Ein Verweis ohne Nummer, Titel und Ablageort ist für niemanden lesbar und
-- für nichts zuordenbar. Der Parser lässt solche Verweise mit einer Warnung
-- aus; die Datenbank sagt dasselbe noch einmal, damit ein anderer Weg in
-- diese Tabelle es nicht umgehen kann.
ALTER TABLE ifc_drawing_references
  ADD CONSTRAINT ifc_drawing_references_identifiable CHECK (
    name IS NOT NULL OR identification IS NOT NULL OR location IS NOT NULL
  );

-- Eine aufgelöste Zeile nennt immer beides: das Dokument und die Revision,
-- auf die sie gebunden wurde. Nur eines von beidem wäre ein Verweis auf
-- „irgendeine Fassung" — genau die Unbestimmtheit, die Geschäftsgrundsatz 6
-- ausschließt.
ALTER TABLE ifc_drawing_references
  ADD CONSTRAINT ifc_drawing_references_resolution_complete CHECK (
    (document_id IS NULL) = (document_revision_id IS NULL)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON ifc_drawing_references TO proquado_app;

ALTER TABLE ifc_drawing_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY ifc_drawing_references_isolation ON ifc_drawing_references
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));
