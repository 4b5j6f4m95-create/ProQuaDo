# Entwicklungsnotizen

Praktische Hinweise für die lokale Arbeit an ProQuaDo, ergänzend zu `docs/` (Architektur) und den ADRs. Diese Datei ist ein lebendes Arbeitsdokument, kein verbindliches Spezifikationsdokument.

---

## Stand

- **Phase 1 (Fundament)**: abgeschlossen — Auth (OIDC/Keycloak), RBAC/ABAC, Mandantentrennung via RLS, Audit-Trail, CI-Pipeline.
- **Phase 2 (Dokumente und Planung)**: abgeschlossen — Projekte, Dokument-Freigabeworkflow, Fertigungsplan mit Zyklenerkennung, Objektspeicher (S3/MinIO), funktionale UI.
- **Phase 3 (Online-Ausführung)**: abgeschlossen — Produktionsaufträge, Auftragszuweisungen, serverseitige Schrittfreigabe mit Release Token, Tablet-UI (Checkliste/Foto/Messwert/PIN-Bestätigung), Abschlussvalidierung und Nachfolgerfreigabe. Abnahmeszenario A läuft end-to-end (Integrationstest).
- **Phase 4 (Qualität)**: abgeschlossen — NCR mit serverseitiger Blockier-Klassifikation, Produktionssperren, Nacharbeit/Nachprüfung als eigene Schrittinstanzen, Prüfmittel + Kalibrierungs-Gate, Vier-Augen-Entscheidung, Revisionsauswirkungsanalyse. Abnahmeszenarien D und E laufen end-to-end (Integrationstest).
- **Phase 5 (Offline und Synchronisation)**: abgeschlossen — Geräteregistrierung mit Fernsperre, commit-geordneter Ereignis-Cursor, Sync-API (health/commands/changes/bundle), Release-Token-Auslieferung ans Gerät, verschlüsselte IndexedDB mit Outbox, chunk-basierter Foto-Upload mit Wiederaufnahme, alle sieben Konflikttypen im Konfliktcenter. Abnahmeszenarien B und C laufen end-to-end; **alle 15 Negativtests sind grün**.
- **Phase 6 (Akte, Reporting, Integrationen)**: abgeschlossen — digitale Produktionsakte mit allen zehn Abschnitten aus Masterprompt Kap. 10, PDF-Erzeugung, ZIP-Export mit hashgeprüftem Manifest, Rückverfolgbarkeitssuche, Dashboard und ereignisgetriebene In-App-Benachrichtigungen. Abnahmeszenario F läuft end-to-end. **Nicht umgesetzt**: die ERP-/Webhook-Grundlage, die docs/10 für Phase 6 als „Implementierung optional für MVP" führt — es gibt bisher keinen Konsumenten, an dem sich ein Adapter-Interface bewähren könnte.
- **Phase 7 (Pilot und Härtung)**: begonnen — Malware-Scan schließt in Produktion, Rate Limits aus docs/05 durchgesetzt, 12 Angriffstests gegen die Offline-Invariante, **manuelle Sicherheitsüberprüfung der Offline-Invariante durchgeführt und protokolliert** ([docs/11_OFFLINE_INVARIANT_REVIEW.md](docs/11_OFFLINE_INVARIANT_REVIEW.md)). Der Rest von Phase 7 ist überwiegend keine Programmierarbeit (Pilot an einer realen Linie, Schulung, externer Penetrationstest, Restore-Probe, kontrollierter Rollout).
- **Vor dem Piloten weiterhin offen, und nichts davon ist Programmierarbeit**: (a) `MALWARE_SCANNER=clamav` samt erreichbarer clamd-Instanz in der **Zielumgebung** setzen — Dienst, Adapter, Readiness-Check und EICAR-Nachweis stehen, die Konfiguration der realen Umgebung nicht; (b) `RATE_LIMIT_STORE` in Produktion auf `postgres` belassen (Standard), sobald mehr als eine Instanz läuft; (c) Lasttest nach docs/09 Ebene 8 und Restore-Probe; (d) der externe Penetrationstest, den docs/11 §5 ausdrücklich nicht ersetzt.

**Im Browser geprüft (angemeldet als QM):** `/dashboard`, `/search`, `/production-orders/{id}/dossier` samt ZIP-Export und Download, `/notifications`, `/sync/conflicts`, `/offline`. Die Prüfung fand zwei Fehler, die keine der anderen Kontrollen sehen konnte — siehe „pdfkit findet seine Schriftmetriken nicht" und „Der Seed legt nach dem ersten Login Doppelbenutzer an" unten.

**Weiterhin offen:** der vollständige Offline-Durchlauf (vorbereiten → offline arbeiten → synchronisieren). `sync.execute` liegt bei WORKER und INSPECTOR, nicht bei QM — mit einer QM-Sitzung antwortet `/api/v1/sync/bundle` korrekt mit `403`. Für die Prüfung braucht es eine Anmeldung als `worker.test`.

Die ersten 10 Architekturdokumente in `docs/` sind vor der Implementierung entstanden und sollten bei Unklarheiten zuerst konsultiert werden. `docs/11_OFFLINE_INVARIANT_REVIEW.md` ist anderer Art: ein Prüfbericht nach der Implementierung, entstanden aus dem von docs/10 geforderten Phase-5-Gate.

**ADRs:** vollständig — 001 (Auth), 002 (Offline-Speicher), 003 (Dateispeicher), 004 (Audit-Härtung), 005 (Signaturverfahren, in Phase 7 nachgeholt), 006 (Mandantenmodell), 007 (Export-Jobs, in Phase 6 nachgeholt). [ADR-005](docs/adr/ADR-005-signature-method.md) schreibt nur nieder, was seit Phase 3 gilt und worauf Code-Kommentare seither verwiesen (PIN + Audit-Trail, keine qualifizierte elektronische Signatur). Wer daran arbeitet, sollte vor allem zwei Punkte daraus kennen: der `signature_data`-Digest ist **keine** Signatur — er ist über keinen geheimen Schlüssel gebildet, die Zurechenbarkeit trägt der append-only Audit-Trail (ADR-004). Und es gibt **keine PIN-Fehlversuchssperre**; bei vier Stellen ist `STANDARD_API` mit 100/min dafür kein Ersatz.

---

## Lokale Umgebung starten

```bash
docker compose up -d postgres minio minio-init keycloak
pnpm install
pnpm exec prisma migrate deploy
pnpm exec tsx prisma/seed.ts
pnpm run dev
```

**Ports:** Postgres `5433`, MinIO `9010`/`9011` (Console), Keycloak `8081`, clamd `3310`, App `3000` (Standard) — siehe unten zu Portkonflikten.

`clamav` startet bewusst **nicht** mit — der erste Start lädt ~250 MB Signaturen und braucht Minuten. Wer am Upload-Pfad arbeitet oder den echten Scan sehen will:

```bash
docker compose up -d clamav
# warten, bis "healthy" (nicht "running" — clamd nimmt Verbindungen an,
# bevor seine Signaturen geladen sind):
docker compose ps clamav
# dann in der lokalen .env: MALWARE_SCANNER="clamav"
```

Ob der Scanner wirklich antwortet, sagt `GET /api/health/ready` unter `checks.malwareScanner` — nicht der Containerstatus.

**Demo-User** (Keycloak-Passwort für alle: `devpassword`), verknüpft über den `pending:<email>`-Mechanismus beim ersten Login (siehe `src/lib/auth/resolve-login.ts`):

