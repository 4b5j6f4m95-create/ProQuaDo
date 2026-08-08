# Entwicklungsnotizen

Praktische Hinweise für die lokale Arbeit an ProQuaDo, ergänzend zu `docs/` (Architektur) und den ADRs. Diese Datei ist ein lebendes Arbeitsdokument, kein verbindliches Spezifikationsdokument.

---

## Stand

- **Phase 1 (Fundament)**: abgeschlossen — Auth (OIDC/Keycloak), RBAC/ABAC, Mandantentrennung via RLS, Audit-Trail, CI-Pipeline.
- **Phase 2 (Dokumente und Planung)**: abgeschlossen — Projekte, Dokument-Freigabeworkflow, Fertigungsplan mit Zyklenerkennung, Objektspeicher (S3/MinIO), funktionale UI.
- **Phase 3 (Online-Ausführung)**: abgeschlossen — Produktionsaufträge, Auftragszuweisungen, serverseitige Schrittfreigabe mit Release Token, Tablet-UI (Checkliste/Foto/Messwert/PIN-Bestätigung), Abschlussvalidierung und Nachfolgerfreigabe. Abnahmeszenario A läuft end-to-end (Integrationstest).
- **Phase 4 (Qualität)**: abgeschlossen — NCR mit serverseitiger Blockier-Klassifikation, Produktionssperren, Nacharbeit/Nachprüfung als eigene Schrittinstanzen, Prüfmittel + Kalibrierungs-Gate, Vier-Augen-Entscheidung, Revisionsauswirkungsanalyse. Abnahmeszenarien D und E laufen end-to-end (Integrationstest).
- **Nächster Schritt**: Phase 5 (Offline und Synchronisation) gemäß [docs/10_MVP_PLAN.md](docs/10_MVP_PLAN.md) — IndexedDB, Outbox, Release-Token-Auslieferung ans Gerät, Konfliktcenter, Abnahmeszenarien B und C. **Vorher Stakeholder-Checkpoint** (siehe „Kritischer Pfad" in docs/10).

Alle 10 Architekturdokumente in `docs/` sind vor der Implementierung entstanden und sollten bei Unklarheiten zuerst konsultiert werden.

---

## Lokale Umgebung starten

```bash
docker compose up -d postgres minio minio-init keycloak
pnpm install
pnpm exec prisma migrate deploy
pnpm exec tsx prisma/seed.ts
pnpm run dev
```

**Ports:** Postgres `5433`, MinIO `9010`/`9011` (Console), Keycloak `8081`, App `3000` (Standard) — siehe unten zu Portkonflikten.

**Demo-User** (Keycloak-Passwort für alle: `devpassword`), verknüpft über den `pending:<email>`-Mechanismus beim ersten Login (siehe `src/lib/auth/resolve-login.ts`):

| User                         | Rolle              |
| ---------------------------- | ------------------ |
| `admin.test@proquado.local`  | ADMIN              |
| `worker.test@proquado.local` | WORKER             |
| `pl.test@proquado.local`     | PROJECT_LEAD       |
| `qm.test@proquado.local`     | QUALITY_MANAGER    |
| `pm.test@proquado.local`     | PRODUCTION_MANAGER |

Seed legt zusätzlich ein Demo-Projekt (`PROJ-2026-0001`) mit Site, Customer und Product an.

**Bestätigungs-PIN der Demo-User: `1234`** (Seed setzt einen scrypt-Hash in `users.confirmation_pin_hash`). Ohne PIN kann ein Arbeitsschritt nicht bestätigt/abgeschlossen werden — echte Benutzer setzen ihre PIN selbst, geseedet wird sie nur für Demo/Test.

Ein durchgängiger Ausführungsflow braucht zusätzlich: Fertigungsplan mit Schritten + Anforderungen anlegen (PL) → einreichen (PL) → genehmigen (QM) → freigeben (PL) → Produktionsauftrag anlegen/einplanen/freigeben und einem Worker zuweisen (PM) → Worker sieht ihn unter **Meine Aufträge**.

---

## Bekannte Stolpersteine (lokal aufgetreten, für die Zukunft dokumentiert)

### Portkonflikte mit anderen Projekten

Auf dieser Maschine liefen parallel andere Next.js-Projekte auf Port 3000/3001. `.env.example` und die Keycloak-Realm-Config (`infra/keycloak/proquado-realm.json`) gehen von Port **3000** aus. Falls belegt: `.claude/launch.json` auf einen freien Port ändern (aktuell `3002` konfiguriert) **und** die lokale `.env` (`AUTH_URL`) entsprechend anpassen. Die Keycloak-Realm-Config akzeptiert bereits beide Redirect-URIs (3000 und 3002).

### `pino-pretty` + Next.js Dev-Server

`pino`s Standard-Transport (`transport: { target: 'pino-pretty' }`) nutzt Worker Threads, die Next.js' Server-Bundling nicht auflösen kann (`Cannot find module .next/server/vendor-chunks/lib/worker.js`, crasht jeden Request). Fix in `src/lib/logger/index.ts`: `pino-pretty` als synchroner Destination-Stream statt als Transport. Nicht zurückändern.

### CSP blockiert Dev-Tooling und OAuth-Redirect

Eine strikte `Content-Security-Policy` (`script-src 'self'`, `form-action 'self'`) verhindert sowohl Next.js' HMR (inline Scripts) als auch den Redirect zu Keycloak (`form-action` erlaubt nur die eigene Origin). Fix in `next.config.mjs`: CSP wird nur in Production gesetzt, `form-action` schließt dort die OIDC-Issuer-Origin explizit ein.

### Prisma-Client-Regenerierung erfordert Server-Neustart

Nach `prisma generate` (z. B. nach Schema-Änderungen) muss der laufende `next dev`-Prozess neu gestartet werden — Hot Reload lädt den neu generierten Client nicht automatisch nach.

### Browser-Tool: Klick-Koordinaten können bei mehrzeiligen Überschriften driften

Bei der UI-Verifikation über das Browser-Automatisierungstool führte ein zweizeilig umbrechender Seitentitel zu einer Koordinatenverschiebung, wodurch ein `left_click` auf eine stale `ref`-Position daneben traf (kein Klick, kein Request). Workaround: bei Formularen mit variabler Kopfzeilenhöhe den Submit direkt per `button.click()` über `javascript_tool` auslösen statt über Koordinaten-Klicks.

### Abgelehnte Vorgänge dürfen nicht in derselben Transaktion geworfen werden

Zweimal in Phase 3 aufgetreten, beim zweiten Mal von einem Integrationstest gefunden: Ein Service markiert einen Datensatz als `FAILED`/`REJECTED` **und** wirft anschließend einen Fehler — innerhalb derselben `withOrgContext`-Transaktion. Der Throw rollt die Transaktion zurück, also verschwindet genau der Datensatz, der die Ablehnung dokumentiert (`photo_evidence` blieb `PENDING`). **Regel:** Entweder die Ablehnung als Rückgabewert modellieren statt als Exception (so gelöst in `validateAndCompleteWorkStep`, das ein `CompletionResult` mit `result: 'REJECTED'` liefert), oder den Fehlerzustand in einer **eigenen** Transaktion schreiben und erst danach werfen (so gelöst in `completePhotoUpload` → `markUploadFailed`).

### Berechtigung hängt manchmal von Daten ab, die man erst laden muss

Der etablierte Aufbau „`assertPermission` als erste Zeile des Service, dann `withOrgContext`" trägt nicht mehr, sobald das _benötigte_ Berechtigungsatom vom Datensatz abhängt: Ein Arbeitsschritt verlangt `work_step.execute` (Produktion), `rework.execute` (Nacharbeit) oder `reinspection.execute` (Nachprüfung) — welches, weiß man erst nach dem Laden der Instanz. In Phase 4 dreimal aufgetreten (Start, Nachweiserfassung, Abschluss), jedes Mal von einem Integrationstest gefunden.

Lösung: `src/lib/authz/permission-within.ts` (`assertPermissionWithin`) prüft innerhalb der laufenden Transaktion. Die Zuordnung Schritt-Art → Atom steht **einmal** in `src/domain/execution/execution-guards.ts`. Kein zweiter Prüfpfad, keine geschachtelte Transaktion.

### Relationsnamen bei bidirektionalen Prisma-Beziehungen

Ein echter Bug wurde beim Browser-Test gefunden: `PlanStep.predecessors`/`.dependents` waren so benannt, dass sie das Gegenteil dessen enthielten, was der Name suggeriert (Prisma-Rückrelationen benennen sich nach der Relation, nicht nach der eigenen Rolle). Umbenannt zu `predecessorLinks`/`successorLinks` mit erklärendem Kommentar direkt im Schema. **Lehre:** Bei selbstreferenzierenden n:m-artigen Relationen über ein Join-Modell (hier `PlanStepDependency`) immer explizit prüfen, welche Richtung eine Rückrelations-Array tatsächlich liefert — nicht vom Feldnamen ausgehen.

---

## Architekturentscheidungen mit Nachwirkung

- **`production_plan.release` ist Standard-Berechtigung von PROJECT_LEAD**, nicht nur konfigurierbar (`*` in der Matrix). Ohne diese Korrektur konnte niemand einen Plan freigeben — siehe `src/domain/identity/system-roles.ts` Kommentar für die Begründung (Masterprompt Kap. 3 weist Planerstellung/-freigabe der Projektleitung zu, anders als bei Dokumenten, wo QM die eindeutige Instanz ist).
- **Domain-Services prüfen ihre eigene Berechtigung** (`assertPermission` als erster Schritt in jeder Service-Funktion), nicht nur die aufrufende API-Route. Das macht sie gegen zukünftige Aufrufer (Tests, Skripte, andere Services) selbstverteidigend.
- **Malware-Scan ist ein Stub** (`src/lib/storage/malware-scan.ts`) — meldet immer `CLEAN`. Vor jedem Piloten/Produktivbetrieb durch echten Scanner ersetzen (siehe Kommentar dort und `docs/20` Phase 7).
- **Produktionsaufträge sind erst in Phase 3 entstanden**, obwohl `docs/10_MVP_PLAN.md` sie unter Phase 2 („Projekte, Produkte, Aufträge") listet. Phase 2 hat sie nicht implementiert; Phase 3 braucht sie als Träger der Arbeitsschrittinstanzen und holt das nach. Kein Scope-Verlust, nur eine verschobene Grenze.
- **Der Release Token ist beim Online-Flow optional.** `POST /work-steps/{id}/start` akzeptiert ihn, verlangt ihn aber nicht: Ein Online-Client hat keinen (die Freigabe geschah serverseitig beim Abschluss des Vorgängers), und der Server prüft stattdessen direkt seinen `work_step_releases`-Datensatz — was strikt stärker ist als jede Token-Prüfung. Der Token existiert für den Offline-Fall (Phase 5) und wird, wenn mitgesendet, gegen denselben Datensatz verifiziert (Signatur, Schritt-ID, Nonce, Hash). Er wird genau einmal im Klartext zurückgegeben: in der Antwort von `releaseProductionOrder`/der Nachfolgerfreigabe. Der Server speichert nur den Hash.
- **`validateAndCompleteWorkStep` prüft keine Berechtigung.** Es ist eine Serveraktion, keine Benutzeraktion — der Server validiert seinen eigenen Posteingang, direkt nach der Abschlussmeldung des Mitarbeiters. Das Berechtigungsatom `completion_submission.validate` (QM/PL) gilt für die **manuelle** Re-Validierung über `POST /completion-submissions/{id}/validate`. Hätte man die Prüfung in den Automatikpfad gelegt, könnte kein WORKER je einen Schritt abschließen.
- **NOK in der Checkliste blockiert den Abschluss** (`step-requirements.ts`). Konservative Auslegung von Geschäftsgrundsatz 4: eine offene Abweichung ist kein Abschluss. Phase 4 verknüpft das mit einer NCR samt Disposition; bis dahin muss die Antwort korrigiert oder die Abweichung anders behandelt werden.
- **`COMPLETION_REJECTED → IN_PROGRESS` ist eine bewusste Ergänzung** zum Automaten in `docs/03_STATE_MACHINES.md`. Der dokumentierte Automat kennt keinen Ausgang aus `COMPLETION_REJECTED`, wodurch eine fehlgeschlagene Validierung den Schritt — und damit den ganzen Auftrag — dauerhaft blockieren würde. Die abgelehnte Abschlussmeldung bleibt mit ihren Gründen historisch erhalten.
- **Vier-Augen endet in Phase 3 bewusst bei `AWAITING_SECOND_APPROVAL`.** Der `second_approvals`-Datensatz wird angelegt, Nachfolger bleiben gesperrt, aber der entscheidende Service (`releaseSecondApproval`) ist Phase-4-Scope (MVP-Feature 11, Abnahmeszenario E). Die DB-Constraint `executor_id <> reviewer_id` steht bereits (Negativtest #9 grün).
- **Nacharbeit ist ein eigener Schritt, kein Wiederöffnen.** MASTERPROMPT Kap. 9 ist eindeutig: „Nacharbeit wird als eigener, mit Ursprung und NCR verknüpfter Schritt ausgeführt" und „Der ursprüngliche Schritt wird niemals … rückwirkend als fehlerfrei umgeschrieben." Deshalb hat `work_step_instances` seit Phase 4 `step_kind` (PRODUCTION/REWORK/REINSPECTION), `attempt_number` und `origin_work_step_instance_id`; der fehlerhafte Erstversuch bleibt dauerhaft `BLOCKED` in der Historie. Folge für die Nachfolgerfreigabe: **nur der jüngste Versuch je Planschritt zählt** (`releaseEligibleSuccessors`, `completeOrderIfFinished`) — sonst würde der gescheiterte Erstversuch den Auftrag für immer offen halten.
- **Die abgeleiteten Schritte erben die Anforderungen des Planschritts.** Eine Nachprüfung verlangt damit dieselben Checklisten/Fotos/Messwerte wie die Erstausführung. Das ist bewusst konservativ (eine Nachprüfung bestätigt genau die Merkmale, die beanstandet wurden), aber schwergängig. Sobald Anforderungen je Schritt-Art konfigurierbar sein sollen, gehört das in dieselbe Konfigurationsfläche wie die Prüferqualifikation (siehe unten).
- **Sperren blockieren die reguläre Produktion, nicht die Reparatur.** `assertNotBlockedForStep` nimmt Nacharbeits- und Nachprüfungsschritte von genau der Sperre aus, die zu ihrer NCR gehört — sonst könnte die Sperre nie aufgehoben werden, weil ihre Auflösung an ihr selbst scheitert. Jede andere Sperre gilt weiterhin.
- **Messwert außerhalb Toleranz erzeugt die NCR automatisch** — serverseitig, blockierend, beim **Abschluss** (nicht schon beim Erfassen: ein korrigierter Tippfehler darf keine Linie sperren). Idempotent je (Schritt, Prüfmerkmal) über einen partiellen Unique-Index, damit wiederholte Abschlussversuche keine NCR-Flut erzeugen. Masterprompt Kap. 22 D erlaubt „erzeugt **oder** verlangt" — hier bewusst „erzeugt".
- **Die Blockier-Klassifikation ist hart kodiert und konservativ** (`classifyBlocking` in `ncr-status.ts`): kritisch/hoch oder bestimmte Fehlerarten ⇒ blockierend. Ein Melder kann verschärfen, nie abschwächen; nur eine QM-Bewertung mit Begründung kann herabstufen. Eine konfigurierbare Regel-Engine ist Phase-6-Thema — bis dahin ist Raten in die falsche Richtung die einzige Fehlfunktion mit physischen Folgen.
- **`rework.execute` fehlte in `system-roles.ts`.** Die Matrix in docs/04 gibt es dem WORKER; die Phase-1-Transkription hatte es ausgelassen, was erst auffiel, als Phase 4 einen Nacharbeitsschritt starten wollte. Ergänzt.
- **Prüferqualifikation beim Vier-Augen-Prinzip ist noch nicht erzwungen.** `executor_id ≠ reviewer_id` (App **und** DB-Constraint), die zeitlich gültige Berechtigung (`user_roles.expires_at`) und die PIN-Rückbestätigung stehen. Die von Masterprompt Kap. 8 geforderte „passende Prüferqualifikation" lässt sich nicht prüfen, weil Planschritte kein Prüfer-Qualifikationsfeld haben — das ist eine Planungsmodell-Erweiterung, nicht ein vergessener Check.
- **`UNIQUE (organization_id, work_step_instance_id)` auf `completion_submissions` wurde entfernt.** docs/02 fordert sie, aber sie machte die Nachbesserung nach einem abgelehnten Abschluss unmöglich (`COMPLETION_REJECTED → IN_PROGRESS` → zweite Meldung ⇒ Constraint-Verletzung). Ein Phase-3-Bug, der erst durch den Phase-4-Regressionstest sichtbar wurde. Idempotenz hängt weiterhin am `idempotency_key`, wo sie hingehört.
- **Messtoleranz wird von der Datenbank nachgeprüft**, nicht nur vom Service: `measurement_results_tolerance_verdict_consistent` bindet `is_within_tolerance` an `measured_value` und die gespeicherten Grenzwerte. Die Grenzwerte werden bei der Erfassung vom Prüfmerkmal auf das Ergebnis **kopiert**, damit eine spätere Planrevision das Urteil einer bereits erfolgten Messung nicht rückwirkend ändert.

---

## Test-Kommandos

```bash
pnpm run test:unit          # schnell, keine Infrastruktur nötig
pnpm run test:integration   # startet echte Postgres+MinIO-Container (Testcontainers)
pnpm run build               # Production Build als Kompilier-/Bundling-Check
```

Alle Integrationstests laufen gegen **echte** Infrastruktur, nicht gegen Mocks — siehe `docs/09_TEST_PYRAMID.md`.

### Abgedeckte Negativtests (Stand Phase 4)

| #   | Test                                                              | Wo                                                        |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | Folgeschritt nach lokalem Abschluss nicht startbar                | `test/integration/phase3-execution.integration.test.ts`   |
| 2   | Gefälschter/fremder Release Token abgewiesen                      | ebd. + `src/lib/security/__tests__/release-token.test.ts` |
| 3   | Doppelte Abschlussmeldung → genau ein Abschluss + ein Audit-Event | ebd.                                                      |
| 6   | Fotoanforderung nicht erfüllt → Abschluss abgelehnt               | ebd.                                                      |
| 7   | Hash-Mismatch bei Foto- und Dokumentupload                        | ebd. + `phase2-documents-plans`                           |
| 8   | Messwert außerhalb Toleranz (Service **und** DB-Constraint)       | ebd.                                                      |
| 9   | Ausführender ≠ Prüfer (Service **und** DB-Constraint)             | `phase4-quality` + `phase3-execution`                     |
| 10  | Offene blockierende NCR → Nachfolger bleibt gesperrt              | `phase4-quality`                                          |
| 11  | Abgelaufenes/gesperrtes Prüfmittel → Messung abgelehnt            | `phase4-quality`                                          |
| 12  | Objekt-ID einer fremden Organisation → kein Datenleck             | ebd. + `rbac-audit-tenant`                                |
| 15  | Plan mit Zyklus → Validierungsfehler                              | `phase2-documents-plans`                                  |

Offen (Phase 5, Offline/Sync): #4 (Revisionskonflikt), #5 (Rechteentzug vor Sync), #13 (parallele Syncs), #14 (Serverausfall nach Upload).
