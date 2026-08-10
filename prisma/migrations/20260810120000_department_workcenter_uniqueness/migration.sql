-- Eindeutigkeit für Abteilungen und Arbeitsplätze.
--
-- Beide Tabellen stehen seit Phase 1 im Modell und hatten nie einen
-- Eindeutigkeits-Constraint. Das war folgerichtig, solange sie ausschließlich
-- im Seed entstanden: dort gibt es keine zweite Eingabe. Mit einem Formular
-- davor sind Dubletten eine Frage der Zeit — und eine zweite „Montage" am
-- selben Standort macht jede Auswahlliste im Planungsbildschirm mehrdeutig,
-- ohne dass irgendetwas fehlschlägt.
--
-- Die Zuschnitte sind bewusst verschieden:
--
--   * departments (organization_id, site_id, name)
--     Der Name gilt je STANDORT. Zwei Werke dürfen beide eine Montage haben —
--     eine organisationsweite Eindeutigkeit wäre in einem Mehrwerksbetrieb
--     schlicht falsch.
--
--   * departments (organization_id, code)
--     Das Kürzel dagegen soll als Kennung taugen und gilt deshalb
--     organisationsweit. Es ist optional (`code TEXT NULL`), und Postgres
--     behandelt NULL-Werte in einem Unique-Index als voneinander verschieden:
--     beliebig viele Abteilungen ohne Kürzel bleiben erlaubt, zwei mit
--     demselben nicht.
--
--   * work_centers (organization_id, department_id, name)
--     Je ABTEILUNG. „Prüfplatz 1" darf es in jeder geben.
--
-- HINWEIS für bestehende Installationen: diese Migration schlägt fehl, wenn
-- bereits Dubletten vorliegen. Das ist beabsichtigt — welcher von zwei
-- gleichnamigen Arbeitsplätzen die Planschritte behält, darf keine Migration
-- stillschweigend entscheiden. Vorher prüfen:
--
--   SELECT organization_id, site_id, name, count(*)
--     FROM departments GROUP BY 1, 2, 3 HAVING count(*) > 1;
--   SELECT organization_id, code, count(*)
--     FROM departments WHERE code IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
--   SELECT organization_id, department_id, name, count(*)
--     FROM work_centers GROUP BY 1, 2, 3 HAVING count(*) > 1;

CREATE UNIQUE INDEX "departments_organization_id_site_id_name_key"
  ON "departments"("organization_id", "site_id", "name");

CREATE UNIQUE INDEX "departments_organization_id_code_key"
  ON "departments"("organization_id", "code");

CREATE UNIQUE INDEX "work_centers_organization_id_department_id_name_key"
  ON "work_centers"("organization_id", "department_id", "name");