| User                         | Rolle              |
| ---------------------------- | ------------------ |
| `admin.test@proquado.local`  | ADMIN              |
| `worker.test@proquado.local` | WORKER             |
| `pl.test@proquado.local`     | PROJECT_LEAD       |
| `qm.test@proquado.local`     | QUALITY_MANAGER    |
| `pm.test@proquado.local`     | PRODUCTION_MANAGER |

Seed legt zusätzlich ein Demo-Projekt (`PROJ-2026-0001`) mit Site, Customer und Product an. Er ist wiederholbar und darf jederzeit erneut laufen — **muss** er sogar, sobald ein Berechtigungsatom in `permissions-catalog.ts` dazukommt, denn nur `seedOrganizationRbac` trägt es in bestehende Organisationen ein (siehe „Der Seed legt nach dem ersten Login Doppelbenutzer an" unten).

**Bestätigungs-PIN der Demo-User: `1234`** (Seed setzt einen scrypt-Hash in `users.confirmation_pin_hash`). Ohne PIN kann ein Arbeitsschritt nicht bestätigt/abgeschlossen werden — echte Benutzer setzen ihre PIN selbst, geseedet wird sie nur für Demo/Test.

Ein durchgängiger Ausführungsflow braucht zusätzlich: Fertigungsplan mit Schritten + Anforderungen anlegen (PL) → einreichen (PL) → genehmigen (QM) → freigeben (PL) → Produktionsauftrag anlegen/einplanen/freigeben und einem Worker zuweisen (PM) → Worker sieht ihn unter **Meine Aufträge**.

Für den Qualitätsfluss zusätzlich: Prüfmittel unter **Prüfmittel** anlegen und kalibrieren (QM) — ohne gültige Kalibrierung wird eine Messung abgelehnt, sobald das Prüfmerkmal ein Prüfmittel verlangt. Gemeldete und automatisch erzeugte Abweichungen stehen unter **Abweichungen** (QM: bewerten → Sofortmaßnahme → Nacharbeit → Nachprüfung → Disposition). Die Nachprüfung kann nur ausführen, wer die Rolle INSPECTOR hat.

Für die Produktfreigabe: Akte des Auftrags öffnen, Abschnitt **9. Endprüfung und Produktfreigabe** — dort steht die Entscheidung, und als QM auch das Formular (Begründung + PIN). Freigeben geht erst, wenn der Auftrag abgeschlossen und nichts mehr offen ist; ablehnen jederzeit. Die neuen Atome `product_release.*` kommen nur über einen erneuten Seed-Lauf in bestehende Organisationen.

Für die Dokumentbindung: Dokument im Projekt anlegen, hochladen, einreichen (PL) → genehmigen und freigeben (QM) → im Fertigungsplan (Status DRAFT) beim Arbeitsschritt unter **Verbindliche Dokumente** die Revision auswählen, optional Seite und Markierung. Ohne freigegebene Revision im selben Projekt steht dort ein Hinweis statt einer leeren Auswahlliste. Nach dem Einreichen des Plans lässt sich nichts mehr binden oder entfernen.

Für die Akte: **Suche** öffnen, Seriennummer eingeben, beim Auftrag auf **Produktionsakte** — dort stehen dieselben zehn Abschnitte wie im PDF, darunter der Export. Das ZIP enthält Akte, Originalnachweise und `manifest.json`; der Downloadlink ist eine kurzlebige signierte URL. **Übersicht** und **Benachrichtigungen** sind rollenabhängig: wer nichts entscheiden darf, sieht keine offenen Entscheidungen.

Für den Offline-Fluss: **Offline** öffnen (registriert das Gerät beim ersten Aufruf mit Verbindung), **Für Offline vorbereiten** laden, Netzwerk trennen (DevTools → Network → Offline), Schritt starten/erfassen/lokal abschließen, Netzwerk wieder verbinden, **Jetzt synchronisieren**. Konflikte landen unter **Konflikte** (PL/QM entscheiden mit PIN). Der Service Worker läuft nur im Production-Build — in `next dev` würde er HMR-Antworten cachen, siehe `src/components/ServiceWorkerRegistration.tsx`.

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

### Eine bereits angewendete Migration nachträglich zu ändern, wird nicht bemerkt

In Phase 5 wurde eine Migration nach dem Anwenden auf die Dev-Datenbank noch einmal editiert (ein CHECK-Constraint um einen Wert erweitert). `prisma migrate status` meldete danach weiterhin „Database schema is up to date" — die Datei war neu, die Datenbank alt, und nichts wies darauf hin. Erst ein direkter Blick per `pg_get_constraintdef` zeigte den Unterschied.

**Regel:** Nach der Änderung einer bereits angewendeten Migration entweder `prisma migrate reset` (Dev-Daten weg) oder die Differenz von Hand nachziehen **und** die Prüfsumme aktualisieren:

```bash
docker exec -i proquado-postgres-1 psql -U proquado -d proquado -c "UPDATE _prisma_migrations SET checksum = '<shasum -a 256 der migration.sql>' WHERE migration_name = '<name>';"
```

Nebenbei: `docker exec` ohne `-i` verschluckt ein Here-Document stillschweigend — das SQL läuft dann gar nicht, ohne Fehlermeldung.

### pdfkit findet seine Schriftmetriken nicht, sobald Next.js es bündelt

Der erste Export im Browser scheiterte mit `ENOENT: … .next/server/vendor-chunks/data/Helvetica.afm`. pdfkit lädt die Metriken seiner Standardschriften zur Laufzeit von der Platte; Next.js' Server-Bundling schreibt das Modul um, nimmt die Datendateien aber nicht mit. Fix in `next.config.mjs`: `experimental.serverComponentsExternalPackages: ['pdfkit', 'archiver']`.

Bemerkenswert ist, **was das nicht gefunden hat**: Typecheck nicht, die Integrationstests nicht (Jest löst aus `node_modules` auf und bündelt nie), `next build` nicht (es ist ein Dateizugriff zur Laufzeit, kein Kompilierschritt). Nur das Öffnen der Seite. Gleiche Bauart wie der `pino-pretty`-Eintrag oben — bei Paketen, die zur Laufzeit eigene Dateien lesen, ist Bündeln die Standardfalle.

### Der Seed legt nach dem ersten Login Doppelbenutzer an

`seedDemoUsers` hatte seinen Upsert auf das Sentinel `pending:<email>` geschlüsselt. Das wird beim ersten SSO-Login durch die echte OIDC-Subject-ID ersetzt (`resolve_org_for_login`). Ein erneuter Seed-Lauf fand die Zeile also nicht mehr und legte **einen zweiten Benutzer mit derselben E-Mail** an; der kollidierte danach auf `employees.employee_number` und brach den Seed mittendrin ab — verwaistes Konto zurück, Demo-Fixtures nie erzeugt.

Aufgefallen ist es, weil ein erneuter Seed-Lauf genau der vorgesehene Weg ist, **neue Berechtigungsatome an bestehende Organisationen auszuliefern**: `seedOrganizationRbac` legt Permissions und Rollenzuordnungen per Upsert an, aber nichts im Deployment-Pfad ruft es automatisch auf. Wer ein Atom in `permissions-catalog.ts` ergänzt, muss den Seed nachziehen — sonst liefert die Anwendung `PERMISSION_DENIED` für eine Berechtigung, die im Code längst vergeben ist.

Zwei Korrekturen: der Seed sucht jetzt per `(organizationId, email)` und lässt `externalId` einer verknüpften Anmeldung unangetastet; und `users` hat einen Unique-Index auf `(organization_id, email)`, damit der Zustand gar nicht mehr entstehen kann. Die zugehörige Migration schlägt auf Installationen mit bestehenden Dubletten bewusst fehl — welches der beiden Konten die Audit-Historie behält, darf keine Migration stillschweigend entscheiden.

### Ein Test, der versehentlich echte Infrastruktur anspricht, beweist etwas anderes als sein Name

Ein Unit-Test für „ClamAV nicht erreichbar → ERROR" lief gegen das echte lokale MinIO und scheiterte schon beim Laden der Datei — das Ergebnis stimmte, der Grund nicht. Er hätte auch dann bestanden, wenn die Socket-Logik völlig kaputt gewesen wäre. Korrigiert: beide Abhängigkeiten zeigen auf geschlossene Ports, und der Testname nennt jetzt die Eigenschaft, die tatsächlich geprüft wird (Fail-Closed), nicht den Weg dorthin.

**Lehre:** Wenn ein Unit-Test unerwartet langsam ist oder Logzeilen aus einer echten Komponente erzeugt, ist er wahrscheinlich keiner mehr.

### ESM-only Abhängigkeiten brechen Jest **und** den Next-Build

`archiver@8` ist ESM-only. Beides scheiterte sofort: Jest (CJS) mit „Cannot use import statement outside a module", der Next-Build mit einem Webpack-Fehler im selben Paket. Der Rückweg auf `archiver@7` (CJS, `module.exports = archiver`) löste beides und brachte nebenbei die klassische Factory-API `archiver('zip', …)` zurück, die v8 durch Klassen ersetzt hatte.

**Regel:** Neue Server-Abhängigkeiten vor dem Einbau kurz gegen **beide** Läufe prüfen — `pnpm run build` und `pnpm run test:integration`. Ein `pnpm run typecheck` allein sagt darüber nichts: die Typen von `@types/archiver@8` waren einwandfrei, nur ließ sich das Paket nirgends laden.

### Jest entscheidet `skip` beim Einlesen, nicht beim Laufen

Der erste Anlauf der Scanner-Integrationstests wählte `it` oder `it.skip` anhand einer Erreichbarkeitsprüfung aus `beforeAll`. Ergebnis: alles übersprungen, obwohl clamd lief — Jest sammelt die Testliste beim Einlesen der Datei, `beforeAll` läuft danach. Die Variable war zum Entscheidungszeitpunkt noch `false`.

Die Korrektur ist aber nicht „früher prüfen", sondern **gar nicht prüfen**: `CLAMAV_TESTS=1` schaltet die Tests ein, und ist clamd dann nicht erreichbar, gehen sie **rot**. Ein probenbasiertes Überspringen macht „Abhängigkeit fehlt" und „Abhängigkeit ist kaputt" zum selben Zweig — der eine Lauf, der hätte rot werden müssen, wird still grün. Dieselbe Familie wie „Ein Test, der versehentlich echte Infrastruktur anspricht" weiter unten.

### Eine Kontrolle, die nur einen von zwei Pfaden kennt, deckt die Hälfte ab

Die manuelle Überprüfung der Offline-Invariante (docs/11) fand drei Mängel, die alle dieselbe Bauart haben: `deviceId` wurde im **Sync**-Pfad seit Phase 5 sauber gegen `assertDeviceActive` geprüft — und in den **gewöhnlichen** Endpunkten (Schritt starten, Nachweis erfassen, Abschluss melden) als `z.string().max(255)` entgegengenommen und nie nachgeschlagen. Folgen: die Fernsperre eines verlorenen Tablets galt online nicht; der Zählschlüssel des gerätebezogenen Rate Limits war ein frei wählbarer String, also kein Limit; und der Wert landete unverändert in vier Audit-Spalten ohne Fremdschlüssel.

Warum es keine Kontrolle sah: die zwölf Angriffstests aus `phase7-offline-invariant-attacks` gehen **alle** über `processSyncCommands`. Ein Angreifer, der die Sync-API gar nicht benutzt, war nie Gegenstand eines Tests. Die Invariante selbst hielt in jedem Fall — der Server glaubt dem Client nichts —, aber die flankierenden Kontrollen taten es nicht.

**Regel:** Wenn eine Kontrolle für eine Eingabe eingeführt wird, einmal `grep` über alle Stellen laufen lassen, die dieselbe Eingabe annehmen. Der Fix ist `resolveDeviceId` in `src/lib/api/device-context.ts` — eine Funktion, an einer Stelle, in allen neun Endpunkten.

### Relationsnamen bei bidirektionalen Prisma-Beziehungen

Ein echter Bug wurde beim Browser-Test gefunden: `PlanStep.predecessors`/`.dependents` waren so benannt, dass sie das Gegenteil dessen enthielten, was der Name suggeriert (Prisma-Rückrelationen benennen sich nach der Relation, nicht nach der eigenen Rolle). Umbenannt zu `predecessorLinks`/`successorLinks` mit erklärendem Kommentar direkt im Schema. **Lehre:** Bei selbstreferenzierenden n:m-artigen Relationen über ein Join-Modell (hier `PlanStepDependency`) immer explizit prüfen, welche Richtung eine Rückrelations-Array tatsächlich liefert — nicht vom Feldnamen ausgehen.

---

## Architekturentscheidungen mit Nachwirkung

- **`production_plan.release` ist Standard-Berechtigung von PROJECT_LEAD**, nicht nur konfigurierbar (`*` in der Matrix). Ohne diese Korrektur konnte niemand einen Plan freigeben — siehe `src/domain/identity/system-roles.ts` Kommentar für die Begründung (Masterprompt Kap. 3 weist Planerstellung/-freigabe der Projektleitung zu, anders als bei Dokumenten, wo QM die eindeutige Instanz ist).
- **Domain-Services prüfen ihre eigene Berechtigung**, nicht nur die aufrufende API-Route. Das macht sie gegen zukünftige Aufrufer (Tests, Skripte, andere Services) selbstverteidigend. Regelfall ist `assertPermission` als erste Zeile des Service; wo das benötigte Atom erst aus den Daten hervorgeht (Ausführung/Erfassung/Abschluss eines Arbeitsschritts), prüft `assertPermissionWithin` innerhalb der Transaktion — siehe „Berechtigung hängt manchmal von Daten ab" oben. Ungeprüft bleibt nichts.
- **Der Malware-Scan hat seit Phase 7 eine echte Implementierung** (`src/lib/storage/malware-scan.ts`) — Details unter „Der Malware-Scan-Stub ist in Produktion nicht mehr wählbar" weiter unten. In der lokalen Entwicklung läuft weiterhin der Stub (`MALWARE_SCANNER=stub`), der jede Datei durchwinkt; er ist nur dort erlaubt. Ein clamd-Dienst steht in `docker-compose.yml` (nicht im Standardstart, weil der erste Lauf Signaturen lädt); dass der Adapter mit einem echten clamd spricht, ist mit EICAR belegt — `CLAMAV_TESTS=1 pnpm run test:integration -- phase7-hardening`.
- **`/api/health/ready` meldet den Scanner, lässt ihn aber die Bereitschaft nicht kippen.** Der Scan schließt bei Ausfall (ERROR statt CLEAN), das ist richtig — aber still, bis jemand in der Halle ein Foto macht und abgewiesen wird. Deshalb fragt die Readiness `scanner.ping()`. Sie antwortet trotzdem mit **200 und `status: "degraded"`, nicht 503**: clamd ist für alle Instanzen gleichzeitig weg, ein 503 nähme also die ganze Anwendung aus der Rotation und machte aus „Nachweis-Uploads werden abgelehnt" ein „niemand kann mehr arbeiten". Alarmiert wird auf `checks.malwareScanner`, nicht auf dem HTTP-Status. `scannerKind` steht daneben, damit ein `"ok"` vom Stub nie als „ein Virenscanner läuft" gelesen wird.
- **Produktionsaufträge sind erst in Phase 3 entstanden**, obwohl `docs/10_MVP_PLAN.md` sie unter Phase 2 („Projekte, Produkte, Aufträge") listet. Phase 2 hat sie nicht implementiert; Phase 3 braucht sie als Träger der Arbeitsschrittinstanzen und holt das nach. Kein Scope-Verlust, nur eine verschobene Grenze.
- **Der Release Token ist beim Online-Flow optional.** `POST /work-steps/{id}/start` akzeptiert ihn, verlangt ihn aber nicht: Ein Online-Client hat keinen (die Freigabe geschah serverseitig beim Abschluss des Vorgängers), und der Server prüft stattdessen direkt seinen `work_step_releases`-Datensatz — was strikt stärker ist als jede Token-Prüfung. Der Token existiert für den Offline-Fall und wird, wenn mitgesendet, gegen denselben Datensatz verifiziert (Signatur, Schritt-ID, Nonce, Hash). Der Server speichert nur den Hash der Signatur, nie den Token selbst. Im Klartext verlässt er den Server an genau drei Stellen: bei der Freigabe (`releaseWorkStepInstance`, also über `releaseProductionOrder` und die Nachfolgerfreigabe), im Offline-Bundle und über `POST /work-steps/{id}/release-token`. Die letzten beiden prägen jeweils ein **neues** Token — siehe „Ein Release-Token wird pro Schritt genau einmal gültig gehalten" weiter unten.
- **`validateAndCompleteWorkStep` prüft keine Berechtigung.** Es ist eine Serveraktion, keine Benutzeraktion — der Server validiert seinen eigenen Posteingang, direkt nach der Abschlussmeldung des Mitarbeiters. Das Berechtigungsatom `completion_submission.validate` (QM/PL) gilt für die **manuelle** Re-Validierung über `POST /completion-submissions/{id}/validate`. Hätte man die Prüfung in den Automatikpfad gelegt, könnte kein WORKER je einen Schritt abschließen.
- **NOK in der Checkliste blockiert den Abschluss** (`step-requirements.ts`). Konservative Auslegung von Geschäftsgrundsatz 4: eine offene Abweichung ist kein Abschluss. Anders als bei Messwerten erzeugt Phase 4 hier **keine** automatische NCR — ein NOK ist zu unspezifisch für eine serverseitige Klassifikation. Der Mitarbeiter meldet die Abweichung über „Abweichung melden" (A9) oder korrigiert die Antwort. Eine automatische Verknüpfung NOK → NCR wäre denkbar, sobald Checklistenpunkte eine Fehlerart tragen.
- **`COMPLETION_REJECTED → IN_PROGRESS` ist eine bewusste Ergänzung** zum Automaten in `docs/03_STATE_MACHINES.md`. Der dokumentierte Automat kennt keinen Ausgang aus `COMPLETION_REJECTED`, wodurch eine fehlgeschlagene Validierung den Schritt — und damit den ganzen Auftrag — dauerhaft blockieren würde. Die abgelehnte Abschlussmeldung bleibt mit ihren Gründen historisch erhalten.
- **`BLOCKED → COMPLETED` und `BLOCKED → SUPERSEDED` sind die zweite Ergänzung** zu demselben Automaten, hinzugekommen mit Phase 5. Beide sind ausschließlich über eine protokollierte Konfliktentscheidung erreichbar (`src/domain/sync/decide-conflict.ts`): „Weiterhin gültig" schließt den Schritt mit seiner ursprünglichen Revisionsreferenz ab, „Wiederholung erforderlich" setzt ihn zugunsten eines neuen Versuchs außer Kraft. Beides sind docs/06-Ausgänge eines `REVISION_CONFLICT`; kein Gerät kann einen davon auslösen. Der Unit-Test in `work-step-status.test.ts` hält fest, aus **genau** welchen Zuständen `COMPLETED` erreichbar ist — er muss mitgeändert werden, wenn hier je etwas dazukommt.
- **Vier-Augen läuft über zwei Phasen.** Phase 3 endete bewusst bei `AWAITING_SECOND_APPROVAL` (Datensatz angelegt, Nachfolger gesperrt, keine Entscheidung möglich); Phase 4 hat die Entscheidung ergänzt: `decideSecondApproval` in `src/domain/quality/second-approval.ts`, mit PIN-Rückbestätigung. Erst die Zustimmung schließt den Schritt ab und gibt Nachfolger frei; eine Ablehnung erzeugt eine Begründung und lässt die ursprüngliche Ausführung erhalten.
- **Nacharbeit ist ein eigener Schritt, kein Wiederöffnen.** MASTERPROMPT Kap. 9 ist eindeutig: „Nacharbeit wird als eigener, mit Ursprung und NCR verknüpfter Schritt ausgeführt" und „Der ursprüngliche Schritt wird niemals … rückwirkend als fehlerfrei umgeschrieben." Deshalb hat `work_step_instances` seit Phase 4 `step_kind` (PRODUCTION/REWORK/REINSPECTION), `attempt_number` und `origin_work_step_instance_id`; der fehlerhafte Erstversuch bleibt dauerhaft `BLOCKED` in der Historie. Folge für die Nachfolgerfreigabe: **nur der jüngste Versuch je Planschritt zählt** (`releaseEligibleSuccessors`, `completeOrderIfFinished`) — sonst würde der gescheiterte Erstversuch den Auftrag für immer offen halten.
- **Die abgeleiteten Schritte erben die Anforderungen des Planschritts.** Eine Nachprüfung verlangt damit dieselben Checklisten/Fotos/Messwerte wie die Erstausführung. Das ist bewusst konservativ (eine Nachprüfung bestätigt genau die Merkmale, die beanstandet wurden), aber schwergängig. Sobald Anforderungen je Schritt-Art konfigurierbar sein sollen, gehört das in dieselbe Konfigurationsfläche wie die Prüferqualifikation (siehe unten).
- **Sperren blockieren die reguläre Produktion, nicht die Reparatur.** `assertNotBlockedForStep` nimmt Nacharbeits- und Nachprüfungsschritte von genau der Sperre aus, die zu ihrer NCR gehört — sonst könnte die Sperre nie aufgehoben werden, weil ihre Auflösung an ihr selbst scheitert. Jede andere Sperre gilt weiterhin.
- **Messwert außerhalb Toleranz erzeugt die NCR automatisch** — serverseitig, blockierend, beim **Abschluss** (nicht schon beim Erfassen: ein korrigierter Tippfehler darf keine Linie sperren). Idempotent je (Schritt, Prüfmerkmal) über einen partiellen Unique-Index, damit wiederholte Abschlussversuche keine NCR-Flut erzeugen. Masterprompt Kap. 22 D erlaubt „erzeugt **oder** verlangt" — hier bewusst „erzeugt".
- **Die Blockier-Klassifikation ist hart kodiert und konservativ** (`classifyBlocking` in `ncr-status.ts`): kritisch/hoch oder bestimmte Fehlerarten ⇒ blockierend. Ein Melder kann verschärfen, nie abschwächen; nur eine QM-Bewertung mit Begründung kann herabstufen. Eine konfigurierbare Regel-Engine steht in **keiner** Phase von docs/10 — Phase 6 ist Akte/Reporting/Integrationen — sie ist also ein Thema nach dem MVP. Bis dahin ist Raten in die falsche Richtung die einzige Fehlfunktion mit physischen Folgen.
- **`rework.execute` fehlte in `system-roles.ts`.** Die Matrix in docs/04 gibt es dem WORKER; die Phase-1-Transkription hatte es ausgelassen, was erst auffiel, als Phase 4 einen Nacharbeitsschritt starten wollte. Ergänzt.
- **Prüferqualifikation beim Vier-Augen-Prinzip ist noch nicht erzwungen.** `executor_id ≠ reviewer_id` (App **und** DB-Constraint), die zeitlich gültige Berechtigung (`user_roles.expires_at`) und die PIN-Rückbestätigung stehen. Die von Masterprompt Kap. 8 geforderte „passende Prüferqualifikation" lässt sich nicht prüfen, weil Planschritte kein Prüfer-Qualifikationsfeld haben — das ist eine Planungsmodell-Erweiterung, nicht ein vergessener Check.
- **`UNIQUE (organization_id, work_step_instance_id)` auf `completion_submissions` wurde entfernt.** docs/02 fordert sie, aber sie machte die Nachbesserung nach einem abgelehnten Abschluss unmöglich (`COMPLETION_REJECTED → IN_PROGRESS` → zweite Meldung ⇒ Constraint-Verletzung). Ein Phase-3-Bug, der erst durch den Phase-4-Regressionstest sichtbar wurde. Idempotenz hängt weiterhin am `idempotency_key`, wo sie hingehört.
- **Messtoleranz wird von der Datenbank nachgeprüft**, nicht nur vom Service: `measurement_results_tolerance_verdict_consistent` bindet `is_within_tolerance` an `measured_value` und die gespeicherten Grenzwerte. Die Grenzwerte werden bei der Erfassung vom Prüfmerkmal auf das Ergebnis **kopiert**, damit eine spätere Planrevision das Urteil einer bereits erfolgten Messung nicht rückwirkend ändert.
- **Der Sync-Cursor kommt nicht aus einer Postgres-Sequenz.** Eine Sequenz vergibt ihre Nummer beim INSERT, nicht beim COMMIT: zwei Transaktionen können 41 und 42 ziehen und in umgekehrter Reihenfolge committen. Ein Client, der dazwischen pollt, sieht 42, merkt sich Cursor 42 — und Ereignis 41 wird eine Millisekunde später sichtbar, hinter dem Cursor, für immer unzustellbar. Bei einem Strom, dessen Ereignisse „Schritt freigegeben" heißen, ist das ein Tablet, das den Folgeschritt nie entsperrt. Deshalb `sync_sequences`: ein Zählerdatensatz je Organisation, dessen Zeilensperre bis zum Commit gehalten wird, also ist Nummernreihenfolge = Commit-Reihenfolge. Preis: Outbox-Schreibvorgänge einer Organisation serialisieren. Falls das je zum Engpass wird, ist die Lösung ein Zähler je Produktionsauftrag — **nicht** die Rückkehr zur Sequenz. Siehe `src/domain/sync/outbox-sequence.ts`.
- **Der Revisionsvergleich sitzt in der normalen Abschlussvalidierung**, nicht im Sync-Pfad. docs/06 listet ihn unter den Bedingungen, die der Server beim Abschluss erneut prüft — und ein Online-Client kann genauso einen veralteten Dokumentsatz vor sich haben wie ein Offline-Gerät (eine Seite, die über eine Freigabe hinweg offen bleibt). Ein zweiter Erkennungspfad wäre eine zweite Gelegenheit, es falsch zu machen. Folge: `CompleteStepForm` sendet die angezeigten Revisions-IDs mit; ein leeres Feld heißt „keine Aussage" und löst deshalb keinen Konflikt aus, ein _überholte_ Bindung dagegen immer.
- **Die Outbox darf ohne Berechtigung zugestellt werden.** `processSyncCommands` prüft absichtlich **kein** `sync.execute` — ein Rechteentzug würde sonst offline erfasste Arbeit dauerhaft auf dem Tablet einsperren, während docs/06 ausdrücklich verlangt, dass sie erhalten bleibt und zur Entscheidung wird (Negativtest #5). _Angewendet_ wird trotzdem nichts ohne Berechtigung: jedes Kommando wird einzeln autorisiert und wird andernfalls zum `PERMISSION_REVOKED`-Konflikt mit unveränderter Nutzlast. Lesen (Changes, Offline-Bundle) bleibt hinter `sync.execute` — das gibt Daten heraus, statt sie entgegenzunehmen.
- **„Weiterhin gültig" überspringt keine Prüfungen.** Die Entscheidung lautet „die alte Revision ist weiterhin akzeptabel", nicht „Abschluss durchwinken": `acceptAsValid` schickt die Abschlussmeldung durch dieselbe `validateSubmissionWithin`, nur mit der Revisionsfrage als bereits beantwortet markiert. Ein Schritt mit fehlendem Pflichtfoto bleibt auch nach dieser Entscheidung abgelehnt.
- **`ACCEPT_AS_VALID` gibt es bei `PERMISSION_REVOKED` nicht.** docs/04 sagt, offline erfasste Arbeit nach Rechteentzug werde „nicht automatisch freigegeben" — und sie stellvertretend durchzuwinken ist derselbe Vorgang mit einer anderen Unterschrift darunter. Möglich bleiben Zusatzprüfung oder Verwerfen der Abschlussmeldung; die erfassten Nachweise bleiben in beiden Fällen erhalten.
- **`devices` hat jetzt `organization_id` und eine RLS-Policy.** Die Phase-1-Migration hatte notiert, Mandantentrennung für `devices`/`sessions` laufe „bis zu einer eigenen Policy" auf Anwendungsebene. Phase 5 ist der erste Verwender und schließt die Lücke für `devices`; `sessions` bleibt offen (kein Verwender).
- **Berechtigungsatome, die nicht in docs/04 stehen.** `sync.execute`, `sync_conflict.view`, `sync_conflict.decide` und `device.manage` sind in Phase 5 dazugekommen. docs/04 beschreibt das Verhalten („erfordert manuelle Entscheidung durch berechtigte Person"), benennt aber nicht das Atom, das „berechtigt" definiert. Vergabe: `sync.execute` an WORKER und INSPECTOR, `sync_conflict.decide` an die beiden Rollen, die docs/06 bei einem Konflikt benachrichtigt (PROJECT_LEAD, QUALITY_MANAGER), `device.manage` an ADMIN. In Phase 7 kamen `product_release.decide` und `product_release.view` dazu (siehe unten). Dieselbe Art Abweichung wie bei `production_plan.release` weiter oben — dokumentiert, nicht stillschweigend.
- **`sync_commands.status` kennt ein `PENDING`, das docs/05 nicht hat.** docs/05 definiert vier _Antwort_-Status (ACCEPTED/REJECTED/CONFLICT/DUPLICATE); `PENDING` wird nie an einen Client gesendet. Es ist die Zeile, die **vor** der Ausführung geschrieben wird, damit ein Absturz zwischen „angewendet" und „quittiert" eine Spur hinterlässt statt gar nichts — der Wiederholungsversuch findet sie und führt idempotent erneut aus, statt ein unfertiges Kommando für ein Duplikat zu halten.
- **`step_document_bindings` bekam erst in Phase 5 einen Service, die UI erst in Phase 7.** docs/10 listet die Schritt-Dokumentbindung unter Phase 2; das Modell entstand dort, der Service nicht. Abnahmeszenario C ist vollständig über diese Bindungen definiert und war ohne ihn aus der Anwendung heraus gar nicht herstellbar — daher `bindDocumentToPlanStep`. Der Planungsbildschirm bietet die Bindung jetzt an (Auswahl, Seite, Markierung) und erlaubt das Entfernen, solange die Revision DRAFT ist.
- **Zur Auswahl stehen nur freigegebene Revisionen des Projekts, zu dem der Plan gehört** (`listBindableDocumentRevisions`). Nur RELEASED, weil der Service nichts anderes annimmt — alles andere wäre eine Auswahlliste voller Einträge, die der Server ablehnt. Nur das eigene Projekt, weil ein fremdes Dokument für diesen Plan nicht verbindlich sein kann. Wer `document.view` nicht hat, bekommt eine leere Liste statt eines Fehlers, und **nicht** die Anzahl dessen, was er nicht sehen darf — dieselbe Regel wie bei der Suche.
- **Eine Revision darf je Schritt nur einmal gebunden werden** (Unique-Index + Prüfung im Service). Das war implizit, solange der einzige Aufrufer ein Test war; mit einem Knopf davor ist ein Doppelklick eine Dublette. Und Dubletten sind hier nicht kosmetisch: `hashIdSet` hasht die sortierte Liste der gebundenen Revisions-IDs in den `documentSetHash`, der in jedem Release Token steckt — eine wiederholte ID ändert diesen Hash, ohne dass sich der Dokumentsatz geändert hat.
- **Entfernen löscht, statt zu markieren — weil es nur im DRAFT geht.** `loadEditableStep` sperrt den Vorgang ab, sobald die Revision eingereicht ist. Ein nie freigegebener Plan hat keine Ausführungshistorie zu schützen, und nichts stromabwärts konnte die Bindung je referenzieren. Jede freigegebene Revision bleibt unangetastet — genau das schützt Geschäftsgrundsatz 6. Das Audit-Event trägt die entfernten Werte, die Löschung ist also selbst rekonstruierbar.
- **Ein Release-Token wird pro Schritt genau einmal gültig gehalten.** Der Server speichert nur den Hash der Signatur, kann ein ausgegebenes Token also nicht erneut herausgeben — die Auslieferung ans Gerät prägt ein **neues** und ersetzt den Hash, wodurch das vorherige ungültig wird. Gewollt: ein verlorenes Tablet kann nicht weiter an einem Schritt arbeiten, der inzwischen auf einem anderen Gerät liegt.
- **Der Offline-Arbeitsbereich ist bewusst eine einzelne clientseitig gerenderte Seite** (`/offline`). Alle übrigen Seiten sind Server Components und brauchen einen Netzwerk-Roundtrip, um überhaupt etwas anzuzeigen — genau das fehlt in der Halle, für die dieser Bildschirm gedacht ist.
- **Die Produktionsakte wird nie gespeichert, sondern bei jedem Aufruf neu abgeleitet.** Masterprompt Kap. 10 nennt sie einen „reproduzierbaren Nachweis des tatsächlichen Herstellungsverlaufs" — ein einmal gespeicherter Schnappschuss würde weiter mit sich selbst übereinstimmen, nachdem die Primärdaten weitergezogen sind, und genau das darf ein Auditdokument nicht. Festgehalten wird stattdessen der **Zeitpunkt**: `data_as_of` sagt, wann gelesen wurde, `template_version`, welches Layout gerendert hat. Damit ist „warum sieht das PDF von März anders aus" beantwortbar, ohne die Daten einzufrieren.
- **Das Manifest führt zwei Hashes je Datei, nicht einen.** `declaredSha256` ist, was die Datenbank bei der Annahme festgehalten hat; `actualSha256` ist, was der Export über die tatsächlich gepackten Bytes gerechnet hat. Abnahmeszenario F behauptet, dass diese beiden übereinstimmen — sie gleichzusetzen hieße, die Behauptung vorauszusetzen. Weichen sie ab, wandert die Datei **trotzdem** ins Archiv und der Eintrag bekommt `MISMATCH`: sie wegzulassen würde eine Beschädigung verstecken, die ein Auditor zu Recht finden will. Fehlt die Datei im Objektspeicher ganz, steht `MISSING` im Manifest.
- **Exporte laufen synchron hinter einem Job-Datensatz** — [ADR-007](docs/adr/ADR-007-export-job-processing.md). docs/10 empfahl BullMQ/Redis, entschieden war das nie (es gab kein ADR-Dokument). Für eine Akte je Auftrag zahlt sich eine Warteschlange nicht aus; der Job-Datensatz macht die spätere Umstellung zum Austausch **eines** Funktionsaufrufs, ohne Datenmodell-Umbau. Harte Grenzen (500 Nachweisdateien, 512 MB) fangen den Fall ab, für den die Queue gedacht war.
- **Benachrichtigungen werden beim Lesen verteilt, nicht von einem Worker.** Konsequenz aus ADR-007: `dispatchPendingNotifications` arbeitet die Outbox-Zeilen mit `processed = false` ab, wenn jemand seine Benachrichtigungen öffnet. Das ist spät, aber nie falsch — nichts hängt für die Korrektheit an einer Benachrichtigung, und der Unique-Key `(organization, user, sourceEvent)` macht wiederholtes Verteilen zum No-op statt zum Duplikat. Der `processed`-Flag ist genau dafür da; der Gerätesync benutzt `sequence` und bleibt davon unberührt.
- **Die Empfängerliste einer Benachrichtigung ist kurz gehalten.** Jedes Ereignis in `RULES` unterbricht jemanden, und ein Benachrichtigungscenter voller Routinefortschritt ist eines, das niemand liest — was genau die Konflikte und Sperren kostet, für die es existiert. Adressiert wird an **Benutzer**, nicht an Rollen: wer etwas wissen muss, hängt an Zuweisung und Berechtigung im Moment des Ereignisses, und das später aufzulösen ergäbe eine andere Antwort als die, die galt.
- **Die Suche meldet nie, wie viele Treffer sie verborgen hat.** Eine Zahl unterdrückter Ergebnisse ist selbst eine Auskunft — „es gibt 3 Dokumente, die Sie nicht sehen dürfen" verrät, dass es sie gibt. Jeder Ergebnistyp hängt zusätzlich an der Berechtigung, die sein Lesen regelt: ein WORKER, der eine Seriennummer sucht, bekommt Aufträge, keine Dokumente.
- **Der Malware-Scan-Stub ist in Produktion nicht mehr wählbar.** Bis Phase 7 lieferte `getMalwareScanner()` in _jeder_ Umgebung einen Scanner, der immer `CLEAN` meldete; zwischen dem und einem Produktivbetrieb stand ein Kommentar, das jemand lesen musste. Eine Kontrolle, die vom Erinnern abhängt, ist keine. Jetzt: `MALWARE_SCANNER=clamav` spricht echtes clamd (INSTREAM, ohne Client-Bibliothek — im Sicherheitspfad wäre das eine Abhängigkeit zu viel), `stub` wird bei `NODE_ENV=production` mit hartem Fehler abgelehnt. Ein nicht erreichbarer Scanner liefert `ERROR`, nie `CLEAN`: Aufrufer akzeptieren nur `CLEAN`, ein Ausfall blockiert also Uploads, statt sie durchzuwinken.
- **Eine `deviceId` aus dem Request ist erst ein Gerät, wenn der Server sie nachgeschlagen hat.** `resolveDeviceId` (`src/lib/api/device-context.ts`) verlangt UUID, Existenz, Eigentümerschaft und Nicht-Sperrung — dieselbe Prüfung, mit der die Sync-Endpunkte seit Phase 5 öffnen, jetzt überall dort, wo das Feld angenommen wird. Ohne `deviceId` (der normale Browser) bleibt alles wie zuvor. Siehe „Eine Kontrolle, die nur einen von zwei Pfaden kennt" oben und docs/11 B-1 bis B-3.
- **Ein Benutzer darf höchstens `MAX_ACTIVE_DEVICES_PER_USER` (10) aktive Geräte haben.** Keine Komfortgrenze: `SYNC_COMMANDS` und `PHOTO_UPLOAD` zählen je Gerät, eine unbegrenzte Registrierung ist also ein unbegrenztes Kontingent — und ein Sync-Batch löst bis zu 500 vollständige serverseitige Neuvalidierungen aus. Gesperrte Geräte zählen nicht mit, damit der Ersatz eines verlorenen Tablets nie an der Grenze scheitert.
- **`STANDARD_API` wird in `requireAuthContext` gezählt, nicht je Route.** Das Limit stand seit Phase 1 in docs/05 und war bis zur Überprüfung nirgends durchgesetzt — unter anderem war `GET /sync/bundle` ungedrosselt, das für jeden READY-Schritt jedes zugewiesenen Auftrags ein neues Token prägt und ein Audit-Event schreibt. Zentral, weil jeder authentifizierte Einstiegspunkt seinen Actor darüber auflöst und deshalb keiner vergessen werden kann. Folge auf der Clientseite: `pullAndApplyChanges` hat eine Seitenobergrenze je Lauf (`MAX_PAGES_PER_SYNC`) — der Cursor wird je Seite gesichert, ein früher Abbruch ist also Fortsetzung, kein Verlust.
- **Rate Limits zählen in Produktion in einer gemeinsamen Tabelle, sonst im Prozess.** Der In-Memory-Zähler ist auf einer Instanz eine echte Grenze; hinter N Repliken erlaubt er das N-fache — eine echte Abschwächung, keine Rundung. `PostgresRateLimitStore` (`rate_limit_windows`) zählt instanzübergreifend; die Entscheidung fällt über `RATE_LIMIT_STORE`, Standard ist `postgres` in Produktion und `memory` sonst. Die Voreinstellung liegt auf dieser Seite, weil die Fehlerfolgen ungleich sind: ein geteilter Speicher in der Entwicklung kostet eine Abfrage, die niemand merkt — prozesslokale Zähler in einer skalierten Produktion vervielfachen still jedes Limit aus dem Vertrag. Postgres statt Redis, weil ADR-007 Redis aus dem MVP heraushält und die Datenbank ohnehin die Verfügbarkeitsuntergrenze der ganzen Anwendung ist. Gegen unauthentifizierte Fluten hilft das nicht — das ist Sache des vorgelagerten Proxys (docs/08).
- **`RateLimitStore.hit` ist asynchron, und das war der eigentliche Punkt.** Die Schnittstelle war synchron, und der Kommentar daneben behauptete, ein gemeinsamer Speicher sei „**eine** Implementierung, kein Umbau" — was nicht stimmte: kein Speicher, der über Netz oder Datenbank geht, erfüllt einen synchronen Vertrag. Die Abstraktion verhinderte genau den Austausch, für den sie da war. Folge: `assertWithinRateLimit` muss überall awaited werden.
- **`rate_limit_windows` steht bewusst außerhalb von RLS und trägt keine `organization_id`.** Ein Limit ist eine Eigenschaft des Aufrufers, nicht der Daten eines Mandanten, und die Tabelle wird in `requireAuthContext` gelesen — also in der Funktion, die den Organisationskontext überhaupt erst herstellt. Ein Kontextzwang wäre zirkulär. Damit sie trotzdem keine mandantenübergreifende Liste gerade aktiver Benutzer ist, wird als Schlüssel der SHA-256 von `<Kategorie>:<Subjekt-ID>` gespeichert, nicht die ID: die Anwendung schlägt ausschließlich Schlüssel nach, die sie selbst berechnet hat, das Hashen kostet also nichts.
- **Der Aktenfortschritt im Dashboard zählt nur serverbestätigte Schritte.** docs/07 B1 schreibt es vor, und es ist dieselbe Invariante wie überall sonst: lokal abgeschlossene Schritte erscheinen getrennt als `pendingSteps` und gehen nie in die Prozentzahl ein. Gezählt wird außerdem nur der jüngste Versuch je Planschritt — dieselbe Regel wie in `releaseEligibleSuccessors`, damit das Dashboard der Ausführung nicht widersprechen kann.
- **Der Audit-Auszug der Akte ist auf die Ressourcen des Auftrags eingegrenzt.** Eine Akte, die organisationsweite Ereignisse mitliefert, wäre nicht gründlich, sondern ein Datenschutzproblem (docs/08).
- **Die Produktfreigabe ist seit Phase 7 ein eigener Vorgang** (`product_releases`, `src/domain/quality/product-release.ts`). Abschnitt 9 der Akte rechnet weiterhin zusammen, ob etwas offen ist — aber `releasable` heißt jetzt ausdrücklich „die Voraussetzungen sind erfüllt", nie „es wurde freigegeben". Das ist `decision`, und die ist null, solange niemand entschieden hat. Abgeschlossen ist nicht freigegeben.
- **Die Grundlage der Freigabe wird kopiert, nicht bei jedem Lesen neu gerechnet.** `basis_*` hält fest, was zum Entscheidungszeitpunkt galt (Auftragsstatus, offene blockierende Abweichungen, aktive Sperren, abgeschlossene/gesamte Schritte). Dieselbe Begründung wie beim Kopieren der Toleranzgrenzen auf ein Messergebnis: eine spätere Datenänderung darf die Grundlage einer bereits getroffenen Entscheidung nicht rückwirkend umschreiben. Ein Integrationstest hält genau das fest.
- **Freigeben geht genau einmal, Ablehnen beliebig oft.** Die Tabelle ist mehrzeilig, weil „abgelehnt → Nacharbeit → freigegeben" der Normalfall ist und eine wegeditierbare Ablehnung kein Nachweis wäre. Ein partieller Unique-Index lässt höchstens **eine** `RELEASED`-Zeile je Auftrag zu; der Service weist danach auch eine Ablehnung ab. Eine erteilte Freigabe zurückzunehmen ist ein Rückruf, keine Korrektur — und es ist nicht Aufgabe dieses Dienstes, das eine wie das andere aussehen zu lassen.
- **Eine Freigabe wird nie abgeleitet.** Der Server verweigert sie, solange der Auftrag nicht `COMPLETED` ist oder eine blockierende Abweichung oder Sperre offen ist — aber das Erfüllen dieser Bedingungen _erzeugt_ keine Freigabe, es macht eine nur möglich. Ablehnen bleibt jederzeit möglich: ein Produkt zurückzuweisen ist genau das, was man tut, solange etwas nicht stimmt.
- **`product_release.decide` liegt allein bei QM, `product_release.view` bei allen lesenden Rollen.** docs/04 nennt das Atom nicht — Masterprompt Kap. 10 beschreibt den Abschnitt der Akte, sagt aber nicht, wer entscheidet, weil bisher niemand entschied. Vergeben nach derselben Begründung, die docs/04 bei Dokumenten benutzt: wo QM die eindeutige Instanz ist, ist es die einzige. Dieselbe Art Abweichung wie bei `sync.execute` — dokumentiert, nicht stillschweigend. **Seed nachziehen nicht vergessen**, sonst liefert die Anwendung `PERMISSION_DENIED` für eine Berechtigung, die im Code längst vergeben ist.

---

## Test-Kommandos

Die vollständige Kette, in dieser Reihenfolge — jede Stufe findet etwas, das die vorherige nicht sieht:

```bash
pnpm run typecheck          # Sekunden
pnpm run lint
pnpm run format:check
pnpm run test:unit          # 165 Tests, keine Infrastruktur nötig
pnpm run build              # Kompilier- UND Bündelungsprüfung
pnpm run test:integration   # 102 Tests, echte Postgres+MinIO-Container (Testcontainers)
```

Drei Tests laufen zusätzlich gegen ein echtes clamd und sind deshalb ausdrücklich einzuschalten — sie gehen **rot**, wenn keins antwortet (siehe „Jest entscheidet `skip` beim Einlesen" oben):

```bash
docker compose up -d clamav   # warten bis "healthy"
CLAMAV_TESTS=1 pnpm run test:integration -- phase7-hardening
```

Alle Integrationstests laufen gegen **echte** Infrastruktur, nicht gegen Mocks — siehe `docs/09_TEST_PYRAMID.md`.

**Auch diese Kette ist nicht vollständig.** Zwei Fehler in Phase 6/7 waren erst im Browser sichtbar: die fehlenden pdfkit-Schriftmetriken (nur beim Bündeln, nicht beim Kompilieren) und die Doppelbenutzer des Seeds (nur mit einer echten, eingeloggten Sitzung). Wer an UI oder an Paketen arbeitet, die zur Laufzeit Dateien lesen, sollte die Seite einmal wirklich öffnen.

### Abgedeckte Negativtests (alle 15 grün)

Jede Zeile nennt die Testdatei ausdrücklich — kein „ebd."-Verweis, weil sich beim Ergänzen von Phase 5 die Bezugszeilen verschoben haben und ein solcher Verweis dann still auf die falsche Datei zeigt.

| #   | Test                                                              | Wo                                                                               |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Folgeschritt nach lokalem Abschluss nicht startbar                | `phase3-execution` + `phase5-offline-sync` (Sync-Pfad)                           |
| 2   | Gefälschter/fremder Release Token abgewiesen                      | `phase3-execution` + `phase5-offline-sync` + `lib/security/release-token.test`   |
| 3   | Doppelte Abschlussmeldung → genau ein Abschluss + ein Audit-Event | `phase3-execution` + `phase5-offline-sync` (ganzer Batch erneut)                 |
| 4   | Dokumentrevision während Offline geändert → Konflikt              | `phase5-offline-sync`                                                            |
| 5   | Rechteentzug vor Sync → Daten bleiben, Entscheidung nötig         | `phase5-offline-sync`                                                            |
| 6   | Fotoanforderung nicht erfüllt → Abschluss abgelehnt               | `phase3-execution`                                                               |
| 7   | Hash-Mismatch bei Foto- und Dokumentupload                        | `phase3-execution` + `phase2-documents-plans` + `phase5-offline-sync` (Chunk)    |
| 8   | Messwert außerhalb Toleranz (Service **und** DB-Constraint)       | `phase3-execution`                                                               |
| 9   | Ausführender ≠ Prüfer (Service **und** DB-Constraint)             | `phase4-quality` + `phase3-execution`                                            |
| 10  | Offene blockierende NCR → Nachfolger bleibt gesperrt              | `phase4-quality`                                                                 |
| 11  | Abgelaufenes/gesperrtes Prüfmittel → Messung abgelehnt            | `phase4-quality`                                                                 |
| 12  | Objekt-ID einer fremden Organisation → kein Datenleck             | `phase3-execution` + `rbac-audit-tenant` + `phase5-offline-sync` (Ereignisstrom) |
| 13  | Parallele Syncs auf dieselbe Entität → Versionskonflikt           | `phase5-offline-sync`                                                            |
| 14  | Serverausfall nach Upload, vor Quittung → Resume ohne Duplikat    | `phase5-offline-sync`                                                            |
| 15  | Plan mit Zyklus → Validierungsfehler                              | `phase2-documents-plans`                                                         |

Die Offline-Invariante hat seit Phase 7 zusätzlich eine eigene **Angriffssuite**: `test/integration/phase7-offline-invariant-attacks.integration.test.ts` versucht in zwölf Varianten, `COMPLETED` clientseitig zu erzwingen oder einen gesperrten Folgeschritt zu öffnen — gefälschte Kommandotypen, in gültige Kommandos geschmuggelte Statusfelder, manipulierte und korrekt signierte Fremdtoken, umsortierte Batches, wiederholte Abschlüsse. Bemerkenswert dabei: ein auf den Folgeschritt umgebogenes Token scheitert an `WORK_STEP_NOT_READY`, nicht an der Tokenprüfung — die Statusprüfung liegt davor, die Ablehnung hängt also nicht daran, dass die Kryptografie funktioniert.

Fünf weitere Fälle unter „Angriff: Geräteidentität behaupten statt nachweisen" sind aus der manuellen Überprüfung (docs/11) entstanden und prüfen genau das, was den zwölf fehlte: den Weg **an der Sync-API vorbei**.

Sechs davon (#1, #2, #6, #8, #15 und die Client-Typsicherheit aus docs/06 — der Client kennt `COMPLETED` gar nicht) haben zusätzlich Unit-Tests, die ohne Infrastruktur laufen. Die Zuordnung lässt sich jederzeit nachprüfen, weil jeder Test den Marker im Klartext trägt:

```bash
grep -rn "Negativtest #" --include='*.test.ts' test/integration src
```

---

## Übergabe: woran man als Nächstes arbeiten kann

Nach Reihenfolge des Nutzens, nicht der Mühe. Die Gates vor dem Piloten sind abgearbeitet, bis auf das, was keine Programmierarbeit ist (siehe „Stand" oben) — hier stehen die bekannten Lücken.

1. **Offline-Durchlauf im Browser prüfen.** Als `worker.test` anmelden, „Für Offline vorbereiten", Netzwerk trennen, Schritt lokal abschließen, wieder verbinden, synchronisieren. Nie vollständig durchgespielt worden; die Serverseite ist durch `phase5-offline-sync` abgedeckt, die Client-Schleife nur durch Unit-Tests.

2. **PIN-Fehlversuchssperre.** Der erste Punkt, den ADR-005 selbst als offensichtlichste Lücke nennt: eine vierstellige PIN hinter einem Limit von 100 Anfragen pro Minute ist schwächer, als es aussieht. Ein Zähler je Benutzer mit wachsender Wartezeit — `rate_limit_windows` steht bereits als gemeinsamer Speicher zur Verfügung.

3. **ERP/Webhook-Adapter** aus Phase 6 — docs/10 führt ihn als „optional für MVP". Sinnvoll erst, wenn ein realer Konsument existiert, an dem sich das Interface bewähren kann.

### Arbeitsweise, die sich in diesem Projekt bewährt hat

- Vor jeder Phase die zugehörigen `docs/`-Kapitel lesen; sie sind vor dem Code entstanden und enthalten die Begründungen.
- Abweichungen von `docs/` **hier** festhalten, nicht stillschweigend umsetzen — der Abschnitt „Architekturentscheidungen mit Nachwirkung" ist genau dafür da und hat mehrfach Widersprüche sichtbar gemacht.
- Am Ende jeder Phase die vollständige Prüfkette laufen lassen **und** die betroffenen Seiten einmal im Browser öffnen.
- Bei jedem gefundenen Fehler zusätzlich fragen, warum die vorhandenen Kontrollen ihn nicht gesehen haben — die drei lehrreichsten Einträge unter „Bekannte Stolpersteine" sind so entstanden.
