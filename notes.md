# Entwicklungsnotizen

Praktische Hinweise für die lokale Arbeit an ProQuaDo, ergänzend zu `docs/` (Architektur) und den ADRs. Diese Datei ist ein lebendes Arbeitsdokument, kein verbindliches Spezifikationsdokument.

---

## Stand

- **Phase 1 (Fundament)**: abgeschlossen — Auth (OIDC/Keycloak), RBAC/ABAC, Mandantentrennung via RLS, Audit-Trail, CI-Pipeline.
- **Phase 2 (Dokumente und Planung)**: abgeschlossen — Projekte, Dokument-Freigabeworkflow, Fertigungsplan mit Zyklenerkennung, Objektspeicher (S3/MinIO), funktionale UI.
- **Phase 3 (Online-Ausführung)**: abgeschlossen — Produktionsaufträge, Auftragszuweisungen, serverseitige Schrittfreigabe mit Release Token, Tablet-UI (Checkliste/Foto/Messwert/PIN-Bestätigung), Abschlussvalidierung und Nachfolgerfreigabe. Abnahmeszenario A läuft end-to-end (Integrationstest).
- **Phase 4 (Qualität)**: abgeschlossen — NCR mit serverseitiger Blockier-Klassifikation, Produktionssperren, Nacharbeit/Nachprüfung als eigene Schrittinstanzen, Prüfmittel + Kalibrierungs-Gate, Vier-Augen-Entscheidung, Revisionsauswirkungsanalyse. Abnahmeszenarien D und E laufen end-to-end (Integrationstest).
- **Phase 5 (Offline und Synchronisation)**: abgeschlossen — Geräteregistrierung mit Fernsperre, commit-geordneter Ereignis-Cursor, Sync-API (health/commands/changes/bundle), Release-Token-Auslieferung ans Gerät, verschlüsselte IndexedDB mit Outbox, chunk-basierter Foto-Upload mit Wiederaufnahme, alle sieben Konflikttypen im Konfliktcenter. Abnahmeszenarien B und C laufen end-to-end; **alle 15 Negativtests sind grün**.
- **Phase 6 (Akte, Reporting, Integrationen)**: abgeschlossen — digitale Produktionsakte mit allen zehn Abschnitten aus Masterprompt Kap. 10, PDF-Erzeugung, ZIP-Export mit hashgeprüftem Manifest, Rückverfolgbarkeitssuche, Dashboard und ereignisgetriebene In-App-Benachrichtigungen. Abnahmeszenario F läuft end-to-end. Die ERP-/Webhook-Grundlage, die docs/10 hier als „optional für MVP" führt, ist in Phase 7 nachgeholt worden — **ohne** dass ein Konsument existiert, was ihr Design prägt (ADR-008).
- **Phase 7 (Pilot und Härtung)**: weit fortgeschritten.
  - _Sicherheit_: **manuelle Überprüfung der Offline-Invariante durchgeführt und protokolliert** ([docs/11](docs/11_OFFLINE_INVARIANT_REVIEW.md)); Geräteidentität wird überall verifiziert statt nur angenommen; Obergrenze aktiver Geräte je Benutzer; `STANDARD_API` erstmals durchgesetzt; Rate Limits instanzübergreifend (`rate_limit_windows`); **PIN-Fehlversuchssperre** ([ADR-005](docs/adr/ADR-005-signature-method.md)-Nachtrag); echter ClamAV mit EICAR-Nachweis und Readiness-Meldung; 17 Angriffstests gegen die Invariante; **CSP auf Nonce umgestellt**, weil die bisherige in Production die Hydration verhinderte.
  - _Funktion_: **Produktfreigabe als eigener Vorgang** — Abschnitt 9 der Akte nennt jetzt eine Entscheidung mit Person, Zeitpunkt, Begründung und kopierter Grundlage, statt nur zusammenzurechnen, ob etwas offen ist; **UI für die Schritt-Dokumentbindung**; **Abmeldung** samt Benutzerwechsel auf geteilten Geräten.
  - _Integration_: **ERP-/Webhook-Anbindung** — Outbox-Ereignisse signiert an registrierte Endpunkte, mit SSRF-Schutz, Wiederholungen und sichtbarem Scheitern ([ADR-008](docs/adr/ADR-008-outbound-integrations.md)).
  - _Prüfbarkeit_: **E2E-Tests nach docs/09 Ebene 6** — Playwright, und zwar gegen den **Production-Build**, nicht gegen `next dev`. Damit ist die Schicht, in der fast jeder Fehler dieser Phase saß (Server Action, Formularzustand, Hydration), erstmals automatisiert geprüft statt nur von Hand durchgespielt. Dazu **Ebene 9** (axe-core) über dieselben Bildschirme: keine Verstöße bis WCAG 2.2 AA, einschließlich `target-size` — die Zielgrößenregel, an der eine Tablet-Oberfläche für Handschuhe am ehesten scheitern würde. Inzwischen stehen auch **Ebene 8** (Lasttest) und **Ebene 10** (Restore-Probe) als eigene Kommandos — damit ist die Testpyramide aus docs/09 vollständig.
  - _Dokumentation_: ADR-005 nachgeholt, ADR-001 um die Sitzungsdauer ergänzt, ADR-008 neu.
  - Der Rest von Phase 7 ist überwiegend keine Programmierarbeit (Pilot an einer realen Linie, Schulung, externer Penetrationstest, Restore-Probe, kontrollierter Rollout).

  - _Werkzeugkette_: Node **≥ 22.13**, **Next 15** mit React 19, **Prisma 7** (Treiber-Adapter statt Rust-Engine), **ESLint 9** im Flat-Format, pino 10. Alles an einem Tag angehoben, jedes für sich geprüft — die Begründungen stehen unter „Architekturentscheidungen mit Nachwirkung", die Messwerte beim Lasttest.
  - _Repository_: **öffentlich**, mit Branch Protection auf `main` (alle fünf CI-Jobs erforderlich, `enforce_admins`), CodeQL, Dependabot und Secret Scanning samt Push Protection. Direkte Pushes auf `main` gehen nicht mehr; alles läuft über PRs.

  **Bemerkenswert an dieser Phase**: nahezu jeder gefundene Fehler lag **nicht** im Domänendienst, sondern in der Schicht darüber (Server Action, Formular, Client-Zustand) oder in der Kombination einzeln korrekt getesteter Bausteine. Keiner davon war durch Typecheck, Unit-, Integrationstests oder `next build` sichtbar; gefunden hat sie durchweg das Durchspielen im Browser. Die Liste steht unter „Bekannte Stolpersteine", die Konsequenz als Arbeitsregel am Ende.

- **Vor dem Piloten weiterhin offen, und nichts davon ist Programmierarbeit**: (a) `MALWARE_SCANNER=clamav` samt erreichbarer clamd-Instanz in der **Zielumgebung** setzen — Dienst, Adapter, Readiness-Check und EICAR-Nachweis stehen, die Konfiguration der realen Umgebung nicht; (b) `RATE_LIMIT_STORE` in Produktion auf `postgres` belassen (Standard), sobald mehr als eine Instanz läuft; (c) **erledigt** — Lasttest und Restore-Probe sind umgesetzt und gelaufen (siehe die gleichnamigen Abschnitte unter den Test-Kommandos); in der Zielumgebung bleibt zu tun, die Probe gegen das **echte** Backup-Verfahren zu fahren statt gegen ein im Test erzeugtes; (d) der externe Penetrationstest, den docs/11 §5 ausdrücklich nicht ersetzt.

**Im Browser geprüft (angemeldet als QM):** `/dashboard`, `/search`, `/production-orders/{id}/dossier` samt ZIP-Export und Download, `/notifications`, `/sync/conflicts`, `/offline`. Die Prüfung fand zwei Fehler, die keine der anderen Kontrollen sehen konnte — siehe „pdfkit findet seine Schriftmetriken nicht" und „Der Seed legt nach dem ersten Login Doppelbenutzer an" unten.

**Ohne Anmeldung im Browser geprüft (Phase 7):** `/api/health/ready` in allen drei Zuständen — `ready` mit `scannerKind: "stub"`, `degraded` mit `uploadsBlocked: true` bei nicht erreichbarem clamd (HTTP **200**, nicht 503 — siehe Begründung unten), und `ready` mit `scannerKind: "clamav"` gegen ein laufendes clamd.

**Im Browser geprüft (angemeldet als worker.test): der vollständige Offline-Durchlauf.** Gerät registrieren, „Für Offline vorbereiten", Verbindung trennen (Dev-Server gestoppt **und** `navigator.onLine` false), Schritt starten, Checkliste, Messwert, PIN, lokal abschließen, wieder verbinden, synchronisieren.

Bestätigt in der Offline-Phase: Schritt 2 bleibt durchgehend 🔒 gesperrt, und **serverseitig ist nichts angekommen** — Schritt 1 weiterhin `READY`, keine Antworten, keine Messwerte, keine Abschlussmeldung, keine Sync-Kommandos, keine Freigabe für Schritt 2. Ein Neuladen der Seite mitten in der Offline-Phase verliert nichts: die fünf Vorgänge und der lokale Status stehen danach unverändert da.

Nach der Synchronisation: „5 übernommen, 0 abgelehnt, 0 Konflikt(e)". Alle fünf Kommandos `ACCEPTED` (**alle mit demselben `base_version`**, Sequenznummern 1–5), Schritt 1 `COMPLETED`, Schritt 2 vom **Server** auf `READY` freigegeben, lokale Warteschlange leer. Die Grenzwerte stehen auf dem Messergebnis (`1.8`/`2.2`, `is_within_tolerance = t`), die Abschlussmeldung ist `VALIDATED`/`OK` mit erhaltener Client-Erfassungszeit, die Bestätigung trägt Methode, Textversion, Digest und Gerät.

Der **Audit-Trail trennt sauber, wer was getan hat**: `work_step.started`, `work_step.completion_submitted` und `release_token_issued` tragen `source: mobile` mit verifizierter Geräte-ID, die beiden erstgenannten zusätzlich die offline erfasste Client-Zeit. `work_step.completed` und `work_step.released` tragen `source: system` und **kein** Gerät — was das Gerät gemeldet hat und was der Server entschieden hat, steht getrennt in der Historie.

Der Durchlauf fand **drei** Fehler, alle unten beschrieben; der schwerste machte die Synchronisation eines normalen Offline-Durchlaufs schlicht unmöglich. Nach den Korrekturen wurde er auf **vollständig zurückgesetztem Zustand wiederholt** (Auftrag, Nachweise, Sync-Tabellen und lokale IndexedDB geleert) und lief da fehlerfrei durch — die Korrekturen sind also nicht am Zustand des ersten Laufs vorbeigeglückt. Dabei ebenfalls nachgemessen: eine frische Sitzung läuft nach **8,00 h** ab.

