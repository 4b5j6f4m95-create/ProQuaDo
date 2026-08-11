-- IFC-Import: Herkunft eines Fertigungsplans, der aus einem Gebäudemodell
-- entstanden ist, und die Bauteile je Arbeitsschritt.
--
-- Zum Zuschnitt: `ifc_imports` hängt an der Plan-REVISION, nicht am Plan.
-- Ein zweiter Export desselben Moduls ist eine neue Revision und damit ein
-- neuer Import — die alte Revision behält ihre Datei und ihre Bauteilliste,
-- weil eine bereits gefertigte Akte sonst nachträglich ihre Grundlage
-- wechseln würde. Deshalb UNIQUE auf production_plan_revision_id.

CREATE TABLE ifc_imports (
  id                          TEXT PRIMARY KEY,
  organization_id             TEXT NOT NULL REFERENCES organizations (id),
  project_id                  TEXT NOT NULL REFERENCES projects (id),
  product_id                  TEXT NOT NULL REFERENCES products (id),
  production_plan_revision_id TEXT NOT NULL UNIQUE REFERENCES production_plan_revisions (id),
  file_name                   TEXT NOT NULL,
  file_size_bytes             INTEGER NOT NULL,
  file_hash                   TEXT NOT NULL,
  storage_key                 TEXT NOT NULL,
  ifc_schema                  TEXT NOT NULL,
  source_application          TEXT,
  module_numbers              TEXT[] NOT NULL DEFAULT '{}',
  step_count                  INTEGER NOT NULL,
  component_count             INTEGER NOT NULL,
  warnings                    TEXT[] NOT NULL DEFAULT '{}',
  imported_by_id              TEXT NOT NULL REFERENCES users (id),
  imported_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  version                     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX ifc_imports_organization_id_idx ON ifc_imports (organization_id);
CREATE INDEX ifc_imports_organization_id_file_hash_idx ON ifc_imports (organization_id, file_hash);

-- Ein Import ohne Schritte ist kein Import, sondern eine stille Fehlfunktion:
-- der Plan stünde leer da und niemand müsste etwas bestätigen.
ALTER TABLE ifc_imports
  ADD CONSTRAINT ifc_imports_step_count_positive CHECK (step_count > 0);
ALTER TABLE ifc_imports
  ADD CONSTRAINT ifc_imports_component_count_not_negative CHECK (component_count >= 0);
-- SHA-256, hex, klein geschrieben. Ein Hash in anderer Schreibweise ließe
-- denselben Inhalt zweimal als verschieden erscheinen.
ALTER TABLE ifc_imports
  ADD CONSTRAINT ifc_imports_file_hash_is_sha256 CHECK (file_hash ~ '^[0-9a-f]{64}$');

CREATE TABLE ifc_components (
  id               TEXT PRIMARY KEY,
  organization_id  TEXT NOT NULL REFERENCES organizations (id),
  ifc_import_id    TEXT NOT NULL REFERENCES ifc_imports (id),
  plan_step_id     TEXT NOT NULL REFERENCES plan_steps (id),
  global_id        TEXT NOT NULL,
  ifc_type         TEXT NOT NULL,
  component_number TEXT,
  object_name      TEXT,
  material         TEXT,
  trade            TEXT,
  version          INTEGER NOT NULL DEFAULT 1
);

-- Dieselbe GlobalId zweimal in derselben Datei wäre ein widersprüchliches
-- Modell; die Datenbank sagt das, statt es zu übernehmen.
CREATE UNIQUE INDEX ifc_components_import_global_id_key
  ON ifc_components (ifc_import_id, global_id);
CREATE INDEX ifc_components_organization_id_idx ON ifc_components (organization_id);
CREATE INDEX ifc_components_plan_step_id_idx ON ifc_components (plan_step_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON ifc_imports, ifc_components TO proquado_app;

ALTER TABLE ifc_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY ifc_imports_isolation ON ifc_imports
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));

ALTER TABLE ifc_components ENABLE ROW LEVEL SECURITY;
CREATE POLICY ifc_components_isolation ON ifc_components
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));