**Im Browser geprüft (angemeldet als worker.test, PIN-Sperre):** fünf Fehlversuche am Abschlussformular — der Countdown zählt herunter („Noch 4/3/2/1 Versuch(e)"), der fünfte sperrt, und die **richtige** PIN wird währenddessen ebenso abgewiesen. Der Audit-Trail zeigt vier `confirmation_pin.failed` und ein `confirmation_pin.locked`, jeweils mit Zweck und Versuchsnummer; der Schritt blieb `IN_PROGRESS`. Nach Ablauf der Minute lief der Abschluss mit der richtigen PIN durch und der Zähler stand wieder auf 0. Dabei fiel ein Fehler auf, der schwerer wog als die Sperre selbst — siehe „Der Abschlussknopf war dauerhaft gesperrt" unten.

**Im Browser geprüft (angemeldet als PL):** die Schritt-Dokumentbindung im Planungsbildschirm — binden mit Seite und Markierung, Dublette abgewiesen, entfernen. Die Prüfung fand **zwei** Fehler, die keine andere Kontrolle sehen konnte, beide in der Schicht über dem Dienst: siehe „Eine geworfene Ablehnung reißt in Next.js die ganze Seite weg" unten. Außerdem Abschnitt 9 der Akte in der Lesefassung: die abgeleiteten Zahlen, „Abgeschlossen ist nicht freigegeben" — und **kein** Freigabeformular, weil PL nur `product_release.view` hat.

**Im Browser geprüft (angemeldet als qm.test): Abschnitt 9 der Akte, vollständig.** Das Freigabeformular erscheint hier — bei PL nicht, der hat nur `product_release.view`. Leere Begründung blockt der Browser, reine Leerzeichen weist der Server **inline** ab. Eine falsche PIN antwortet mit „Noch 4 Versuch(e)…", die Sperre wirkt also auch auf diesem Pfad: sie sitzt in `confirmWithPin`, nicht in einem einzelnen Dienst. Ablehnung und anschließende Freigabe wurden beide mit Person, Zeitpunkt, Begründung, kopierter Grundlage, Textversion und Digest erfasst; die Ablehnung bleibt lesbar, die Freigabe ist die geltende Entscheidung. Nach der Freigabe verschwindet das Formular und die Karte wird grün. Audit (`product_release.refused` PARTIAL, `.granted` SUCCESS, beide mit Begründung) und Outbox stimmen, der PIN-Zähler stand danach wieder auf 0.

Zusätzlich am Formular vorbei geprüft, weil das Verschwinden des Formulars sonst die einzige Sperre wäre: ein direkter `INSERT` einer zweiten `RELEASED`-Zeile scheitert an `product_releases_one_release_per_order`, eine zweite **Ablehnung** geht durch. Der partielle Index lässt genau das zu, was er soll.

**Im Production-Build geprüft (`pnpm run build && pnpm run start`): der Service Worker.** Nach dem Laden von `/offline` ist er registriert und `activated`, der Cache `proquado-shell-v1` enthält Seite, CSS und alle Chunks. Dann **Server gestoppt** und neu geladen: die Seite rendert vollständig, `transferSize: 0`, `deliveredByServiceWorker: true`, während ein `fetch` auf die API nachweislich mit „Failed to fetch" scheitert. Eine Navigation auf `/dashboard` landet dabei im Offline-Arbeitsbereich — der vorgesehene Rückfall.

Dieser Lauf legte den schwersten Fehler der Phase offen: die CSP verhinderte in Production **jede** Hydration. Siehe „Dieselbe CSP verhinderte in Production jede Hydration" unten — ohne diesen Test wäre die Anwendung in Produktion eine statische Seite gewesen.

Eine Beobachtung ohne Fehlerwert: bei totem Server steht dort weiter „🟢 Online", weil `navigator.onLine` den **Verbindungsstatus des Geräts** meldet, nicht die Erreichbarkeit des Servers. In der Halle (WLAN weg) stimmt die Anzeige; bei einem Serverausfall im Netz stimmt sie nicht. Die Synchronisation hängt nicht daran — sie scheitert dann am `fetch` und behält die Warteschlange.

**Betriebsdokumentation:** [docs/12](docs/12_DEPLOYMENT.md) sagt, was ein Server braucht — Komponenten, Umgebungsvariablen, was nur in Produktion greift, Health, Backup, Dimensionierung aus dem Lasttest und eine Checkliste vor dem Piloten. Zwei Dinge daraus sind beim Schreiben erst aufgefallen: dass die Migration die Datenbankrolle mit einem Passwort aus dem Repository anlegt, wenn man sie nicht vorher selbst anlegt, und dass die CSP jeden Upload blockiert hätte (siehe Stolpersteine).

Die ersten 10 Architekturdokumente in `docs/` sind vor der Implementierung entstanden und sollten bei Unklarheiten zuerst konsultiert werden. `docs/11_OFFLINE_INVARIANT_REVIEW.md` ist anderer Art: ein Prüfbericht nach der Implementierung, entstanden aus dem von docs/10 geforderten Phase-5-Gate.

**ADRs:** vollständig — 001 (Auth, mit Nachtrag zur Sitzungsdauer), 002 (Offline-Speicher), 003 (Dateispeicher), 004 (Audit-Härtung), 005 (Signaturverfahren, in Phase 7 nachgeholt, mit Nachtrag zur PIN-Sperre), 006 (Mandantenmodell), 007 (Export-Jobs, in Phase 6 nachgeholt), 008 (ausgehende Integrationen, Phase 7). [ADR-005](docs/adr/ADR-005-signature-method.md) schreibt nur nieder, was seit Phase 3 gilt und worauf Code-Kommentare seither verwiesen (PIN + Audit-Trail, keine qualifizierte elektronische Signatur). Wer daran arbeitet, sollte vor allem einen Punkt daraus kennen: der `signature_data`-Digest ist **keine** Signatur — er ist über keinen geheimen Schlüssel gebildet, die Zurechenbarkeit trägt der append-only Audit-Trail (ADR-004). Die von ADR-005 ursprünglich als größte Lücke benannte fehlende PIN-Fehlversuchssperre ist seit Phase 7 geschlossen (Nachtrag im ADR).

---

## Lokale Umgebung starten

```bash
docker compose up -d postgres minio minio-init keycloak
pnpm install
pnpm exec prisma migrate deploy
pnpm exec tsx prisma/seed.ts
pnpm run dev
```

**Node ≥ 22.13.** Nicht optional und nicht 20: das `packageManager`-Feld schreibt pnpm 11 vor, und das lädt `node:sqlite`. Mit Node 20 scheitert schon `pnpm install` — siehe „Die CI war sieben Phasen lang nie gelaufen".

**Ports:** Postgres `5433`, MinIO `9010`/`9011` (Console), Keycloak `8081`, clamd `3310`, App `3000` (Standard) — siehe unten zu Portkonflikten.

**Verbindungen seit Prisma 7:** Die URLs stehen nicht mehr im Schema. Die Anwendung baut ihren Client mit `DATABASE_URL` (Rolle `proquado_app`, RLS gilt), `prisma migrate` und der Seed lesen `DIRECT_DATABASE_URL` über `prisma.config.ts` (schemabesitzend). Die Poolgröße steuert `DATABASE_POOL_MAX`, **nicht** mehr `connection_limit` in der URL.

`clamav` startet bewusst **nicht** mit — der erste Start lädt ~250 MB Signaturen und braucht Minuten. Wer am Upload-Pfad arbeitet oder den echten Scan sehen will:

```bash
docker compose up -d clamav
# warten, bis "healthy" (nicht "running" — clamd nimmt Verbindungen an,
# bevor seine Signaturen geladen sind):
docker compose ps clamav
# dann in der lokalen .env: MALWARE_SCANNER="clamav"
```

Ob der Scanner wirklich antwortet, sagt `GET /api/health/ready` unter `checks.malwareScanner` — nicht der Containerstatus.

**Production-Build lokal starten** — nötig für alles, was nur dort greift: Service Worker, CSP, `RATE_LIMIT_STORE=postgres`, das Verbot des Malware-Stubs:

```bash
# Dev-Server vorher stoppen (siehe Stolperstein zu .next)
pnpm run build
pnpm run start -p 3002
```

`MALWARE_SCANNER="stub"` wird in Production **abgelehnt** — für einen lokalen Production-Lauf entweder clamd starten und `MALWARE_SCANNER="clamav"` setzen, oder damit rechnen, dass jeder Upload scheitert. `.claude/launch.json` hat dafür eine zweite Konfiguration `prod`.

**Demo-User** (Keycloak-Passwort für alle: `devpassword`; Anmeldung mit E-Mail oder Benutzername wie `pl.test`), verknüpft über den `pending:<email>`-Mechanismus beim ersten Login (siehe `src/lib/auth/resolve-login.ts`). **Benutzerwechsel geht über „Abmelden"** rechts in der Navigation — ohne das beendet nur die App-Sitzung, und Keycloak meldet beim nächsten Klick stillschweigend denselben Benutzer wieder an (siehe „Es gab keine Abmeldung" unten):

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

Für die ERP-/Webhook-Anbindung (als ADMIN): `POST /api/v1/integrations/webhooks` mit `name`, `url` und `eventTypes` — **das Geheimnis steht nur in dieser einen Antwort**. Zustellung läuft nicht von selbst, sondern über `POST /api/v1/integrations/webhooks/dispatch`; lokal von Hand aufrufen, in Produktion aus dem Scheduler. Für einen Empfänger auf dem eigenen Rechner `ALLOW_PRIVATE_WEBHOOK_TARGETS=true` setzen — sonst weist der SSRF-Schutz Loopback-Adressen zu Recht ab (in Produktion wirkungslos).

Für die Produktfreigabe: Akte des Auftrags öffnen, Abschnitt **9. Endprüfung und Produktfreigabe** — dort steht die Entscheidung, und als QM auch das Formular (Begründung + PIN). Freigeben geht erst, wenn der Auftrag abgeschlossen und nichts mehr offen ist; ablehnen jederzeit. Die neuen Atome `product_release.*` kommen nur über einen erneuten Seed-Lauf in bestehende Organisationen.

Für die Dokumentbindung: Dokument im Projekt anlegen, hochladen, einreichen (PL) → genehmigen und freigeben (QM) → im Fertigungsplan (Status DRAFT) beim Arbeitsschritt unter **Verbindliche Dokumente** die Revision auswählen, optional Seite und Markierung. Ohne freigegebene Revision im selben Projekt steht dort ein Hinweis statt einer leeren Auswahlliste. Nach dem Einreichen des Plans lässt sich nichts mehr binden oder entfernen.

Für die Akte: **Suche** öffnen, Seriennummer eingeben, beim Auftrag auf **Produktionsakte** — dort stehen dieselben zehn Abschnitte wie im PDF, darunter der Export. Das ZIP enthält Akte, Originalnachweise und `manifest.json`; der Downloadlink ist eine kurzlebige signierte URL. **Übersicht** und **Benachrichtigungen** sind rollenabhängig: wer nichts entscheiden darf, sieht keine offenen Entscheidungen.

Für den Offline-Fluss: **Offline** öffnen (registriert das Gerät beim ersten Aufruf mit Verbindung), **Für Offline vorbereiten** laden, Netzwerk trennen (DevTools → Network → Offline), Schritt starten/erfassen/lokal abschließen, Netzwerk wieder verbinden, **Jetzt synchronisieren**. Konflikte landen unter **Konflikte** (PL/QM entscheiden mit PIN). Der Service Worker läuft nur im Production-Build — in `next dev` würde er HMR-Antworten cachen, siehe `src/components/ServiceWorkerRegistration.tsx`.

### Zustand der lokalen Demo-Daten

**Ob die Container laufen, sagt `docker compose ps` — verlass dich nicht auf diesen Absatz.** Die Daten überleben beides: Postgres und MinIO liegen unter `./.docker-data/`, ein `docker compose up -d` bringt alles unverändert zurück. Die Daten sind da: Postgres und MinIO liegen unter `./.docker-data/`, ein `docker compose up -d` bringt alles unverändert zurück. Einzige Ausnahme ist **Keycloak**, das kein Volume hat (`KC_DB: dev-file`) und den Realm bei jedem Start neu aus `infra/keycloak/proquado-realm.json` aufbaut — seit die Benutzer-IDs dort festgeschrieben sind, ist das folgenlos, die Anmeldungen funktionieren weiter (siehe „Ein Keycloak-Neuaufbau entwertete alle Kontoverknüpfungen").

Wer die Umgebung übernimmt, findet die Daten darin **nicht** im Auslieferungszustand vor — das ist kein Fehler, aber gut zu wissen:

- **`qm.test` ist verknüpft, die übrigen vier Konten stehen auf `pending:<email>`** und binden sich beim nächsten Login neu (siehe „Ein Keycloak-Neuaufbau entwertete alle Kontoverknüpfungen"). Nichts zu tun, nur nicht wundern, wenn `users.external_id` so aussieht.
- **Der Demo-Auftrag `AUF-2026-23991` ist vollständig `COMPLETED` und bereits freigegeben** — beide Schritte abgeschlossen mit Nachweisen aus dem Offline-Durchlauf, dazu zwei Freigabeentscheidungen (`REJECTED` → `RELEASED`) aus dem Test von Abschnitt 9. **Damit ist er als Vorlage für beide Abläufe verbraucht**: eine zweite Freigabe verweigert die Datenbank, und der Offline-Durchlauf braucht Schritt 1 wieder in `READY`. Für eine Wiederholung von einem der beiden zurücksetzen (unten) — das Skript räumt auch die Freigabeentscheidungen weg.
- Zusätzlich liegen ein Fertigungsplan (`FP-…`, DRAFT) und eine freigegebene Zeichnung (`ZG-…`) im Demo-Projekt, angelegt für den Test der Dokumentbindung.
- `MALWARE_SCANNER` steht in der lokalen `.env` auf `stub`. Der clamd-Container ist mit heruntergefahren worden; seine Signaturen liegen in `./.docker-data/clamav` und müssen nicht erneut geladen werden.
- **Jeder E2E-Lauf hinterlässt ein eigenes Projekt** mit Plan, Auftrag und Nachweisen, alles unter dem Präfix `E2E-` (Projektnummer `E2E-PROJ-…`). Absichtlich nicht aufgeräumt: Ausführungsdaten hängen an einem append-only Audit-Trail, und ein Testaufräumen, das genau die Zeilen löscht, deren Unlöschbarkeit die Zusicherung ist, wäre die falsche Übung. Es ginge auch nicht nebenbei — die Fremdschlüssel auf `projects` stehen sämtlich auf `RESTRICT` (nachgesehen in `pg_constraint`), ein `DELETE FROM projects …` scheitert also an Plänen, Aufträgen und Dokumenten. Wenn die Liste wirklich stört, ist der Weg `prisma migrate reset` plus Seed, nicht ein Aufräum-SQL.
- **Der Lasttest hinterlässt deutlich mehr**: je Lauf ein Projekt `LOAD-P-…` mit einem Plan, bis zu 200 Aufträgen (`LOAD-A-…`), ebenso vielen Geräten und einer großen Akte mit 500 Schritten und 2000 Fotos. Die Projekt- und Auftragslisten sind danach lang. Gleiche Überlegung wie beim E2E-Präfix: nicht aufgeräumt, weil an den Daten ein append-only Audit-Trail hängt. Wer eine aufgeräumte Umgebung braucht, setzt sie zurück (`prisma migrate reset` plus Seed), statt einzelne Zeilen zu löschen.
- Der Seed ist zuletzt nach dem Hinzukommen von `integration.manage` gelaufen; das Atom ist in der Demo-Organisation vorhanden. **Webhook-Abonnements gibt es keine** — wer die Zustellung ausprobieren will, legt eines an und ruft den Dispatch-Endpunkt von Hand auf (oben unter „Für die ERP-/Webhook-Anbindung").

**Offline-Durchlauf wiederholen** — Ausführungsdaten zurücksetzen, Audit-Trail bleibt (er ist append-only und soll es sein):

```bash
docker exec -i proquado-postgres-1 psql -U proquado -d proquado <<'SQL'
BEGIN;
DELETE FROM conflict_decisions; DELETE FROM sync_conflicts; DELETE FROM sync_commands;
DELETE FROM sync_cursors; DELETE FROM completion_submissions; DELETE FROM step_confirmations;
DELETE FROM checklist_responses; DELETE FROM measurement_results; DELETE FROM product_releases;
DELETE FROM work_step_releases WHERE work_step_instance_id IN (
  SELECT id FROM work_step_instances WHERE step_number > 1);
UPDATE work_step_instances SET status = CASE WHEN step_number = 1 THEN 'READY' ELSE 'LOCKED' END,
  started_by_id = NULL, started_at = NULL, completed_at = NULL;
UPDATE production_orders SET status='RELEASED', actual_start_at=NULL, actual_end_at=NULL;
COMMIT;
SQL
```

Dazu im Browser die lokale Datenbank des Geräts leeren, sonst kollidiert der alte Stand mit dem neuen:
`indexedDB.deleteDatabase('proquado-offline')` in der Konsole, auf einer Seite **außerhalb** von `/offline` (sonst blockiert die offene Verbindung das Löschen).

---

## Bekannte Stolpersteine (lokal aufgetreten, für die Zukunft dokumentiert)

Inzwischen 28 Einträge, in der Reihenfolge ihres Auftretens. Wonach hier zu suchen lohnt, nach Anlass sortiert:

- **Etwas läuft in `next dev`, aber nicht im Production-Build** (oder umgekehrt): „Dieselbe CSP verhinderte in Production jede Hydration", „Dieselbe CSP hätte in Production jeden Upload verhindert", „`pnpm run build` neben laufendem `next dev`", „pdfkit findet seine Schriftmetriken nicht", „`pino-pretty` + Next.js Dev-Server", „ESM-only Abhängigkeiten".
- **Die Anmeldung schlägt fehl oder zeigt den falschen Benutzer**: „Ein Keycloak-Neuaufbau entwertete alle Kontoverknüpfungen" (die Meldung lautet „Access Denied" und meint etwas anderes), „Es gab keine Abmeldung", „Der Seed legt nach dem ersten Login Doppelbenutzer an".
- **Der Offline-/Sync-Pfad verhält sich unerwartet**: „Der Offline-Fluss konnte nie synchronisieren", „Zwei Klicks im selben Tick", „Ein geteiltes Tablet konnte den Benutzer nicht wechseln", „Sitzungsdauer und Access-Token-Dauer".
- **Eine Schaltfläche tut nichts oder die Seite bricht ab**: „Der Abschlussknopf war dauerhaft gesperrt", „Eine geworfene Ablehnung reißt in Next.js die ganze Seite weg".
- **Ein Test ist grün und beweist trotzdem nichts**: „Jest entscheidet `skip` beim Einlesen", „Ein Test, der versehentlich echte Infrastruktur anspricht", „Eine Kontrolle, die nur einen von zwei Pfaden kennt".
- **Datenbank und Schema**: „Eine bereits angewendete Migration nachträglich zu ändern", „Prisma-Client-Regenerierung erfordert Server-Neustart", „Relationsnamen bei bidirektionalen Prisma-Beziehungen", „Abgelehnte Vorgänge dürfen nicht in derselben Transaktion geworfen werden", „Berechtigung hängt manchmal von Daten ab".
- **Einzeln stehend**: „Portkonflikte mit anderen Projekten", „CSP blockiert Dev-Tooling und OAuth-Redirect" (die Vorgeschichte des CSP-Eintrags oben), „Browser-Tool: Klick-Koordinaten können bei mehrzeiligen Überschriften driften", „`getByRole('alert')` trifft in Next.js auch den Routenansager", „Die CI war sieben Phasen lang nie gelaufen".

### Portkonflikte mit anderen Projekten

Auf dieser Maschine liefen parallel andere Next.js-Projekte auf Port 3000/3001. `.env.example` und die Keycloak-Realm-Config (`infra/keycloak/proquado-realm.json`) gehen von Port **3000** aus. Falls belegt: `.claude/launch.json` auf einen freien Port ändern (aktuell `3002` konfiguriert) **und** die lokale `.env` (`AUTH_URL`) entsprechend anpassen. Die Keycloak-Realm-Config akzeptiert bereits beide Redirect-URIs (3000 und 3002).

### `pino-pretty` + Next.js Dev-Server

`pino`s Standard-Transport (`transport: { target: 'pino-pretty' }`) nutzt Worker Threads, die Next.js' Server-Bundling nicht auflösen kann (`Cannot find module .next/server/vendor-chunks/lib/worker.js`, crasht jeden Request). Fix in `src/lib/logger/index.ts`: `pino-pretty` als synchroner Destination-Stream statt als Transport. Nicht zurückändern.

### CSP blockiert Dev-Tooling und OAuth-Redirect

Eine strikte `Content-Security-Policy` (`script-src 'self'`, `form-action 'self'`) verhindert sowohl Next.js' HMR (inline Scripts) als auch den Redirect zu Keycloak (`form-action` erlaubt nur die eigene Origin). Erste Fassung: CSP nur in Production, `form-action` schließt dort die OIDC-Issuer-Origin ein. Die Hälfte davon war falsch — siehe den nächsten Eintrag.

### Dieselbe CSP verhinderte in Production **jede** Hydration

Der gravierendste Fund der Phase, gefunden beim ersten `pnpm run start` dieses Projekts.

Der Eintrag oben schloss aus „Next.js' Dev-Modus benutzt Inline-Skripte", die CSP gehöre deshalb nur in Production. Beide Prämissen stimmen, die Folgerung nicht: **auch der Production-Build liefert Inline-Skripte aus** — sie tragen den RSC-Payload und den Hydrations-Bootstrap. `script-src 'self'` blockierte sie. In der Konsole: eine Wand aus CSP-Verstößen, React-Fehler **#423** (Hydrationsabbruch) und „Connection closed" (abgerissener RSC-Stream).

Die Wirkung war total: **kein einziges Client-Element funktionierte.** Keine PIN-Dialoge, keine Produktfreigabe, keine Dokumentbindung, kein Offline-Arbeitsbereich, keine Service-Worker-Registrierung. Die Anwendung sah aus wie eine statische Seite.

Warum nichts davon auffiel: die CSP ist in der Entwicklung **abgeschaltet**. Typecheck, Unit- und Integrationstests und `next build` laufen alle, ohne dass sie je greift. Erst `next start` bringt sie zur Anwendung — und das hatte in sieben Phasen niemand getan.

Behoben mit einer Nonce je Anfrage (`src/middleware.ts`): Next.js stempelt die Nonce auf die Skripte, die es selbst erzeugt, sodass sein Bootstrap läuft und später eingeschleuste Skripte nicht. `'strict-dynamic'` erlaubt den so freigegebenen Skripten, ihre Chunks nachzuladen. `'unsafe-inline'` wäre eine Zeile gewesen und hätte den Zweck der CSP aufgegeben.

**Zwei Fallstricke auf dem Weg:**

- Die Nonce muss auf den **Request**-Headern stehen, nicht nur auf der Antwort — nur dann sieht Next sie und stempelt seine eigenen Skripte. Steht sie nur auf der Antwort, bleibt alles blockiert und der Fehler sieht unverändert aus.
- Bei einem Projekt mit `src/`-Verzeichnis gehört die Datei nach **`src/middleware.ts`**. Im Projektwurzelverzeichnis wird sie stillschweigend ignoriert; erkennbar nur daran, dass `.next/server/middleware-manifest.json` nach dem Build `"middleware": {}` enthält.

**Lehre:** Was nur in Production greift, muss auch einmal in Production laufen. Eine Absicherung, die in der gesamten Prüfkette abgeschaltet ist, ist ungeprüft — unabhängig davon, wie grün die Kette aussieht.

### Dieselbe CSP hätte in Production **jeden Upload** verhindert

Aufgefallen beim Zusammenstellen der Betriebsdokumentation, also nicht durch einen Test, sondern durch die Frage „was braucht ein Server eigentlich". Die Antwort führte auf `connect-src 'self'` — und darauf, dass Fotos und Dokumente vom **Browser** direkt in den Objektspeicher gehen (presignierte URL, ADR-003), also auf eine fremde Origin. Diese Direktive verbietet genau das.

Nachgestellt mit einem echten Upload gegen den Production-Build (`test/e2e/document-upload.spec.ts`), im Wortlaut des Browsers:

```
Connecting to 'http://localhost:9010/…' violates the following Content Security
Policy directive: "connect-src 'self'". The action has been blocked.
```

Kein Foto aus der Halle, kein Dokument in die Akte — der Nachweispfad, um den dieses ganze System gebaut ist. Behoben, indem `connect-src` die Origin des Objektspeichers aufnimmt, abgeleitet aus `S3_ENDPOINT` (und ohne den aus Region und Bucket, für echtes AWS). Dieselbe Machart wie beim OIDC-Issuer in `form-action`: aus der Konfiguration abgeleitet, nicht als Domain hineingeschrieben.

**Der eigentliche Punkt ist die Wiederholung.** Es ist derselbe Fehler wie „Dieselbe CSP verhinderte in Production jede Hydration", nur eine Direktive weiter — und er hat den ersten überlebt, obwohl damals eigens ein Production-Lauf gemacht wurde. Der Grund: dieser Lauf hat die Seiten geöffnet, aber keine Datei hochgeladen. Eine Absicherung, die in der Entwicklung abgeschaltet ist, muss in Production nicht einmal _laufen_, sondern in Production **benutzt** werden — jeder Pfad einzeln. Die Konsequenz steht jetzt als Zusicherung da: `production-csp.spec.ts` prüft den Header, `document-upload.spec.ts` lädt tatsächlich hoch.

### Der Offline-Fluss konnte nie synchronisieren — der optimistische Sperrtest schlug gegen die eigene Änderung an

Der gravierendste Fund des Browser-Durchlaufs, und er lag im Herzstück von Phase 5.

Ein Gerät stellt offline eine Kette in die Warteschlange: `start_work_step` → Checklisten­antworten → Messwert → `submit_completion`. **Alle** tragen dasselbe `baseVersion` — den Stand, den das Gerät beim Vorbereiten kannte, denn offline sagt ihm niemand etwas anderes. Beim Synchronisieren wird das erste Kommando angenommen und **hebt die Serverversion**; jedes folgende Kommando desselben Stapels scheiterte dann am optimistischen Sperrtest gegen eine Änderung, **die es selbst verursacht hatte**. Ergebnis im Browser: „1 übernommen, 0 abgelehnt, 4 Konflikt(e)" — und ein Schritt, der nie fertig wird.

Der Sperrtest ist für „jemand **anderes** hat den Schritt bewegt, während du weg warst" da (docs/06, Negativtest #13). Ein Gerät, das sein eigenes unmittelbar vorheriges Kommando nicht kennt, ist nicht dieser Fall.

Behoben in `sync-commands.ts` über `BatchVersions`: je Stapel und Schrittinstanz wird die Version beim ersten Anfassen gemerkt, dazu jede Version, die der Stapel selbst erzeugt. Ein `baseVersion` gilt genau dann als veraltet, wenn es in dieser Menge fehlt. Der Fremdgeräte-Fall bleibt damit unverändert ein Konflikt.

Warum die Testkette das nicht sah: **Abnahmeszenario B sendet gar kein `baseVersion`** (der Sperrtest lief dort also nie), und Negativtest #13 sendet es nur für ein einzelnes Kommando. Die Form, die ein echter Client erzeugt — mehrere Kommandos mit _demselben_ `baseVersion` — kam in keinem Test vor. Sie kommt jetzt vor: „Ein Stapel, wie ein echtes Gerät ihn sendet" in `phase5-offline-sync`, mit beiden Hälften (Stapel geht durch; fremdes Gerät wird weiterhin abgewiesen).

### Zwei Klicks im selben Tick bekamen dieselbe Sequenznummer

Im selben Durchlauf sichtbar geworden, als `sync_commands` zwei `record_checklist_response` mit `sequence_number = 2` zeigte: `enqueueMutation` las den Zähler, wartete, und schrieb ihn zurück — zwei schnell nacheinander beantwortete Checklistenpunkte lasen beide denselben Wert. Der Stapel wird in Sequenzreihenfolge angewendet, Dubletten machen die Reihenfolge kausal zusammenhängender Kommandos also unbestimmt.

Behoben mit einer Promise-Kette als Schleuse in `sync-client.ts`. Die Kette wird auch im Fehlerfall weitergereicht — sonst blockiert eine einzige Ablehnung alle späteren Einreihungen.

### Ein geteiltes Tablet konnte den Benutzer nicht wechseln

Beim Anmelden als `worker.test` auf demselben Gerät, das zuvor `qm.test` benutzt hatte: jede Aktion im Offline-Arbeitsbereich antwortete mit „Gerät wurde nicht gefunden", ohne Ausweg aus dem Bildschirm.

Ursache: die Geräte-ID lag in der IndexedDB **je Browser**, nicht je Anmeldung. Der Server wies sie zu Recht ab — `assertDeviceActive` behandelt das Gerät eines anderen Benutzers absichtlich als „nicht gefunden", um kein Mitgliedschafts-Orakel zu sein. Nur merkte der Client das nie. Auf genau der Hardware, für die der Offline-Modus existiert.

`resolveHandover` in `use-offline-workspace.ts` entscheidet jetzt beim Start, was der Vorgänger hinterlassen hat: gleiche Anmeldung → weiter; andere Anmeldung ohne offene Vorgänge → lokale Daten löschen und neu registrieren (die Aufträge, Nachweise und der Cursor des Vorgängers gehen den Nächsten nichts an, docs/08); andere Anmeldung **mit** offenen Vorgängen → **verweigern und sagen warum**. Das Letzte ist der Punkt: nicht übertragene Arbeit stillschweigend zu löschen, weil sich jemand anders angemeldet hat, wäre genau das Gegenteil dessen, was docs/06 über offline erfasste Arbeit sagt.

### Sitzungsdauer und Access-Token-Dauer sind nicht dasselbe

Im Offline-Durchlauf aufgefallen: `session.maxAge` stand auf 15 Minuten, mit dem Kommentar „matches ADR-001's short-access-token decision". ADR-001 sagt aber etwas über **Access Tokens**, nicht über die Sitzung — der Wert war aus der falschen Zeile übernommen. Folge in der Halle: ein Tablet, das eine Schicht offline arbeitet, kommt mit abgelaufener Sitzung zurück und muss sich neu anmelden, bevor es Erfasstes abliefern kann. Die Warteschlange überlebt das (verschlüsselte IndexedDB, mit fünf Vorgängen über zwei Serverneustarts hinweg nachgeprüft) — aber Reibung an genau dieser Stelle ist die Sorte, die dazu führt, dass ein System umgangen wird.

Steht jetzt auf **8 Stunden**, eine Schicht, festgehalten als Nachtrag in [ADR-001](docs/adr/ADR-001-authentication.md) und im Browser nachgemessen (`/api/auth/session` meldet direkt nach der Anmeldung 8,00 h). Bestehende Sitzungen behalten ihre alte Dauer — sie steckt im ausgestellten JWT; der neue Wert gilt ab der nächsten Anmeldung. Tragfähig ist das nicht, weil das Risiko klein wäre, sondern weil das Sitzungsalter wenig kauft: jede folgenreiche Handlung verlangt ohnehin die PIN (docs/04, ADR-005), und seit Phase 7 gibt es eine Abmeldung. Was es kostet — acht Stunden Lesezugriff auf einem liegengelassenen Gerät — steht im Nachtrag ausdrücklich dabei; dagegen helfen Fernsperre und die Bildschirmsperre des Geräts, nicht dieser Wert.

### Es gab keine Abmeldung — und deshalb keinen Benutzerwechsel

Beim Versuch, für den Offline-Test von `pl.test` auf `worker.test` zu wechseln, aufgefallen: die Anwendung hatte **überhaupt keine Abmeldung**. `signOut` war in `src/lib/auth/index.ts` exportiert und nirgends verwendet, die Navigation hatte keinen Eintrag, und der Bildschirm nannte auch nicht, wer angemeldet ist.

Die Folge ist nicht bloß unbequem. Selbst wenn man die App-Sitzung loswird (JWT, 15 Minuten), bleibt die **SSO-Sitzung bei Keycloak** bestehen: ein Klick auf „Mit SSO anmelden" meldet stillschweigend dieselbe Person wieder an, ohne je nach einem Passwort zu fragen. An einem geteilten Hallen-Tablet heißt das, dass der Nächste unter dem Namen des Vorgängers arbeitet — und der Audit-Trail schreibt genau das. In einem System, dessen Zweck Zurechenbarkeit ist, ist das ein Sicherheitsmangel, kein Komfortmangel.

Umgesetzt sind beide Hälften: `signOut({ redirect: false })` für die eigene Sitzung, danach eine Weiterleitung an das **`end_session_endpoint`** des Providers. Das wird über `/.well-known/openid-configuration` **ermittelt**, nicht zusammengebaut — `/protocol/openid-connect/logout` ist ein Keycloak-Pfad, und ihn fest zu verdrahten würde ADR-001 (generisches OIDC) stillschweigend aufheben.

Ohne `id_token_hint`, dafür mit `client_id` + `post_logout_redirect_uri`: so muss das ID-Token nirgends hin, wo es sonst nicht gebraucht wird. Preis ist eine Rückfrage des Providers — an einem geteilten Gerät ist „wirklich abmelden?" kein Preis.

**Fallstrick dabei:** Keycloak lehnt die Rücksprung-URL mit „Invalid redirect uri" ab, solange sie nicht als `post.logout.redirect.uris` **am Client** registriert ist. `redirectUris` allein genügt nicht. Steht jetzt in `infra/keycloak/proquado-realm.json`. Die Realm-Konfiguration wird nur beim Anlegen importiert (`--import-realm`, `KC_DB: dev-file`) — nach einer Änderung daran:

```bash
docker compose up -d --force-recreate keycloak
```

### Ein Keycloak-Neuaufbau entwertete alle Kontoverknüpfungen

Direkte Folge des vorigen Eintrags, und der Fehler war meiner: Ich habe `--force-recreate` als Vorgehen empfohlen, ohne zu prüfen, was es mit bestehenden Anmeldungen macht. Ergebnis beim nächsten Anmeldeversuch: **„Access Denied — You do not have permission to sign in."**

Der Container hat kein Volume für `KC_DB: dev-file`. Ein Neuaufbau bedeutet also frische Datenbank und Re-Import des Realms — und die Realm-Datei legte **keine Benutzer-IDs fest**, Keycloak vergab bei jedem Import neue. Die `external_id` in `users` zeigt danach auf ein Subject, das es nicht mehr gibt. Der `pending:<email>`-Mechanismus greift nicht, weil er beim ersten Login verbraucht wurde: das Konto ist verknüpft, nur eben falsch.

Im Log steht es klar (`Login denied: no matching user record`), auf dem Bildschirm nicht — dort steht nur „Access Denied", was nach einer Berechtigungsfrage aussieht und keine ist.

**Behoben an der Ursache:** die Realm-Datei schreibt die Benutzer-IDs jetzt fest (`"id": "11111111-…-00000000000N"`). Ein Re-Import vergibt damit dieselben Subjects wie zuvor, und ein Neuaufbau ist folgenlos.

**Wenn Verknüpfungen doch einmal veraltet sind** — etwa auf einer Installation, die vor dieser Änderung angelegt wurde — ist das Zurücksetzen auf den Einladungszustand der vorgesehene Weg; die Konten binden sich beim nächsten Login neu, ohne Datenverlust:

```bash
docker exec -i proquado-postgres-1 psql -U proquado -d proquado -c \
  "UPDATE users SET external_id = 'pending:' || email WHERE external_id NOT LIKE 'pending:%';"
```

**Lehre:** Wer eine Betriebsanweisung in dieses Dokument schreibt, sollte sie einmal ausgeführt haben. Diese hier war beim Aufschreiben plausibel und beim Befolgen falsch.

### `pnpm run build` neben laufendem `next dev` zerlegt den Dev-Server

Beim Browser-Test aufgetreten und einige Minuten Fehlersuche wert: eine Seite antwortete plötzlich mit `500` und `Cannot find module './vendor-chunks/@swc+helpers@0.5.5.js'`. Kein Anwendungsfehler — `pnpm run build` schreibt in dasselbe `.next/`, aus dem der laufende Dev-Server seine Chunks lädt, und überschreibt sie. Der Dev-Server bemerkt das nicht und sucht danach Dateien, die es nicht mehr gibt.

Die Meldung zeigt auf `node_modules` und Webpack und legt damit einen Abhängigkeitsfehler nahe. Es ist keiner:

```bash
# Dev-Server stoppen, dann
rm -rf .next
# und neu starten
```

**Regel:** Die volle Prüfkette (die `pnpm run build` enthält) und `next dev` nicht gleichzeitig laufen lassen — oder danach `.next` wegwerfen.

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

### Der Abschlussknopf war dauerhaft gesperrt — durch die Bestätigung, die er selbst erzeugt

Beim Browser-Test der PIN-Sperre aufgefallen, und der schwerste UI-Fehler bisher: **kein Arbeitsschritt ließ sich vom Online-Bildschirm abschließen.** Der Knopf stand auf „Abschließen (1 fehlend)" und war deaktiviert, auch nachdem alle Nachweise erfasst waren.

Die eine fehlende Anforderung war `CONFIRMATION_MISSING` — die Bestätigung, die das Formular mit dem PIN-Feld gerade erzeugen will. `openRequirementCount` zählt sie mit, `signature_required` steht auf **jedem** Planschritt, also war der Knopf immer gesperrt. Serverseitig war nichts falsch: `submitWorkStepCompletion` schreibt die `StepConfirmation` und validiert erst danach, die Lücke ist zum Prüfzeitpunkt also geschlossen.

Zweiter Fund derselben Zeile: der Knopf sperrte auch bei **Toleranzverletzungen**. Damit erreichte ein Messwert außerhalb der Toleranz den Server nie — und weil die NCR erst beim Abschluss entsteht (Abnahmeszenario D), erfuhr die Qualitätssicherung von der Abweichung überhaupt nichts. Eine Sperre, die verhindert, dass ein Fehler gemeldet wird.

Getrennt in zwei Fragen, die vorher eine waren: `openRequirementCount` bleibt, was die Liste „Offene Anforderungen" zeigt — alles, was der Server gerade ablehnen würde, inklusive Bestätigung und Toleranzverletzung, denn der Mitarbeiter soll das sehen. `requirementsBlockingCompletion` ist das, was den Knopf sperren darf: fehlende Nachweise, die der Mitarbeiter noch liefern kann. Nur Letzteres steckt jetzt im Knopf.

**Warum keine andere Kontrolle das sah:** Integrationstests rufen `submitWorkStepCompletion` direkt, der Knopf kommt darin nicht vor. Die Unit-Tests prüften `evaluateStepRequirements`, das korrekt ist. Und der Offline-Weg hat sein eigenes Formular. Es gab keinen Test, der die Frage „darf der Knopf gedrückt werden" überhaupt stellte — jetzt gibt es drei.

### Eine geworfene Ablehnung reißt in Next.js die ganze Seite weg

Beim Browser-Test der Dokumentbindung als PL gefunden, und nur dort zu finden: `bindDocumentToStepAction` war eine gewöhnliche Server Action, die den `ValidationError` durchreichte. Ein Doppelklick auf **+ Dokumentbindung** landete damit in `src/app/error.tsx` — „Ein Fehler ist aufgetreten", Planungsbildschirm weg, Arbeitsstand weg. Der Text war korrekt („Revision 01 ist bereits verknüpft"), die Reaktion nicht: das ist eine normale Antwort mit einer offensichtlichen nächsten Handlung, kein Seitenabbruch.

Bemerkenswert, **was das nicht gefunden hat**: Typecheck nicht, Integrationstests nicht (die rufen den Service, nicht die Action), `next build` nicht. Der Service verhielt sich in jeder Prüfung korrekt — nur die Schicht darüber machte aus seiner Antwort einen Absturz.

Behoben wie bei Export und Vier-Augen-Prüfung: `useFormState`, Aktion gibt `{ error }` zurück statt zu werfen (`src/components/StepDocumentBindingForms.tsx`). **Regel:** Eine Server Action, deren Dienst eine `DomainError` werfen kann, gehört hinter `useFormState` — geworfen wird nur, was wirklich ein Serverfehler ist.

Direkt danach der zweite Fund derselben Sitzung: nach dem **Entfernen** der Bindung blieb die alte Meldung stehen und behauptete, die Revision sei „bereits verknüpft" — sie war es nicht mehr. `useFormState` behält seinen Zustand bis zum nächsten Absenden desselben Formulars. Gelöst mit `key={step.documentBindings.length}` auf dem Formular: ändert sich die Liste, über die die Meldung spricht, wird das Formular neu montiert und die Meldung verschwindet.

### Jest entscheidet `skip` beim Einlesen, nicht beim Laufen

Der erste Anlauf der Scanner-Integrationstests wählte `it` oder `it.skip` anhand einer Erreichbarkeitsprüfung aus `beforeAll`. Ergebnis: alles übersprungen, obwohl clamd lief — Jest sammelt die Testliste beim Einlesen der Datei, `beforeAll` läuft danach. Die Variable war zum Entscheidungszeitpunkt noch `false`.

Die Korrektur ist aber nicht „früher prüfen", sondern **gar nicht prüfen**: `CLAMAV_TESTS=1` schaltet die Tests ein, und ist clamd dann nicht erreichbar, gehen sie **rot**. Ein probenbasiertes Überspringen macht „Abhängigkeit fehlt" und „Abhängigkeit ist kaputt" zum selben Zweig — der eine Lauf, der hätte rot werden müssen, wird still grün. Dieselbe Familie wie „Ein Test, der versehentlich echte Infrastruktur anspricht" weiter unten.

### Eine Kontrolle, die nur einen von zwei Pfaden kennt, deckt die Hälfte ab

Die manuelle Überprüfung der Offline-Invariante (docs/11) fand drei Mängel, die alle dieselbe Bauart haben: `deviceId` wurde im **Sync**-Pfad seit Phase 5 sauber gegen `assertDeviceActive` geprüft — und in den **gewöhnlichen** Endpunkten (Schritt starten, Nachweis erfassen, Abschluss melden) als `z.string().max(255)` entgegengenommen und nie nachgeschlagen. Folgen: die Fernsperre eines verlorenen Tablets galt online nicht; der Zählschlüssel des gerätebezogenen Rate Limits war ein frei wählbarer String, also kein Limit; und der Wert landete unverändert in vier Audit-Spalten ohne Fremdschlüssel.

Warum es keine Kontrolle sah: die zwölf Angriffstests aus `phase7-offline-invariant-attacks` gehen **alle** über `processSyncCommands`. Ein Angreifer, der die Sync-API gar nicht benutzt, war nie Gegenstand eines Tests. Die Invariante selbst hielt in jedem Fall — der Server glaubt dem Client nichts —, aber die flankierenden Kontrollen taten es nicht.

**Regel:** Wenn eine Kontrolle für eine Eingabe eingeführt wird, einmal `grep` über alle Stellen laufen lassen, die dieselbe Eingabe annehmen. Der Fix ist `resolveDeviceId` in `src/lib/api/device-context.ts` — eine Funktion, an einer Stelle, in allen neun Endpunkten.

### Die CI war sieben Phasen lang nie gelaufen — und scheiterte zweimal, bevor der erste Test lief

`.github/workflows/ci.yml` steht seit Phase 1 im Repository, mit fünf Jobs und einem Kommentar darüber, welche Stufe was findet. Ausgeführt wurde die Datei nie: das Projekt hatte bis zum Ende von Phase 7 **kein Remote**. Der allererste Push löste den allerersten Lauf aus, und der starb nach 13 Sekunden — nicht in einem Test, sondern in `actions/setup-node`:

```
warn: This version of pnpm requires at least Node.js v22.13
Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite
```

`packageManager` steht auf `pnpm@11.20.0`, und dieses pnpm lädt `node:sqlite` — ein Builtin ab Node 22.13. Der Workflow pinnte `node-version: 20`. Damit scheiterte **jeder** Job noch vor seinem ersten Kommando, `lint-and-typecheck` zuerst; die vier abhängigen Jobs wurden gar nicht erst gestartet. Behoben durch `node-version: 22` in allen Jobs; `engines.node` steht jetzt ebenfalls auf `>=22.13.0`, weil das die tatsächliche Anforderung der Werkzeugkette ist und ein `>=20.0.0` daneben schlicht unwahr war.

**Der zweite Anlauf scheiterte an derselben Sorte Karteileiche.** Mit Node 22 kam `setup-node` durch, und dafür brach `pnpm install --frozen-lockfile` ab:

```
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: @prisma/client, @prisma/engines,
cpu-features, esbuild, prisma, protobufjs, ssh2, unrs-resolver
```

pnpm führt Installationsskripte nur nach ausdrücklicher Entscheidung aus und bricht ab, solange ein Paket weder erlaubt noch abgelehnt ist — ohne TTY ein harter Stopp. In `pnpm-workspace.yaml` stand dafür seit Phase 1 eine Liste unter **`onlyBuiltDependencies`**, und das ist die pnpm-**10**-Schreibweise: pnpm 11 wertet sie nicht aus. Der geltende Schlüssel heißt `allowBuilds` und ist eine Zuordnung Paket → true/false; `pnpm config list` zeigt die offenen Entscheidungen im Klartext („set this to true or false").

Warum das lokal nie auffiel: ein vorhandenes `node_modules` fragt nicht erneut. Der Fehler tritt ausschließlich bei einer **frischen** Installation auf — nachgestellt in einem Wegwerfverzeichnis mit denselben vier Dateien, wo er sich zeigte, sich beheben ließ und die Korrektur nachweisbar wurde (`prisma generate` und `tsx` laufen darin).

**Lehre — dieselbe wie beim CSP-Eintrag oben, eine Ebene höher:** eine Pipeline, die nie gelaufen ist, ist kein Sicherheitsnetz, sondern eine Vermutung mit YAML-Syntax. Beide Fehler standen jahrelang plausibel aussehend da, keiner wäre durch Lesen aufgefallen, und beide brauchten zur Korrektur keine zehn Zeilen. Wer hier etwas ändert, sollte es einmal gegen einen **leeren** Zustand ausführen: frisches `node_modules`, frische Datenbank, frischer Runner. Die Entwicklungsmaschine ist der Ort, an dem solche Fehler sich verstecken, nicht der, an dem sie auffallen.

Seit der zweiten Korrektur ist die Pipeline grün, alle fünf Jobs (PR #1). Was sie dabei über sich selbst verraten hat, steht in der Übergabe unter Punkt 3.

### `getByRole('alert')` trifft in Next.js auch den Routenansager

Beim Schreiben der E2E-Tests aufgetreten: die Zusicherung auf die Fehlermeldung des PIN-Formulars scheiterte an „strict mode violation: resolved to 2 elements". Das zweite Element ist `<div role="alert" aria-live="assertive" id="__next-route-announcer__">` — Next.js' Ansage des Seitentitels für Screenreader, dauerhaft im Dokument und meistens leer.

Kein Anwendungsfehler, aber eine Falle für jede künftige Zusicherung auf `role="alert"`: entweder auf das Element der Anwendung zeigen (`#pin-error`) oder die Suche auf das Formular einschränken (`form.getByRole('alert')`). Beides steht so in `test/e2e/`.

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
- **Der Sync-Cursor kommt nicht aus einer Postgres-Sequenz.** Eine Sequenz vergibt ihre Nummer beim INSERT, nicht beim COMMIT: zwei Transaktionen können 41 und 42 ziehen und in umgekehrter Reihenfolge committen. Ein Client, der dazwischen pollt, sieht 42, merkt sich Cursor 42 — und Ereignis 41 wird eine Millisekunde später sichtbar, hinter dem Cursor, für immer unzustellbar. Bei einem Strom, dessen Ereignisse „Schritt freigegeben" heißen, ist das ein Tablet, das den Folgeschritt nie entsperrt. Deshalb `sync_sequences`: ein Zählerdatensatz je Organisation, dessen Zeilensperre bis zum Commit gehalten wird, also ist Nummernreihenfolge = Commit-Reihenfolge. Preis: Outbox-Schreibvorgänge einer Organisation serialisieren. Falls das je zum Engpass wird, wäre die Lösung ein Zähler je Produktionsauftrag — **nicht** die Rückkehr zur Sequenz. Siehe `src/domain/sync/outbox-sequence.ts`.

  **Nachtrag aus dem Lasttest (Ebene 8), weil diese Vermutung jetzt eine Messung hat:** dieselben 200 Geräte auf vier Organisationen verteilt — also mit vier unabhängigen Zählern statt einem — bringen **+33 % Durchsatz** (64 → 85 Stapel/s), nicht das Vierfache. Die Serialisierung je Organisation kostet also etwas, aber sie ist nicht die Wand. Die Wand ist die Zahl der Datenbankverbindungen: mit 100 statt 25 scheitern 93 von 200 Stapeln an Postgres' `max_connections`. Wer den Sync schneller machen will, sollte deshalb **zuerst** an Verbindungsverwaltung (pgbouncer, Poolgröße, `max_connections`) arbeiten und erst danach an einem feineren Zähler — die umgekehrte Reihenfolge wäre viel Umbau für ein Drittel.

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
- **Die ESLint-Konfiguration liegt im Flat-Format** (`eslint.config.mjs`), weil ESLint ab Version 9 kein anderes mehr liest. `next/core-web-vitals`, `plugin:@typescript-eslint/recommended` und `prettier` kommen über `FlatCompat` herein statt nachgebaut zu werden — ihre Regellisten gehören den Paketen, nicht uns. Wer eine Ausnahme ergänzt: im Flat-Format überschreiben spätere Einträge frühere, und ein Eintrag mit `ignores` ohne `files` gilt global.
- **Die Umstellung wurde verglichen, nicht geglaubt.** `eslint --print-config` vor und nach der Migration, für je eine Datei aus Anwendung, Komponenten, E2E, Seed und Lasttest: gleiche Zahl aktiver Regeln, gleiche Ausnahmen je Verzeichnis. Die beiden scheinbaren Unterschiede (`prefer-const`, `no-unused-expressions`) waren keine — ESLint 9 druckt die Standardoptionen aus, die vorher implizit galten. Ohne diesen Vergleich wäre eine stille Lockerung nicht aufgefallen: eine Konfiguration, die nur „läuft", kann die halbe Regelmenge verloren haben.
- **Prisma 7 verbindet über einen Treiber-Adapter, nicht mehr selbst.** Die Rust-Engine ist weg; `src/lib/db/client.ts` baut den Client mit `PrismaPg`. Verbindungs-URLs stehen deshalb nicht mehr im Schema, sondern an zwei getrennten Stellen mit je einem Zweck: `DATABASE_URL` beim Client (Rolle `proquado_app`, RLS gilt) und `DIRECT_DATABASE_URL` in `prisma.config.ts` für Migrationen (schemabesitzend). Die Trennung aus ADR-006 ist damit sichtbarer als vorher, wo beides in derselben Schemadatei stand.
- **`connection_limit` in der URL tut seit Prisma 7 nichts mehr.** Den Parameter wertete die Rust-Engine aus; der Adapter überliest ihn und nimmt die Vorgabe von `pg` (10 Verbindungen). Die Poolgröße steht jetzt in `DATABASE_POOL_MAX` (Vorgabe 25) und wird dem Adapter übergeben. Wer an der URL dreht und keine Wirkung sieht, sucht an der falschen Stelle — und das ist keine Kleinigkeit, weil der Lasttest die Verbindungszahl als härteste Grenze des Sync ausweist.
- **`params` und `searchParams` sind seit Next 15 Promises.** Eine neue Seite oder Route schreibt sich `async function Page(props: { params: Promise<{ id: string }> })` und holt sich die Werte mit `await props.params` — nicht mehr destrukturiert in der Signatur. Betroffen waren 75 Dateien; umgestellt hat sie der offizielle Codemod (`@next/codemod next-async-request-api`), nicht die Hand. Zwei weitere Umbenennungen derselben Anhebung: `experimental.serverComponentsExternalPackages` heißt jetzt `serverExternalPackages` und steht nicht mehr unter `experimental` (die pdfkit-Ausnahme hängt daran, siehe Stolpersteine), und `useFormState` aus `react-dom` heißt in React 19 `useActionState` aus `react` — `useFormStatus` bleibt, wo es war.
- **Der Grund für den Sprung auf Next 15 war kein Aufräumen, sondern eine Sicherheitslücke im eigenen Bau.** Unter den offenen Warnungen stand „cross-site scripting in App Router applications using CSP nonces", behoben erst ab 15.5.16 — also genau in dem Mechanismus, den `src/middleware.ts` seit Phase 7 benutzt. Dazu SSRF in Server Actions und ein DoS im App Router, alle als hoch eingestuft. Wer die Anhebung rückgängig machen will, hebt diese drei mit auf.
- **Szenario 2 aus docs/09 Ebene 8 kann nicht bestehen, und das ist richtig so.** Dort steht „Auftrag mit 500 Arbeitsschritten, 2000 Fotos … ZIP-Export < 60 s"; ADR-007 begrenzt den Export hart auf 500 Nachweisdateien. Eine Akte mit 2000 Fotos wird also abgewiesen, nicht langsam exportiert — der Lasttest protokolliert die Ablehnung im Klartext und misst den ZIP-Export stattdessen an einem Auftrag innerhalb der Grenze. Aufzulösen ist der Widerspruch nicht durch Anheben der Grenze, sondern durch die Entscheidung, die ADR-007 offenlässt: asynchrone Erzeugung, sobald ein realer Auftrag diese Größe erreicht. Bis dahin ist die Grenze die ehrlichere Antwort — ein 60-Sekunden-Request, der einen Server blockiert, ist kein Export, sondern ein Ausfall mit Fortschrittsbalken.
- **Exporte laufen synchron hinter einem Job-Datensatz** — [ADR-007](docs/adr/ADR-007-export-job-processing.md). docs/10 empfahl BullMQ/Redis, entschieden war das nie (es gab kein ADR-Dokument). Für eine Akte je Auftrag zahlt sich eine Warteschlange nicht aus; der Job-Datensatz macht die spätere Umstellung zum Austausch **eines** Funktionsaufrufs, ohne Datenmodell-Umbau. Harte Grenzen (500 Nachweisdateien, 512 MB) fangen den Fall ab, für den die Queue gedacht war.
- **Benachrichtigungen werden beim Lesen verteilt, nicht von einem Worker.** Konsequenz aus ADR-007: `dispatchPendingNotifications` arbeitet die Outbox-Zeilen mit `processed = false` ab, wenn jemand seine Benachrichtigungen öffnet. Das ist spät, aber nie falsch — nichts hängt für die Korrektheit an einer Benachrichtigung, und der Unique-Key `(organization, user, sourceEvent)` macht wiederholtes Verteilen zum No-op statt zum Duplikat. Der `processed`-Flag ist genau dafür da.

- **Die Outbox hat drei Verbraucher mit drei verschiedenen Wasserstandsmarken** — das ist der Punkt, an dem man beim Hinzufügen eines vierten aufpassen muss. Der Benachrichtigungsversand benutzt `processed`; der **Gerätesync** einen Cursor je (Benutzer, Gerät) in `sync_cursors`; die **Webhooks** einen Cursor je Abonnement. Keiner davon darf die Marke eines anderen mitbenutzen: wer `processed` setzt, nimmt sie allen, die daran hängen. Ein neuer Verbraucher bekommt seine eigene.
- **Die Empfängerliste einer Benachrichtigung ist kurz gehalten.** Jedes Ereignis in `RULES` unterbricht jemanden, und ein Benachrichtigungscenter voller Routinefortschritt ist eines, das niemand liest — was genau die Konflikte und Sperren kostet, für die es existiert. Adressiert wird an **Benutzer**, nicht an Rollen: wer etwas wissen muss, hängt an Zuweisung und Berechtigung im Moment des Ereignisses, und das später aufzulösen ergäbe eine andere Antwort als die, die galt.
- **Die Suche meldet nie, wie viele Treffer sie verborgen hat.** Eine Zahl unterdrückter Ergebnisse ist selbst eine Auskunft — „es gibt 3 Dokumente, die Sie nicht sehen dürfen" verrät, dass es sie gibt. Jeder Ergebnistyp hängt zusätzlich an der Berechtigung, die sein Lesen regelt: ein WORKER, der eine Seriennummer sucht, bekommt Aufträge, keine Dokumente.
- **Der Malware-Scan-Stub ist in Produktion nicht mehr wählbar.** Bis Phase 7 lieferte `getMalwareScanner()` in _jeder_ Umgebung einen Scanner, der immer `CLEAN` meldete; zwischen dem und einem Produktivbetrieb stand ein Kommentar, das jemand lesen musste. Eine Kontrolle, die vom Erinnern abhängt, ist keine. Jetzt: `MALWARE_SCANNER=clamav` spricht echtes clamd (INSTREAM, ohne Client-Bibliothek — im Sicherheitspfad wäre das eine Abhängigkeit zu viel), `stub` wird bei `NODE_ENV=production` mit hartem Fehler abgelehnt. Ein nicht erreichbarer Scanner liefert `ERROR`, nie `CLEAN`: Aufrufer akzeptieren nur `CLEAN`, ein Ausfall blockiert also Uploads, statt sie durchzuwinken.
- **Eine `deviceId` aus dem Request ist erst ein Gerät, wenn der Server sie nachgeschlagen hat.** `resolveDeviceId` (`src/lib/api/device-context.ts`) verlangt UUID, Existenz, Eigentümerschaft und Nicht-Sperrung — dieselbe Prüfung, mit der die Sync-Endpunkte seit Phase 5 öffnen, jetzt überall dort, wo das Feld angenommen wird. Ohne `deviceId` (der normale Browser) bleibt alles wie zuvor. Siehe „Eine Kontrolle, die nur einen von zwei Pfaden kennt" oben und docs/11 B-1 bis B-3.
- **Ein Benutzer darf höchstens `MAX_ACTIVE_DEVICES_PER_USER` (10) aktive Geräte haben.** Keine Komfortgrenze: `SYNC_COMMANDS` und `PHOTO_UPLOAD` zählen je Gerät, eine unbegrenzte Registrierung ist also ein unbegrenztes Kontingent — und ein Sync-Batch löst bis zu 500 vollständige serverseitige Neuvalidierungen aus. Gesperrte Geräte zählen nicht mit, damit der Ersatz eines verlorenen Tablets nie an der Grenze scheitert.
- **`STANDARD_API` wird in `requireAuthContext` gezählt, nicht je Route.** Das Limit stand seit Phase 1 in docs/05 und war bis zur Überprüfung nirgends durchgesetzt — unter anderem war `GET /sync/bundle` ungedrosselt, das für jeden READY-Schritt jedes zugewiesenen Auftrags ein neues Token prägt und ein Audit-Event schreibt. Zentral, weil jeder authentifizierte Einstiegspunkt seinen Actor darüber auflöst und deshalb keiner vergessen werden kann. Folge auf der Clientseite: `pullAndApplyChanges` hat eine Seitenobergrenze je Lauf (`MAX_PAGES_PER_SYNC`) — der Cursor wird je Seite gesichert, ein früher Abbruch ist also Fortsetzung, kein Verlust.
- **Der Webhook liefert Outbox-Ereignisse aus, kein ERP-Modell.** Kein Auftragsschema, kein Feld-Mapping, kein Produktstamm — bewusst, weil es keinen Konsumenten gibt. Ein erratenes Fremddatenmodell muss beim ersten echten Anschluss weggeworfen werden; das Weiterreichen von Tatsachen, die wir intern ohnehin veröffentlichen, muss das nicht (ADR-008 Entscheidung 1).
- **Jedes Webhook-Abonnement führt einen eigenen Cursor, nicht das `processed`-Flag der Outbox.** Das gehört dem Benachrichtigungsversand; ein zweiter Verbraucher daran würde dem ersten Ereignisse wegnehmen, die er noch nicht gesehen hat. Der Cursor läuft auch über herausgefilterte Ereignisse weiter — dieselbe Regel wie beim Gerätesync, sonst liest ein verengtes Abonnement dieselben Zeilen endlos neu. Ein neues Abonnement beginnt am **aktuellen Ende** des Stroms, nicht bei null.
- **Ohne Scheduler wird nichts zugestellt.** ADR-007 hält Queue-Infrastruktur draußen, und der Benachrichtigungs-Trick („verteilen, wenn jemand liest") trägt nicht, weil ein Fremdsystem nicht auf einen Menschen wartet. Zustellung läuft über `POST /api/v1/integrations/webhooks/dispatch` hinter `integration.manage`, aufgerufen von einem Scheduler. Das ist eine **Betriebsvoraussetzung**, keine Feinheit.
- **Der SSRF-Schutz prüft die aufgelöste Adresse, nicht den Namen.** Ein Verbot der Zeichenkette „localhost" fängt nichts — tausend Namen zeigen auf Loopback. Abgelehnt werden Loopback, private Bereiche, Link-Local (Cloud-Metadaten), CGNAT und Multicast; **alle** Resolver-Antworten müssen zulässig sein. Geprüft bei der Registrierung **und** bei jeder Zustellung, weil DNS sich ändert. Weiterleitungen werden nicht verfolgt: ein 302 liefe um die Prüfung herum. `ALLOW_PRIVATE_WEBHOOK_TARGETS` gibt es für lokale Empfänger und wird in Produktion bedingungslos ignoriert.
- **Das Signaturgeheimnis wird genau einmal ausgeliefert** — bei der Registrierung. Die Abonnementliste enthält es nicht, auch nicht für Berechtigte. Ein verlorenes Geheimnis wird ersetzt, nicht wiederhergestellt.
- **Die Bestätigungs-PIN wird an genau einer Stelle geprüft** (`src/domain/identity/confirm-with-pin.ts`). Vorher gab es **vier** identische Kopien von `verifyActorPin` — in Schrittabschluss, Vier-Augen, Konfliktentscheidung und Produktfreigabe. Das war nicht bloß Duplikat: eine Fehlversuchssperre in einer davon hätte drei offen gelassen. Eine Kontrolle, die in vier Dateien erinnert werden muss, fehlt irgendwann in einer.
- **Fünf aufeinanderfolgende Fehlversuche sperren die Bestätigung**, beginnend bei einer Minute, verdoppelnd bis 15 Minuten, Zähler bei Erfolg zurückgesetzt (ADR-005-Nachtrag). Die Zahl dahinter: das vollständige Durchprobieren einer vierstelligen PIN dauert damit rund drei Wochen, im Erwartungswert die Hälfte — und schreibt bei **jedem** Versuch ein Audit-Event. Die Rechnung steht als Zusicherung im Unit-Test, nicht nur im Kommentar.
- **Die Sperre ist zeitbasiert und löst sich selbst.** Ein Mitarbeiter an der Maschine darf für eine vertippte PIN keine Administration brauchen — eine Sperre, die jemand anderes aufheben muss, wird durch geteilte PINs umgangen, und damit wäre genau die Zurechenbarkeit weg, für die die PIN da ist. Auslösen kann sie ohnehin nur der Kontoinhaber: geprüft wird gegen den authentifizierten Actor, es gibt also keinen Weg, jemand anderen aus der Schicht auszusperren.
- **`CONFIRMATION_LOCKED` (HTTP 423) steht nicht in der Fehlertabelle von docs/05**, die älter ist. Getrennt von `CONFIRMATION_FAILED`, weil ein Client, der „falsche PIN" nicht von „gesperrt, noch vier Minuten" unterscheiden kann, entweder die Wartezeit verschweigt oder weiterhämmert. Dieselbe Art dokumentierter Abweichung wie bei den Berechtigungsatomen.
- **Rate Limits zählen in Produktion in einer gemeinsamen Tabelle, sonst im Prozess.** Der In-Memory-Zähler ist auf einer Instanz eine echte Grenze; hinter N Repliken erlaubt er das N-fache — eine echte Abschwächung, keine Rundung. `PostgresRateLimitStore` (`rate_limit_windows`) zählt instanzübergreifend; die Entscheidung fällt über `RATE_LIMIT_STORE`, Standard ist `postgres` in Produktion und `memory` sonst. Die Voreinstellung liegt auf dieser Seite, weil die Fehlerfolgen ungleich sind: ein geteilter Speicher in der Entwicklung kostet eine Abfrage, die niemand merkt — prozesslokale Zähler in einer skalierten Produktion vervielfachen still jedes Limit aus dem Vertrag. Postgres statt Redis, weil ADR-007 Redis aus dem MVP heraushält und die Datenbank ohnehin die Verfügbarkeitsuntergrenze der ganzen Anwendung ist. Gegen unauthentifizierte Fluten hilft das nicht — das ist Sache des vorgelagerten Proxys (docs/08).
- **`RateLimitStore.hit` ist asynchron, und das war der eigentliche Punkt.** Die Schnittstelle war synchron, und der Kommentar daneben behauptete, ein gemeinsamer Speicher sei „**eine** Implementierung, kein Umbau" — was nicht stimmte: kein Speicher, der über Netz oder Datenbank geht, erfüllt einen synchronen Vertrag. Die Abstraktion verhinderte genau den Austausch, für den sie da war. Folge: `assertWithinRateLimit` muss überall awaited werden.
- **`rate_limit_windows` steht bewusst außerhalb von RLS und trägt keine `organization_id`.** Ein Limit ist eine Eigenschaft des Aufrufers, nicht der Daten eines Mandanten, und die Tabelle wird in `requireAuthContext` gelesen — also in der Funktion, die den Organisationskontext überhaupt erst herstellt. Ein Kontextzwang wäre zirkulär. Damit sie trotzdem keine mandantenübergreifende Liste gerade aktiver Benutzer ist, wird als Schlüssel der SHA-256 von `<Kategorie>:<Subjekt-ID>` gespeichert, nicht die ID: die Anwendung schlägt ausschließlich Schlüssel nach, die sie selbst berechnet hat, das Hashen kostet also nichts.
- **Der Aktenfortschritt im Dashboard zählt nur serverbestätigte Schritte.** docs/07 B1 schreibt es vor, und es ist dieselbe Invariante wie überall sonst: lokal abgeschlossene Schritte erscheinen getrennt als `pendingSteps` und gehen nie in die Prozentzahl ein. Gezählt wird außerdem nur der jüngste Versuch je Planschritt — dieselbe Regel wie in `releaseEligibleSuccessors`, damit das Dashboard der Ausführung nicht widersprechen kann.
- **Der Audit-Auszug der Akte ist auf die Ressourcen des Auftrags eingegrenzt.** Eine Akte, die organisationsweite Ereignisse mitliefert, wäre nicht gründlich, sondern ein Datenschutzproblem (docs/08).
- **Die Produktfreigabe ist seit Phase 7 ein eigener Vorgang** (`product_releases`, `src/domain/quality/product-release.ts`). Abschnitt 9 der Akte rechnet weiterhin zusammen, ob etwas offen ist — aber `releasable` heißt jetzt ausdrücklich „die Voraussetzungen sind erfüllt", nie „es wurde freigegeben". Das ist `decision`, und die ist null, solange niemand entschieden hat. Abgeschlossen ist nicht freigegeben.
- **Die Grundlage der Freigabe wird kopiert, nicht bei jedem Lesen neu gerechnet.** `basis_*` hält fest, was zum Entscheidungszeitpunkt galt (Auftragsstatus, offene blockierende Abweichungen, aktive Sperren, abgeschlossene/gesamte Schritte). Dieselbe Begründung wie beim Kopieren der Toleranzgrenzen auf ein Messergebnis: eine spätere Datenänderung darf die Grundlage einer bereits getroffenen Entscheidung nicht rückwirkend umschreiben. Ein Integrationstest hält genau das fest.
- **Freigeben geht genau einmal, Ablehnen beliebig oft.** Die Tabelle ist mehrzeilig, weil „abgelehnt → Nacharbeit → freigegeben" der Normalfall ist und eine wegeditierbare Ablehnung kein Nachweis wäre. Ein partieller Unique-Index lässt höchstens **eine** `RELEASED`-Zeile je Auftrag zu; der Service weist danach auch eine Ablehnung ab. Eine erteilte Freigabe zurückzunehmen ist ein Rückruf, keine Korrektur — und es ist nicht Aufgabe dieses Dienstes, das eine wie das andere aussehen zu lassen.
- **Eine Freigabe wird nie abgeleitet.** Der Server verweigert sie, solange der Auftrag nicht `COMPLETED` ist oder eine blockierende Abweichung oder Sperre offen ist — aber das Erfüllen dieser Bedingungen _erzeugt_ keine Freigabe, es macht eine nur möglich. Ablehnen bleibt jederzeit möglich: ein Produkt zurückzuweisen ist genau das, was man tut, solange etwas nicht stimmt.
- **Die Accessibility-Prüfung nimmt mehr Regeln, als docs/09 nennt.** Dort steht `withTags(['wcag22aa'])`; dieses Tag steht in axe-core aber nur für die mit WCAG 2.2 **neu hinzugekommenen** Kriterien. Allein geprüft liefe der Test an Kontrast, Formularbeschriftung und Namen von Bedienelementen vorbei — also an fast allem, was hier schiefgehen kann. Geprüft wird deshalb die kumulative Menge bis AA (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`). Strenger als der Buchstabe von docs/09 und näher an dem, was dort gemeint ist. Dieselbe Art dokumentierter Abweichung wie bei den Berechtigungsatomen.
- **Ein grüner axe-Lauf ist keine barrierefreie Anwendung.** axe prüft, was maschinell prüfbar ist; ob jemand mit Handschuhen an einem Hallentablet die Bestätigungs-PIN eingeben kann, sagt kein automatischer Test. Was der Lauf leistet, ist das Fernhalten von Regressionen — und die Zusicherung, dass er überhaupt etwas geprüft hat, steckt im Helfer selbst: er verlangt eine Mindestzahl **bestandener** Regeln, weil ein Scan auf einer leergebliebenen Seite sonst als „keine Verstöße" durchginge. Dass der Scanner anschlägt, wurde einmal gegengeprüft — eine eingeschleuste Verletzung (Bild ohne Alternativtext, Knopf ohne Namen, Text ohne Kontrast) wird gemeldet.
- **`product_release.decide` liegt allein bei QM, `product_release.view` bei allen lesenden Rollen.** docs/04 nennt das Atom nicht — Masterprompt Kap. 10 beschreibt den Abschnitt der Akte, sagt aber nicht, wer entscheidet, weil bisher niemand entschied. Vergeben nach derselben Begründung, die docs/04 bei Dokumenten benutzt: wo QM die eindeutige Instanz ist, ist es die einzige. Dieselbe Art Abweichung wie bei `sync.execute` — dokumentiert, nicht stillschweigend. **Seed nachziehen nicht vergessen**, sonst liefert die Anwendung `PERMISSION_DENIED` für eine Berechtigung, die im Code längst vergeben ist.

---

## Test-Kommandos

Die vollständige Kette, in dieser Reihenfolge — jede Stufe findet etwas, das die vorherige nicht sieht:

```bash
pnpm run typecheck          # Sekunden
pnpm run lint
pnpm run format:check
pnpm run test:unit          # 199 Tests, keine Infrastruktur nötig
pnpm run build              # Kompilier- UND Bündelungsprüfung
pnpm run test:integration   # 118 Tests, echte Postgres+MinIO-Container (Testcontainers)
```

Drei Tests laufen zusätzlich gegen ein echtes clamd und sind deshalb ausdrücklich einzuschalten — sie gehen **rot**, wenn keins antwortet (siehe „Jest entscheidet `skip` beim Einlesen" oben):

```bash
docker compose up -d clamav   # warten bis "healthy"
CLAMAV_TESTS=1 pnpm run test:integration -- phase7-hardening
```

Alle Integrationstests laufen gegen **echte** Infrastruktur, nicht gegen Mocks — siehe `docs/09_TEST_PYRAMID.md`.

### E2E- und Accessibility-Tests (docs/09 Ebene 6 und 9)

```bash
docker compose up -d postgres minio minio-init keycloak
pnpm exec prisma migrate deploy && pnpm exec tsx prisma/seed.ts   # einmalig
pnpm run test:e2e                    # 13 Tests, ~2 Min inkl. Build
pnpm run test:e2e work-step          # nur eine Datei
pnpm exec playwright show-trace test-results/<…>/trace.zip        # nach einem Fehlschlag
```

Vier Eigenheiten, die man kennen sollte, bevor man daran arbeitet:

- **Der Lauf baut und startet den Production-Build selbst** (`playwright.config.ts`, `webServer`) und belegt dafür Port **3002**. `next dev` darf daneben nicht laufen — `pnpm run build` schreibt in dasselbe `.next/` (siehe Stolperstein oben). Ein bereits laufender Server wird bewusst **nicht** wiederverwendet: er könnte ein Dev-Server sein, und der Lauf prüfte dann still die falsche Sache.
- **Warum Production und nicht `next dev`:** die CSP ist in der Entwicklung abgeschaltet und verhinderte in Production jede Hydration, ohne dass die gesamte übrige Prüfkette etwas merkte. `production-csp.spec.ts` hält diese Voraussetzung selbst fest — er prüft, dass die ausgelieferte Antwort eine Nonce-CSP trägt **und** dass Next.js seine Skripte damit gestempelt hat. Zusätzlich lässt `test/e2e/support/test.ts` jeden Test rot werden, sobald im Browser ein CSP-Verstoß, ein React-Fehler oder eine unbehandelte Ausnahme auftaucht.
- **Angemeldet wird über den echten Keycloak** (`auth.setup.ts`, einmal je Rolle, Ergebnis als `storageState` unter `test/e2e/.auth/`). Kein nachgebautes Sitzungscookie: die Kontoverknüpfung entsteht genau auf diesem Weg, und genau dieser Weg ist in Phase 7 zweimal gebrochen.
- **Ebene 9 läuft im selben Kommando** (`accessibility.spec.ts`): axe-core über Anmeldeseite, Meine Aufträge, Arbeitsschritt in Arbeit, Planungsbildschirm und Akte mit Freigabeformular — jeweils im Zustand mit den meisten Bedienelementen, weil ein leerer Bildschirm keine Barrieren hat. Alle fünf sind ohne Verstoß, ohne eine einzige Ausnahmeregel.
- **In der CI ist das die Stufe `e2e-tests`** (`.github/workflows/ci.yml`), die die Infrastruktur über die **projekteigene** `docker-compose.yml` hochfährt statt über GitHubs `services:` — eine zweite Beschreibung derselben Container wäre eine, die irgendwann abweicht, und MinIO braucht ein `command`, das `services:` nicht kennt. Gewartet wird auf die Discovery-Antwort des **Realms**, nicht auf den Containerstatus: nur sie beweist, dass der Import durch ist.
- **Die Tests bauen ihre Fixtures selbst** (`test/e2e/support/scenario.ts`): eigener Plan, eigener Auftrag, eigene Zuweisung, alles mit dem Präfix `E2E-`, angelegt über die Domänendienste und angehängt an die Demo-Konten (die Anmeldung bindet an `users.email`). Der Demo-Auftrag wird dabei nicht angefasst — und ein Test, dessen Voraussetzung Handarbeit ist, wäre keiner.

**Auch diese Kette ist nicht vollständig.** Zwei Fehler in Phase 6/7 waren erst im Browser sichtbar: die fehlenden pdfkit-Schriftmetriken (nur beim Bündeln, nicht beim Kompilieren) und die Doppelbenutzer des Seeds (nur mit einer echten, eingeloggten Sitzung). Ebene 6 deckt davon jetzt einen Teil ab, aber nur die drei Abläufe, die dort stehen — wer an UI oder an Paketen arbeitet, die zur Laufzeit Dateien lesen, sollte die betroffene Seite weiterhin einmal wirklich öffnen. In der CI laufen beide Ebenen als eigene Stufe `e2e-tests` (siehe unten).

### Lasttest (docs/09 Ebene 8)

```bash
pnpm run test:load                    # volle Größe aus docs/09, ~30 s plus Containerstart
LOAD_DEVICES=40 pnpm run test:load    # kleiner, für zwischendurch
```

Stellschrauben, alle mit der Vorgabe aus docs/09: `LOAD_DEVICES=200`, `LOAD_STEPS=500`, `LOAD_PHOTOS=2000`, `LOAD_DASHBOARDS=50`, dazu `LOAD_DB_CONNECTION_LIMIT=25` und `LOAD_ORGS=1`. Testcontainers starten Postgres und MinIO; sonst wird nichts gebraucht.

**Was gemessen wird und was nicht.** Der Harness ruft die Domänendienste direkt auf, nicht die HTTP-API. Gemessen wird damit die Arbeit, die der Server tatsächlich leistet — Transaktionen, RLS, Berechtigungen, Audit und Outbox, PDF und ZIP —, **nicht** HTTP, TLS, Next.js und der Netzweg. Das ist eine Grenze mit Grund: die API hängt an NextAuth-Cookies, 200 Geräte bräuchten 200 echte Keycloak-Anmeldungen, und gemessen würde am Ende überwiegend die Anmeldung. Der erwartete Engpass sitzt ohnehin in der Datenbank.

**Ergebnis (MacBook, Postgres im Container, drei Läufe):**

| Szenario                        | Ziel docs/09 | Gemessen                                           |
| ------------------------------- | ------------ | -------------------------------------------------- |
| Schichtwechsel-Sync, 200 Geräte | p95 < 3 s    | **3,0–3,1 s** (Prisma 5), **3,2–3,7 s** (Prisma 7) |
| Deadlocks                       | 0            | 0                                                  |
| Nicht angenommene Kommandos     | 0            | 0                                                  |
| Große Akte, PDF (500/2000)      | < 30 s       | 0,2 s                                              |
| ZIP-Export (innerhalb Grenze)   | < 60 s       | 0,04 s                                             |
| Dashboard, 50 gleichzeitig      | p95 < 500 ms | 84 ms                                              |

Vier Dinge, die aus diesen Zahlen folgen:

- **Der einzige knappe Wert ist der Sync, und er liegt genau auf der Grenze.** Nicht darunter mit Reserve: 3,0 s bei einem Ziel von 3 s, in einem Lauf 4,7 s. Wer die Zahl als bestanden verbucht, verbucht eine Punktlandung.
- **Es ist eine Warteschlange, keine Streuung.** p50 und p95 liegen 3 % auseinander (3023 / 3078 ms) — alle Geräte warten auf dieselbe Ressource und werden fast gleichzeitig fertig. Der aussagekräftige Wert ist deshalb der Durchsatz: **rund 64 Stapel/s, 255 Kommandos/s**, stabil über die Läufe.
- **Die Verbindungsobergrenze ist die härtere Wand als die Outbox.** Mit `LOAD_DB_CONNECTION_LIMIT=100` scheiterten 93 von 200 Stapeln an Postgres' `max_connections` („too many clients"), während der p95 der übrigen scheinbar besser aussah — genau deshalb zählt der Harness abgebrochene Vorgänge getrennt und nicht als schnelle Läufe.
- **Alles bleibt korrekt.** Null Deadlocks, null abgewiesene Kommandos, alle 200 Stapel vollständig angewendet. Unter Last wird das System langsam, nicht falsch.

**Nachtrag zum Wechsel auf Prisma 7:** derselbe Lauf auf derselben Maschine ist mit dem Treiber-Adapter durchweg langsamer als mit der alten Rust-Engine — p95 3,2/3,5/3,7 s gegen 3,0/3,06/3,08 s, Durchsatz 54–62 statt rund 64 Stapel/s. Damit wird das 3-Sekunden-Ziel hier **gerissen**, wo es vorher knapp gehalten wurde. Die naheliegende Erklärung wurde geprüft und trägt nicht: die Poolgröße ausdrücklich auf 25 zu setzen statt der stillen Vorgabe 10 des Adapters ändert an den Zahlen nichts. Die Ursache liegt im Adapter selbst, nicht in seiner Konfiguration. Für den Piloten gilt unverändert, was oben steht — auf der Zielhardware nachmessen, und wenn es dort eng bleibt, zuerst an der Verbindungsverwaltung arbeiten.

**Bewusst nicht in der CI.** Messwerte hängen an der Maschine; ein Gate, das je nach Runner-Auslastung rot wird, erzieht dazu, rote Läufe zu ignorieren. Der Lauf prüft die Ziele trotzdem und endet mit Exit-Code 1, wenn eines gerissen wird — für einen Lauf von Hand vor einem Release ist das die richtige Härte.

### Restore-Probe (docs/09 Ebene 10)

```bash
pnpm run test:restore                                  # ~10 s plus Containerstart
RESTORE_DRILL_FAULT=missing-file pnpm run test:restore # muss ROT enden
RESTORE_DRILL_FAULT=missing-row  pnpm run test:restore # muss ROT enden
```

Der Ablauf ist der aus docs/09 und endet ausdrücklich nicht beim erfolgreichen Einspielen: Quellumgebung mit echten Daten füllen (Dokument mit Datei, Auftrag mit Foto, Messwert, PIN-Bestätigung, Produktfreigabe), sichern (`pg_dump` plus alle Objekte), **zweite, leere** Umgebung starten, zurücksichern, prüfen.

Drei Entscheidungen dahinter:

- **Zwei getrennte Umgebungen, nicht eine.** Ein Restore in dieselbe Datenbank prüft, ob ein Dump lesbar ist — nicht, ob aus dem Backup allein ein arbeitsfähiges System entsteht. Nur die zweite Frage stellt sich am Tag des Ausfalls.
- **Der Beweis ist die Produktionsakte.** Sie wird nie gespeichert, sondern bei jedem Aufruf aus den Primärdaten abgeleitet (Masterprompt Kap. 10) — stimmt sie zeichengleich überein, stimmt alles, woraus sie besteht. Ausgenommen sind genau zwei Felder, `dataAsOf` und `generatedAt`, die den Zeitpunkt des Lesens festhalten und sich unterscheiden **müssen**. Jede weitere Ausnahme wäre eine Abweichung, die die Probe nicht mehr sieht.
- **Die Probe kann fehlschlagen, und das ist nachgewiesen.** `RESTORE_DRILL_FAULT` schleust einen Schaden ein: eine gelöschte Datei oder eine gelöschte Zeile. Beide Läufe enden rot, mit Fundstelle — die fehlende Datei melden zwei Prüfungen samt `photo_evidence`-ID, die fehlende Zeile meldet der Zeilenvergleich **und** der Aktenvergleich. Eine Wiederherstellungsprüfung, die noch nie fehlgeschlagen ist, sieht aus wie eine Kontrolle.

**Was die Probe nebenbei belegt:** `pg_dump` sichert eine Datenbank, **keine Rollen**. Ohne vorher angelegte `proquado_app` scheitert das Einspielen am ersten GRANT. Genau diese Reihenfolge steht in docs/12 §3.1 — hier wird sie bei jedem Lauf ausgeführt statt nur behauptet.

**Nicht in der CI**, wie der Lasttest: sie braucht zwei Container-Paare und Docker-Zugriff für `pg_dump`. Vorgesehen ist der wöchentliche Lauf aus docs/01.

### Automatische Prüfungen bei GitHub

Die Pipeline-Skizze in docs/09 nennt drei Stufen, die es lange nicht gab, weil sie für ein privates Repository im Free-Plan nicht verfügbar waren. Seit das Repository öffentlich ist, laufen sie:

| docs/09           | Umsetzung                                                                                             | Wo die Befunde stehen      |
| ----------------- | ----------------------------------------------------------------------------------------------------- | -------------------------- |
| `sast_scan`       | CodeQL (`.github/workflows/codeql.yml`), `security-and-quality`                                       | Security → Code scanning   |
| `dependency_scan` | Dependabot: Warnungen, Sicherheitskorrekturen, monatliche Aktualisierungen (`.github/dependabot.yml`) | Security → Dependabot      |
| `secret_scan`     | Secret Scanning **mit Push Protection**                                                               | Security → Secret scanning |

Drei Entscheidungen dazu:

- **CodeQL ist kein erforderlicher Check.** Eine statische Analyse liefert Hinweise, keine Beweise; ein Gate, das an einem Falschbefund hängt, wird abgeschaltet statt gelesen. Erforderlich bleiben die fünf Stufen, die etwas ausführen.
- **Dependabot aktualisiert monatlich und gebündelt**, nicht täglich und einzeln. Jeder Aktualisierungs-PR löst die vollständige Pipeline aus, E2E-Lauf mit drei Containern inklusive. Dringendes kommt über die Sicherheitswarnungen und wartet nicht auf den Zeitplan.
- **Push Protection ist der wichtigste der drei Schalter.** Er weist ein Geheimnis ab, bevor es in der Historie steht — nachträglich ist ein veröffentlichtes Geheimnis nicht gelöscht, sondern verbrannt. Beim Wechsel auf öffentlich wurde die Historie einmal vollständig durchsucht: keine echten Schlüssel, nur die als solche benannten Entwicklungswerte.

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

Die Gates vor dem Piloten sind abgearbeitet, ebenso die bekannten Lücken aus der Phase-6-Übergabe; die Testpyramide aus docs/09 ist seit heute vollständig. Was bleibt, ist Betrieb, Erprobung und das Nachziehen von Abhängigkeiten — siehe „Stand" oben.

1. **Wenn ein realer ERP-Konsument da ist**, ADR-008 neu bewerten: dann zeigt sich, ob das Ereignisformat trägt oder eine Abbildungsschicht dazugehört. Genau dafür hatte docs/10 die Umsetzung ursprünglich zurückgestellt.

2. **Scheduler für `POST /api/v1/integrations/webhooks/dispatch` einrichten**, sobald ein Webhook produktiv genutzt wird. Ohne ihn sammeln sich Zustellungen als `PENDING` an, ohne dass jemand etwas merkt.

3. **Die CI-Stufe `e2e-tests` läuft — mit einer Reserve, die man im Auge behalten sollte.** Sie steht in `.github/workflows/ci.yml`, deckt Ebene 6 und 9 mit demselben Kommando ab und war in PR #1 erstmals grün: alle fünf Jobs, `e2e-tests` in 3 min 25 s, darin 13 Tests in 1,6 min. Zwei Zahlen daraus sind es wert, gemerkt zu werden, weil sie lokal ganz anders aussehen:
   - **Keycloak brauchte 14 Versuche** (rund 28 s), bis der Realm antwortete; lokal ist er nach dem ersten da. Die Warteschleife gibt 60 Versuche à 2 s. Reserve ist also reichlich, aber es ist die Stelle, die bei einem langsameren Runner zuerst kippt — und wenn sie kippt, sagt die Meldung samt angehängtem `docker compose logs keycloak` genau das.
   - **Der Testlauf dauert auf dem Runner das Fünffache** (1,6 min gegen 17 s lokal), im Wesentlichen der Production-Build. Wer Tests ergänzt, sollte das einrechnen, bevor er sich über die Wartezeit wundert.

   Bis dahin war die Stufe zweimal gescheitert, beide Male vor dem ersten Test — siehe „Die CI war sieben Phasen lang nie gelaufen".

4. **Next 16 und ESLint 10 stehen offen**, beide als Dependabot-PR. Sie hängen zusammen: `eslint-config-next` folgt der Next-Hauptversion, weshalb der ESLint-10-PR den Next-16-Sprung mit einpackt und so nicht mergbar ist. Das Vorgehen, das sich heute bei Next 15 und Prisma 7 bewährt hat: erst auflisten, was im Code bricht, dann die offiziellen Codemods, dann die vollständige Kette **einschließlich E2E** — bei Next 15 waren es 82 Dateien, und Typecheck plus Build hätten dort nicht gereicht.

5. **Den Sync-Wert auf der Zielhardware nachmessen, bevor der Pilot startet.** Er liegt seit dem Wechsel auf Prisma 7 über dem Ziel aus docs/09 (p95 3,2–3,7 s statt < 3 s). Auf einem Laptop gemessen und deshalb kein Urteil über die reale Anlage — aber der Wert, der beim Schichtwechsel von 200 Tablets zählt, und der einzige aus dem Lasttest, der nicht mit Reserve besteht. Die Reihenfolge der Hebel steht bei den Architekturentscheidungen: zuerst Verbindungsverwaltung, dann alles andere.

### Arbeitsweise, die sich in diesem Projekt bewährt hat

- Vor jeder Phase die zugehörigen `docs/`-Kapitel lesen; sie sind vor dem Code entstanden und enthalten die Begründungen.
- Abweichungen von `docs/` **hier** festhalten, nicht stillschweigend umsetzen — der Abschnitt „Architekturentscheidungen mit Nachwirkung" ist genau dafür da und hat mehrfach Widersprüche sichtbar gemacht.
- Am Ende jeder Phase die vollständige Prüfkette laufen lassen, dazu `pnpm run test:e2e`, **und** die betroffenen Seiten einmal im Browser öffnen. Die E2E-Tests ersetzen das Durchspielen nicht — sie halten fest, was einmal durchgespielt wurde.
- Bei jedem gefundenen Fehler zusätzlich fragen, warum die vorhandenen Kontrollen ihn nicht gesehen haben — die lehrreichsten Einträge unter „Bekannte Stolpersteine" sind so entstanden.
- **Einen Ablauf einmal ganz durchspielen, nicht nur seine Teile testen.** Der Offline-Durchlauf in Phase 7 fand drei Fehler, obwohl jeder einzelne Baustein grüne Tests hatte. Der schwerste entstand erst aus der Kombination: mehrere Kommandos mit demselben `baseVersion` in einem Stapel — eine Form, die kein Test erzeugte, weil jeder Test seine Kommandos mit dem Wissen des Servers baut, das ein echter Client nicht hat. Wo Tests Eingaben konstruieren, konstruieren sie leicht die bequemen.
- **Was nur in Production greift, muss auch einmal in Production laufen.** Die CSP war in der gesamten Prüfkette abgeschaltet und verhinderte dort, wo sie galt, jede Hydration — sieben Phasen lang unbemerkt, weil niemand `next start` ausgeführt hatte. Grün heißt nur „geprüft, was geprüft wurde".
- **Das Mergen vor grünen Checks verhindert jetzt GitHub, nicht mehr die Aufmerksamkeit.** Auf `main` liegt eine Branch-Protection-Regel mit allen fünf CI-Jobs als erforderlichen Checks, `enforce_admins` eingeschlossen — sie gilt also auch für Administratoren. Zwei Folgen für die tägliche Arbeit: direktes `git push` auf `main` geht nicht mehr, alles läuft über PRs; und `gh pr merge --auto` tut endlich, was der Name sagt. Vorgeschichte: PR #3 landete vor seinen eigenen Checks, weil `--auto` ohne erforderliche Checks sofort mergt, und die Regel selbst war damals gesperrt — Branch Protection ist bei GitHub für **private** Repositories dem Pro-Plan vorbehalten. Seit das Repository öffentlich ist, greift sie.
- **Eine Betriebsanweisung, die hier hineingeschrieben wird, sollte einmal ausgeführt worden sein.** Der `--force-recreate`-Hinweis für Keycloak stand eine halbe Phase lang da, war plausibel formuliert und entwertete beim Befolgen jede Kontoverknüpfung. Dokumentation, die man nur zu Ende gedacht hat, ist eine Vermutung mit Befehlszeile.
- **Zahlen, die eine Begründung tragen, gehören in einen Test.** Zweimal an einem Tag hatte ein Kommentar eine Größenordnung behauptet, die nicht stimmte (Dauer eines PIN-Durchprobierens, Anzahl gefundener Fehler). Wo eine Zahl das Argument ist, prüft sie am besten die Testsuite — siehe `lockSecondsForAttempts`.
