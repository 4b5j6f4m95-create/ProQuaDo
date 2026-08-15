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
  - _Inbetriebnahme_: **Stammdatenerfassung und Kontoeinrichtung** — bis zuletzt entstanden Standort, Abteilung, Arbeitsplatz, Kunde, Produkt, Benutzer und Rollenzuweisung **ausschließlich im Seed**, und eine Bestätigungs-PIN ließ sich überhaupt nicht setzen. Ohne Altsystem, aus dem eine Migration sie mitgebracht hätte, wäre ein Pilot damit nicht startfähig gewesen: das Projektformular bot Auswahllisten, die leer blieben, und jedes neu angelegte Konto konnte nichts abschließen. Jetzt gibt es **Administration** (`/admin`) und **Mein Konto** (`/account`), und die beiden Ketten sind durchgängig — Standort → Abteilung → Arbeitsplatz → Kunde → Projekt → Produkt → Plan → Auftrag, und einladen → anmelden → PIN setzen → bestätigen.
  - _Integration_: **ERP-/Webhook-Anbindung** — Outbox-Ereignisse signiert an registrierte Endpunkte, mit SSRF-Schutz, Wiederholungen und sichtbarem Scheitern ([ADR-008](docs/adr/ADR-008-outbound-integrations.md)).
  - _Prüfbarkeit_: **E2E-Tests nach docs/09 Ebene 6** — Playwright, und zwar gegen den **Production-Build**, nicht gegen `next dev`. Damit ist die Schicht, in der fast jeder Fehler dieser Phase saß (Server Action, Formularzustand, Hydration), erstmals automatisiert geprüft statt nur von Hand durchgespielt. Dazu **Ebene 9** (axe-core) über dieselben Bildschirme: keine Verstöße bis WCAG 2.2 AA, einschließlich `target-size` — die Zielgrößenregel, an der eine Tablet-Oberfläche für Handschuhe am ehesten scheitern würde. Inzwischen stehen auch **Ebene 8** (Lasttest) und **Ebene 10** (Restore-Probe) als eigene Kommandos — damit ist die Testpyramide aus docs/09 vollständig.
  - _Dokumentation_: ADR-005 nachgeholt, ADR-001 um die Sitzungsdauer ergänzt, ADR-008 neu. Dazu die Betriebsreihe [docs/12](docs/12_DEPLOYMENT.md) (Referenz), [docs/13](docs/13_STAGING_SETUP.md) (Aufsetzfolge), [docs/14](docs/14_RUNBOOK.md) (laufender Betrieb), [docs/15](docs/15_TRAINING.md) (Schulung) und [docs/16](docs/16_ON_CALL.md) (Eskalation) — die letzten drei entstanden nach der Implementierung und tragen Kennzeichen, was davon ausgeführt und was abgeleitet ist.
  - Der Rest von Phase 7 ist **keine Programmierarbeit mehr**: Pilot an einer realen Linie, Schulung, externer Penetrationstest, Restore-Probe gegen das echte Backup, kontrollierter Rollout.

  - _Werkzeugkette_: Node **≥ 22.13**, **Next 16** mit React 19 und Turbopack, **Prisma 7** (Treiber-Adapter statt Rust-Engine), **TypeScript 6**, **ESLint 9** im Flat-Format, pino 10 mit pino-pretty 13, **zod 4**. Jedes für sich angehoben und geprüft — die Begründungen stehen unter „Architekturentscheidungen mit Nachwirkung", die Messwerte beim Lasttest. **ESLint 10 ist absichtlich nicht dabei**, siehe Übergabe Punkt 4.
  - _Repository_: **öffentlich**, mit Branch Protection auf `main` (alle fünf CI-Jobs erforderlich, `strict`, `enforce_admins`), Dependabot und Secret Scanning samt Push Protection. Direkte Pushes auf `main` gehen nicht mehr; alles läuft über PRs. **Die Sichtbarkeit ist Voraussetzung dafür und nicht bloß Beiwerk** — siehe „Ein privates Repository verliert seine Schutzregel" unter den Stolpersteinen. **Code Scanning ist derzeit aus** (`state: not-configured`), der CodeQL-Workflow läuft aber noch und scheitert deshalb bei jedem PR; einschalten unter _Settings → Code security → Code scanning → Set up → Default_, sonst gehört der Workflow entfernt.

  **Bemerkenswert an dieser Phase**: nahezu jeder gefundene Fehler lag **nicht** im Domänendienst, sondern in der Schicht darüber (Server Action, Formular, Client-Zustand) oder in der Kombination einzeln korrekt getesteter Bausteine. Keiner davon war durch Typecheck, Unit-, Integrationstests oder `next build` sichtbar; gefunden hat sie durchweg das Durchspielen im Browser. Die Liste steht unter „Bekannte Stolpersteine", die Konsequenz als Arbeitsregel am Ende.

  **Und eine zweite Beobachtung, die sich erst spät zeigte:** die folgenreichsten Lücken standen nicht im Code, sondern in einer **Formulierung im Plan**. `docs/10` führt die Datenmigration als „falls Altsystem vorhanden" und stellt die andere Hälfte der Frage nie — dahinter lag, dass sich Stammdaten und PINs überhaupt nicht erfassen ließen. Ebenso hatte `docs/10` nie gefragt, wer eine vergessene PIN zurücksetzt. Beides fiel nicht durch Lesen des Codes auf, sondern durch die Frage, was ein Pilot **am ersten Tag** tun muss.

- **Vor dem Piloten offen, und nichts davon ist Programmierarbeit** — die Schrittfolge dazu steht in [docs/13](docs/13_STAGING_SETUP.md), die verbindliche Liste in [docs/12 §9](docs/12_DEPLOYMENT.md): (a) `MALWARE_SCANNER=clamav` samt erreichbarer clamd-Instanz in der **Zielumgebung** — Dienst, Adapter, Readiness-Check und EICAR-Nachweis stehen, die Konfiguration der realen Umgebung nicht; (b) `RATE_LIMIT_STORE` in Produktion auf `postgres` belassen (Standard), sobald mehr als eine Instanz läuft, und `DATABASE_POOL_MAX` ausdrücklich setzen; (c) die Restore-Probe gegen das **echte** Backup-Verfahren fahren statt gegen ein im Test erzeugtes; (d) den Sync-Durchsatz auf der **Zielhardware** messen — der einzige Lasttest-Wert ohne Reserve; (e) der externe Penetrationstest, den docs/11 §5 ausdrücklich nicht ersetzt. **Alle fünf hängen an derselben Voraussetzung**, einer Umgebung, die kein Entwicklungsrechner ist; wer sie einmal aufsetzt, erledigt sie zusammen.

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

**Seit dem Sprung auf Next 16 ist daraus ein Test geworden** (`offline-shell.spec.ts`, zwei Fälle). Anlass war eine konkrete Sorge: Turbopack baut jetzt, und `sw.js` cacht ausschließlich, was unter `/_next/static/` liegt — läge auch nur ein Teil der Auslieferung woanders, wäre der Offline-Start still kaputt, die Seite online tadellos und in der Halle weiß. Sie liegt dort, alle zehn Skript- und Stilressourcen. Der Test prüft das ausdrücklich mit, nicht nur das Ergebnis.

Dieser Lauf legte den schwersten Fehler der Phase offen: die CSP verhinderte in Production **jede** Hydration. Siehe „Dieselbe CSP verhinderte in Production jede Hydration" unten — ohne diesen Test wäre die Anwendung in Produktion eine statische Seite gewesen.

**Im Production-Build geprüft (Next 16, ohne Anmeldung): die drei Zustände der Readiness.** Bei totem clamd antwortet `/api/health/ready` mit **HTTP 200** und `status: "degraded"`, `uploadsBlocked: true` — nicht mit 503. Das ist die Grundlage der Alarmierungsregel in docs/14: wer auf dem HTTP-Status alarmiert, sieht diesen Ausfall nie. Liveness bleibt ebenfalls 200.

Eine Beobachtung ohne Fehlerwert: bei totem Server steht dort weiter „🟢 Online", weil `navigator.onLine` den **Verbindungsstatus des Geräts** meldet, nicht die Erreichbarkeit des Servers. In der Halle (WLAN weg) stimmt die Anzeige; bei einem Serverausfall im Netz stimmt sie nicht. Die Synchronisation hängt nicht daran — sie scheitert dann am `fetch` und behält die Warteschlange.

**Betriebsdokumentation:** [docs/12](docs/12_DEPLOYMENT.md) sagt, was ein Server braucht — Komponenten, Umgebungsvariablen, was nur in Produktion greift, Health, Backup, Dimensionierung aus dem Lasttest und eine Checkliste vor dem Piloten. Zwei Dinge daraus sind beim Schreiben erst aufgefallen: dass die Migration die Datenbankrolle mit einem Passwort aus dem Repository anlegt, wenn man sie nicht vorher selbst anlegt, und dass die CSP jeden Upload blockiert hätte (siehe Stolpersteine).

**Eskalation und Bereitschaft:** [docs/16](docs/16_ON_CALL.md) — bewusst eine **Vorlage**: wer Bereitschaft hat und über welchen Kanal, steht nicht im Code und ist mit `[FESTZULEGEN]` markiert, gesammelt in einer Liste am Ende. Belastbar ist der technische Teil, und der hat eine Eigenheit dieses Systems zur Grundlage: **die Schwere bemisst sich daran, was die Halle noch kann**, nicht an der Zahl betroffener Komponenten. Ein vorbereitetes Tablet arbeitet ohne Server weiter, ein Serverausfall ist also kein Datenverlust. Der unterschätzte Einzelpunkt ist stattdessen der **Identitätsanbieter**: sein Ausfall wirkt harmlos, solange alle angemeldet sind, und wird zum Stillstand beim Schichtwechsel — nachgesehen und bestätigt, dass laufende Sitzungen ihn überstehen (`strategy: 'jwt'`, der Anbieter wird nur bei der Anmeldung befragt). Die Sitzungsdauer von acht Stunden ist damit zugleich die Frist, in der er wieder stehen muss.

**Schulung:** [docs/15](docs/15_TRAINING.md) — rollenbasiert, ausdrücklich keine Wiederholung von docs/07 (Abläufe) und docs/04 (Rechtematrix), sondern das Wie: Reihenfolge, Übungen, und die Stellen, an denen es erfahrungsgemäß klemmt. Wo ein geschulter Ablauf zusätzlich einen E2E-Test hat, steht das dabei — dann ist er nicht nur beschrieben, sondern läuft nachweislich. Der Teil, der beim Piloten am meisten wert sein dürfte, sind die **fünf Missverständnisse**, die Support-Anrufe erzeugen (unter anderem: „abgeschlossen" ist nicht „freigegeben", der grüne Punkt meldet das Gerät und nicht den Server, die PIN-Sperre löst sich selbst). Sie sind aus der Konstruktion abgeleitet, nicht aus Beobachtung — nach dem Piloten gehören sie durch die ersetzt, die wirklich angerufen haben.

**Betriebs-Runbook:** [docs/14](docs/14_RUNBOOK.md) — wiederkehrende Aufgaben, worauf alarmiert wird (und worauf ausdrücklich **nicht**: der HTTP-Status von `/api/health/ready` bleibt bei totem clamd 200, wer darauf alarmiert sieht den Ausfall nie), zehn Störungsbilder mit Symptom, Ursache und Vorgehen, und eine Liste dessen, was nie getan wird. Beim Schreiben ist ein Fehler in der eigenen Betriebsanweisung aufgefallen: **`pnpm exec tsx prisma/seed.ts` scheitert, sobald die Konfiguration nur in einer `.env` steht** — das Skript liest `DIRECT_DATABASE_URL` unmittelbar und lädt selbst kein dotenv; das tut `prisma.config.ts`, und das sieht nur die Prisma-CLI. Die Meldung (`SASL: … client password must be a string`) sieht nach einem Datenbankproblem aus und ist keines. Überall auf `pnpm exec prisma db seed` umgestellt, das in beiden Fällen funktioniert.

**Staging gibt es jetzt als Compose-Datei:** [`infra/staging/docker-compose.staging.yml`](infra/staging/docker-compose.staging.yml), bewusst keine zweite Entwicklungsumgebung — eigener Projektname, eigenes Netz, eigene Ports (Postgres 5443, MinIO 9020/9021, clamd 3320, Keycloak 8091, App 3003) und eigene Volumes unter `infra/staging/.staging-data/` — die relativen Pfade in einer Compose-Datei gelten ab **ihrem** Verzeichnis, nicht ab dem Projektwurzelverzeichnis (`.gitignore` fängt beides). Zwei getrennte Datenbankrollen, `clamd` fest dabei statt optional, Bucket mit eingeschalteter Versionierung, Geheimnisse aus `openssl` statt aus `.env.example`. **docs/13 ist daran durchgespielt worden** — Schritte 1 bis 7 vollständig, und die ✅-Kennzeichen dort stehen für das, was wirklich gelaufen ist. Offen bleibt nur Schritt 8, die drei Messungen.

**Der Upload kann in Staging mehr als die Prüfkette:** `document-upload.spec.ts` bricht bewusst nach dem presignierten `PUT` ab, weil der E2E-Lauf gegen einen Production-Build fährt und dort `MALWARE_SCANNER=stub` hart abgelehnt wird — die Anerkennung der Datei ist dort gar nicht prüfbar. Mit echtem clamd geht der Weg bis zum Ende: `PUT` auf `:9020` mit HTTP 200, keine CSP-Meldung, Hashvergleich und Scan bestanden, Datei im **versionierten** Bucket. Der Offline-Rückfall ebenso: Worker `activated`, 12 Cache-Einträge, `transferSize: 0` ohne Verbindung, Navigation landet im Offline-Arbeitsbereich, `/api/**` bleibt unerreichbar.

**Zwei Funde aus diesem Durchgang**, beide von der Art, die man nur beim Ausführen sieht:

- **`.gitignore` deckte `.env.staging` nicht ab.** Dort standen `.env` (ein exakter Treffer) und `.env*.local` (verlangt die Endung) — eine beim Aufsetzen erzeugte Umgebungsdatei samt frischem `AUTH_SECRET` und `RELEASE_TOKEN_SECRET` wäre eingecheckt worden. Korrigiert zu `.env.*`. Wer eine Umgebungsdatei anlegt, prüft das vor dem ersten `git add` mit `git check-ignore -v .env.<name>`.
- **Ein falsches `OIDC_CLIENT_SECRET` sieht im Browser nach gar nichts aus.** Die Anmeldung führt durch Keycloak hindurch und kommt nicht zurück; der Grund steht ausschließlich im Serverprotokoll (`unauthorized_client — Invalid client or Invalid client credentials`). Das hat beim Aufsetzen die meiste Zeit gekostet, weil man zuerst den Browser verdächtigt. **Beim ersten fehlgeschlagenen Login gehört der Blick ins Serverprotokoll**, nicht in die Konsole des Browsers.
- **Ein neuer Port kostet zwei Listen am OIDC-Client**, nicht eine: `redirectUris` **und** `post.logout.redirect.uris`. Die Realm-Datei führt jetzt 3000, 3002 und 3003 in beiden. Fehlt die zweite, funktioniert die Anmeldung und die Abmeldung scheitert mit „Invalid redirect uri" — also genau das, was auf einem geteilten Tablet den Benutzerwechsel unmöglich macht.

**Staging aufsetzen:** [docs/13](docs/13_STAGING_SETUP.md) ist die Schrittfolge dazu — bewusst keine zweite Referenz, sondern nur das, was docs/12 nicht leisten kann: die Reihenfolge und nach jedem Schritt die Probe, an der man merkt, dass er gewirkt hat. Jeder Schritt trägt ein Kennzeichen, ob er ausgeführt wurde oder aus docs/12 abgeleitet ist. Anlass für die Umgebung sind die drei Prüfungen, die auf keinem Entwicklungsrechner gehen und dieselbe Voraussetzung teilen: Sync-Messung auf Zielhardware, Restore-Probe gegen das echte Backup, externer Penetrationstest.

**Dabei wurde die gefährlichste Anweisung nachgewiesen statt behauptet** — die Reihenfolge „Rolle vor Migration" aus docs/12 §3.1, gegen zwei Wegwerf-Cluster, in beiden Richtungen: Rolle vorher angelegt ⇒ das Passwort aus dem Repository wird abgewiesen; direkt migriert ⇒ es verbindet. Ein Nebenbefund gehört zu jeder künftigen Passwortprobe an einem Postgres-Container: von **innen** greift `host all all 127.0.0.1/32 trust`, dort verbindet jedes beliebige Passwort. Wer die Probe so fährt, prüft nichts und merkt es nicht. Gemessen wird von außen über den gemappten Port.

Die ersten 10 Architekturdokumente in `docs/` sind vor der Implementierung entstanden und sollten bei Unklarheiten zuerst konsultiert werden. `docs/11_OFFLINE_INVARIANT_REVIEW.md` ist anderer Art: ein Prüfbericht nach der Implementierung, entstanden aus dem von docs/10 geforderten Phase-5-Gate.

**ADRs:** vollständig — 001 (Auth, mit Nachtrag zur Sitzungsdauer), 002 (Offline-Speicher), 003 (Dateispeicher), 004 (Audit-Härtung), 005 (Signaturverfahren, in Phase 7 nachgeholt, mit Nachtrag zur PIN-Sperre), 006 (Mandantenmodell), 007 (Export-Jobs, in Phase 6 nachgeholt), 008 (ausgehende Integrationen, Phase 7). [ADR-005](docs/adr/ADR-005-signature-method.md) schreibt nur nieder, was seit Phase 3 gilt und worauf Code-Kommentare seither verwiesen (PIN + Audit-Trail, keine qualifizierte elektronische Signatur). Wer daran arbeitet, sollte vor allem einen Punkt daraus kennen: der `signature_data`-Digest ist **keine** Signatur — er ist über keinen geheimen Schlüssel gebildet, die Zurechenbarkeit trägt der append-only Audit-Trail (ADR-004). Die von ADR-005 ursprünglich als größte Lücke benannte fehlende PIN-Fehlversuchssperre ist seit Phase 7 geschlossen (Nachtrag im ADR).

---

## Lokale Umgebung starten

```bash
docker compose up -d postgres minio minio-init keycloak
pnpm install
pnpm exec prisma migrate deploy
pnpm exec prisma db seed
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
# Läuft der Dev-Server auf demselben Port, vorher stoppen. Das Bündelungs-
# problem gibt es seit Next 16 nicht mehr (getrennte Ausgabeverzeichnisse),
# der Portkonflikt schon — siehe Stolperstein zu .next.
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

**Bestätigungs-PIN der Demo-User: `1234`** (Seed setzt einen scrypt-Hash in `users.confirmation_pin_hash`). Ohne PIN kann ein Arbeitsschritt nicht bestätigt/abgeschlossen werden. Echte Benutzer setzen ihre PIN selbst unter **Mein Konto** (`/account`); geseedet wird sie nur für Demo und Test. **Dieser Satz beschrieb bis zur Umsetzung eine Absicht, keine Funktion** — es gab keinen Weg dorthin, `confirmation_pin_hash` wurde ausschließlich vom Seed geschrieben, und ein frisch angelegtes echtes Konto war damit arbeitsunfähig. Die Demo-PIN `1234` lässt sich über das Formular übrigens **nicht** wählen: fortlaufende Ziffernfolgen weist die Regel ab, und der Seed umgeht sie, weil er den Hash unmittelbar schreibt.

**Auf einer leeren Installation kommen die Stammdaten zuerst** — der Seed liefert sie nur für die Demo-Organisation. Unter **Administration** (`/admin`, als ADMIN): Standort → optional Abteilung und Arbeitsplatz → Kunde → Personen einladen. Eine eingeladene Person ist noch nicht arbeitsfähig: sie muss sich einmal anmelden und unter **Mein Konto** (`/account`) ihre Bestätigungs-PIN setzen. Die Liste in der Administration zeigt beides an („wartet auf ersten Login", „keine PIN gesetzt"). Produkte gehören nicht dorthin, sondern ins Projekt (PL).

Ein durchgängiger Ausführungsflow braucht dann: Projekt anlegen (PL) → Produkt im Projekt anlegen (PL) → Fertigungsplan mit Schritten + Anforderungen anlegen (PL) → einreichen (PL) → genehmigen (QM) → freigeben (PL) → Produktionsauftrag anlegen/einplanen/freigeben und einem Worker zuweisen (PM) → Worker sieht ihn unter **Meine Aufträge**.

Für den Qualitätsfluss zusätzlich: Prüfmittel unter **Prüfmittel** anlegen und kalibrieren (QM) — ohne gültige Kalibrierung wird eine Messung abgelehnt, sobald das Prüfmerkmal ein Prüfmittel verlangt. Gemeldete und automatisch erzeugte Abweichungen stehen unter **Abweichungen** (QM: bewerten → Sofortmaßnahme → Nacharbeit → Nachprüfung → Disposition). Die Nachprüfung kann nur ausführen, wer die Rolle INSPECTOR hat.

Für die ERP-/Webhook-Anbindung (als ADMIN): `POST /api/v1/integrations/webhooks` mit `name`, `url` und `eventTypes` — **das Geheimnis steht nur in dieser einen Antwort**. Zustellung läuft nicht von selbst, sondern über `POST /api/v1/integrations/webhooks/dispatch`; lokal von Hand aufrufen, in Produktion aus dem Scheduler. Für einen Empfänger auf dem eigenen Rechner `ALLOW_PRIVATE_WEBHOOK_TARGETS=true` setzen — sonst weist der SSRF-Schutz Loopback-Adressen zu Recht ab (in Produktion wirkungslos).

Für die Produktfreigabe: Akte des Auftrags öffnen, Abschnitt **9. Endprüfung und Produktfreigabe** — dort steht die Entscheidung, und als QM auch das Formular (Begründung + PIN). Freigeben geht erst, wenn der Auftrag abgeschlossen und nichts mehr offen ist; ablehnen jederzeit. Die neuen Atome `product_release.*` kommen nur über einen erneuten Seed-Lauf in bestehende Organisationen.

Für die Dokumentbindung: Dokument im Projekt anlegen, hochladen, einreichen (PL) → genehmigen und freigeben (QM) → im Fertigungsplan (Status DRAFT) beim Arbeitsschritt unter **Verbindliche Dokumente** die Revision auswählen, optional Seite und Markierung. Ohne freigegebene Revision im selben Projekt steht dort ein Hinweis statt einer leeren Auswahlliste. Nach dem Einreichen des Plans lässt sich nichts mehr binden oder entfernen.

Für die Akte: **Suche** öffnen, Seriennummer eingeben, beim Auftrag auf **Produktionsakte** — dort stehen dieselben zehn Abschnitte wie im PDF, darunter der Export. Das ZIP enthält Akte, Originalnachweise und `manifest.json`; der Downloadlink ist eine kurzlebige signierte URL. **Übersicht** und **Benachrichtigungen** sind rollenabhängig: wer nichts entscheiden darf, sieht keine offenen Entscheidungen.

Für den Offline-Fluss: **Offline** öffnen (registriert das Gerät beim ersten Aufruf mit Verbindung), **Für Offline vorbereiten** laden, Netzwerk trennen (DevTools → Network → Offline), Schritt starten/erfassen/lokal abschließen, Netzwerk wieder verbinden, **Jetzt synchronisieren**. Konflikte landen unter **Konflikte** (PL/QM entscheiden mit PIN). Der Service Worker läuft nur im Production-Build — in `next dev` würde er HMR-Antworten cachen, siehe `src/components/ServiceWorkerRegistration.tsx`.

### Zustand der lokalen Demo-Daten

**Ob die Container laufen, sagt `docker compose ps` — verlass dich nicht auf diesen Absatz.** Die Daten überleben beides: Postgres und MinIO liegen unter `./.docker-data/`, ein `docker compose up -d` bringt alles unverändert zurück. Die Daten sind da: Postgres und MinIO liegen unter `./.docker-data/`, ein `docker compose up -d` bringt alles unverändert zurück. Einzige Ausnahme ist **Keycloak**, das kein Volume hat (`KC_DB: dev-file`) und den Realm bei jedem Start neu aus `infra/keycloak/proquado-realm.json` aufbaut — seit die Benutzer-IDs dort festgeschrieben sind, ist das folgenlos, die Anmeldungen funktionieren weiter (siehe „Ein Keycloak-Neuaufbau entwertete alle Kontoverknüpfungen").

Wer die Umgebung übernimmt, findet die Daten darin **nicht** im Auslieferungszustand vor — das ist kein Fehler, aber gut zu wissen:

- **Vier der fünf Demo-Konten sind verknüpft** (`worker.test`, `pl.test`, `qm.test`, `admin.test` — sie melden sich bei jedem E2E-Lauf über Keycloak an); **`pm.test` steht noch auf `pending:<email>`** und bindet sich beim nächsten Login (siehe „Ein Keycloak-Neuaufbau entwertete alle Kontoverknüpfungen"). Nichts zu tun, nur nicht wundern, wenn `users.external_id` so aussieht.
- **Der Demo-Auftrag `AUF-2026-23991` ist vollständig `COMPLETED` und bereits freigegeben** — beide Schritte abgeschlossen mit Nachweisen aus dem Offline-Durchlauf, dazu zwei Freigabeentscheidungen (`REJECTED` → `RELEASED`) aus dem Test von Abschnitt 9. **Damit ist er als Vorlage für beide Abläufe verbraucht**: eine zweite Freigabe verweigert die Datenbank, und der Offline-Durchlauf braucht Schritt 1 wieder in `READY`. Für eine Wiederholung von einem der beiden zurücksetzen (unten) — das Skript räumt auch die Freigabeentscheidungen weg.
- Zusätzlich liegen ein Fertigungsplan (`FP-…`, DRAFT) und eine freigegebene Zeichnung (`ZG-…`) im Demo-Projekt, angelegt für den Test der Dokumentbindung.
- `MALWARE_SCANNER` steht in der lokalen `.env` auf `stub`. Der clamd-Container ist mit heruntergefahren worden; seine Signaturen liegen in `./.docker-data/clamav` und müssen nicht erneut geladen werden.
- **Jeder E2E-Lauf hinterlässt ein eigenes Projekt** mit Plan, Auftrag und Nachweisen, alles unter dem Präfix `E2E-` (Projektnummer `E2E-PROJ-…`). Absichtlich nicht aufgeräumt: Ausführungsdaten hängen an einem append-only Audit-Trail, und ein Testaufräumen, das genau die Zeilen löscht, deren Unlöschbarkeit die Zusicherung ist, wäre die falsche Übung. Es ginge auch nicht nebenbei — die Fremdschlüssel auf `projects` stehen sämtlich auf `RESTRICT` (nachgesehen in `pg_constraint`), ein `DELETE FROM projects …` scheitert also an Plänen, Aufträgen und Dokumenten. Wenn die Liste wirklich stört, ist der Weg `prisma migrate reset` plus Seed, nicht ein Aufräum-SQL.
- **Seit es die Administration gibt, hinterlässt der E2E-Lauf auch Stammdaten**: je Lauf ein Standort `E2E-S-…`, ein Kunde `E2E-K-…` und ein eingeladenes Konto `e2e-…@proquado.local`, das dauerhaft auf seinen ersten Login wartet. Dieselbe Überlegung wie beim Rest: nicht aufgeräumt, weil die Zeilen an Projekten und am Audit-Trail hängen. Die eingeladenen Konten stören nichts — sie haben keine PIN und können nichts bestätigen.
- **Der Lasttest hinterlässt deutlich mehr**: je Lauf ein Projekt `LOAD-P-…` mit einem Plan, bis zu 200 Aufträgen (`LOAD-A-…`), ebenso vielen Geräten und einer großen Akte mit 500 Schritten und 2000 Fotos. Die Projekt- und Auftragslisten sind danach lang. Gleiche Überlegung wie beim E2E-Präfix: nicht aufgeräumt, weil an den Daten ein append-only Audit-Trail hängt. Wer eine aufgeräumte Umgebung braucht, setzt sie zurück (`prisma migrate reset` plus Seed), statt einzelne Zeilen zu löschen.
- Der Seed ist zuletzt nach dem Hinzukommen von `customer.manage` und `product.manage` gelaufen; beide Atome sind in der Demo-Organisation vorhanden. **Webhook-Abonnements gibt es keine** — wer die Zustellung ausprobieren will, legt eines an und ruft den Dispatch-Endpunkt von Hand auf (oben unter „Für die ERP-/Webhook-Anbindung").

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

Inzwischen 32 Einträge, in der Reihenfolge ihres Auftretens. Wonach hier zu suchen lohnt, nach Anlass sortiert:

- **Etwas läuft in `next dev`, aber nicht im Production-Build** (oder umgekehrt): „Dieselbe CSP verhinderte in Production jede Hydration", „Dieselbe CSP hätte in Production jeden Upload verhindert", „`pnpm run build` neben laufendem `next dev`", „pdfkit findet seine Schriftmetriken nicht", „`pino-pretty` + Next.js Dev-Server", „ESM-only Abhängigkeiten", „Der Service Worker eines Production-Laufs beliefert danach den Dev-Server".
- **Die Anmeldung schlägt fehl oder zeigt den falschen Benutzer**: „Ein Keycloak-Neuaufbau entwertete alle Kontoverknüpfungen" (die Meldung lautet „Access Denied" und meint etwas anderes), „Es gab keine Abmeldung", „Der Seed legt nach dem ersten Login Doppelbenutzer an".
- **Der Offline-/Sync-Pfad verhält sich unerwartet**: „Der Offline-Fluss konnte nie synchronisieren", „Zwei Klicks im selben Tick", „Ein geteiltes Tablet konnte den Benutzer nicht wechseln", „Sitzungsdauer und Access-Token-Dauer".
- **Eine Schaltfläche tut nichts oder die Seite bricht ab**: „Der Abschlussknopf war dauerhaft gesperrt", „Eine geworfene Ablehnung reißt in Next.js die ganze Seite weg", „Eine `'use server'`-Datei darf ausschließlich async-Funktionen exportieren" (bricht den Build, nicht die Seite — aber dieselbe Ecke).
- **Ein Test ist grün und beweist trotzdem nichts**: „Jest entscheidet `skip` beim Einlesen", „Ein Test, der versehentlich echte Infrastruktur anspricht", „Eine Kontrolle, die nur einen von zwei Pfaden kennt".
- **Eine Messung sagt etwas anderes, als sie zu sagen scheint**: „Blockweise verglichene Konfigurationen messen die Maschine, nicht die Konfiguration".
- **Eine Änderung wirkt nicht, obwohl sie richtig ist**: „Der Service Worker eines Production-Laufs beliefert danach den Dev-Server", „Eine Regel mitten in eine Selektorliste zu setzen, bemerkt keine Prüfstufe".
- **Datenbank und Schema**: „Eine bereits angewendete Migration nachträglich zu ändern", „Prisma-Client-Regenerierung erfordert Server-Neustart", „Relationsnamen bei bidirektionalen Prisma-Beziehungen", „Abgelehnte Vorgänge dürfen nicht in derselben Transaktion geworfen werden", „Berechtigung hängt manchmal von Daten ab".
- **Einzeln stehend**: „Portkonflikte mit anderen Projekten", „CSP blockiert Dev-Tooling und OAuth-Redirect" (die Vorgeschichte des CSP-Eintrags oben), „Browser-Tool: Klick-Koordinaten können bei mehrzeiligen Überschriften driften", „`getByRole('alert')` trifft in Next.js auch den Routenansager", „Die CI war sieben Phasen lang nie gelaufen".

### Portkonflikte mit anderen Projekten

Auf dieser Maschine liefen parallel andere Next.js-Projekte auf Port 3000/3001. `.env.example` und die Keycloak-Realm-Config (`infra/keycloak/proquado-realm.json`) gehen von Port **3000** aus. Falls belegt: `.claude/launch.json` auf einen freien Port ändern (aktuell `3002` konfiguriert) **und** die lokale `.env` (`AUTH_URL`) entsprechend anpassen. Die Keycloak-Realm-Config akzeptiert bereits beide Redirect-URIs (3000 und 3002).

### `pino-pretty` + Next.js Dev-Server

`pino`s Standard-Transport (`transport: { target: 'pino-pretty' }`) nutzt Worker Threads, die Next.js' Server-Bundling nicht auflösen kann (`Cannot find module .next/server/vendor-chunks/lib/worker.js`, crasht jeden Request). Fix in `src/lib/logger/index.ts`: `pino-pretty` als synchroner Destination-Stream statt als Transport. Nicht zurückändern.

**Beim Sprung auf pino 10 nachgeprüft, weil keine Prüfstufe hier hinsieht:** die CI baut und testet ausschließlich mit `NODE_ENV=production`, wo der Pretty-Stream gar nicht entsteht — ein Bruch an dieser Stelle wäre also grün durchgelaufen und erst auf dem nächsten Entwicklungsrechner aufgefallen. Geprüft wurde deshalb von Hand: Pretty-Ausgabe und Redaction (`pin`, verschachteltes `token`) unter `NODE_ENV=development`, und ein laufender `next dev`, der `/login` und `/api/health/ready` mit 200 beantwortet, ohne die Worker-Meldung von damals.

**Bei pino-pretty 13 dieselbe Prüfung, aus demselben Grund** — und sie ist die einzige, die diese Anhebung überhaupt belegt. Die Kette wäre auch grün gewesen, wenn der Dev-Logger zerbrochen wäre. Ergebnis: Pretty-Ausgabe mit Farben, `pin`, verschachteltes `token` und `password` jeweils `[REDACTED]`, unter `NODE_ENV=production` unverändert JSON in einer Zeile; `next dev` antwortet auf `/login` und `/api/health/ready` mit 200, ohne Worker-Meldung. Inhaltlich brachten 12 und 13 nur das Anheben der Node-Untergrenze und den Wechsel von `readable-stream` auf Nodes eingebautes Stream-Modul — nichts an der Aufrufform, die `src/lib/logger/index.ts` benutzt.

### CSP blockiert Dev-Tooling und OAuth-Redirect

Eine strikte `Content-Security-Policy` (`script-src 'self'`, `form-action 'self'`) verhindert sowohl Next.js' HMR (inline Scripts) als auch den Redirect zu Keycloak (`form-action` erlaubt nur die eigene Origin). Erste Fassung: CSP nur in Production, `form-action` schließt dort die OIDC-Issuer-Origin ein. Die Hälfte davon war falsch — siehe den nächsten Eintrag.

### Dieselbe CSP verhinderte in Production **jede** Hydration

Der gravierendste Fund der Phase, gefunden beim ersten `pnpm run start` dieses Projekts.

Der Eintrag oben schloss aus „Next.js' Dev-Modus benutzt Inline-Skripte", die CSP gehöre deshalb nur in Production. Beide Prämissen stimmen, die Folgerung nicht: **auch der Production-Build liefert Inline-Skripte aus** — sie tragen den RSC-Payload und den Hydrations-Bootstrap. `script-src 'self'` blockierte sie. In der Konsole: eine Wand aus CSP-Verstößen, React-Fehler **#423** (Hydrationsabbruch) und „Connection closed" (abgerissener RSC-Stream).

Die Wirkung war total: **kein einziges Client-Element funktionierte.** Keine PIN-Dialoge, keine Produktfreigabe, keine Dokumentbindung, kein Offline-Arbeitsbereich, keine Service-Worker-Registrierung. Die Anwendung sah aus wie eine statische Seite.

Warum nichts davon auffiel: die CSP ist in der Entwicklung **abgeschaltet**. Typecheck, Unit- und Integrationstests und `next build` laufen alle, ohne dass sie je greift. Erst `next start` bringt sie zur Anwendung — und das hatte in sieben Phasen niemand getan.

Behoben mit einer Nonce je Anfrage (heute `src/proxy.ts`, bis Next 16 `src/middleware.ts`): Next.js stempelt die Nonce auf die Skripte, die es selbst erzeugt, sodass sein Bootstrap läuft und später eingeschleuste Skripte nicht. `'strict-dynamic'` erlaubt den so freigegebenen Skripten, ihre Chunks nachzuladen. `'unsafe-inline'` wäre eine Zeile gewesen und hätte den Zweck der CSP aufgegeben.

**Zwei Fallstricke auf dem Weg:**

- Die Nonce muss auf den **Request**-Headern stehen, nicht nur auf der Antwort — nur dann sieht Next sie und stempelt seine eigenen Skripte. Steht sie nur auf der Antwort, bleibt alles blockiert und der Fehler sieht unverändert aus.
- Bei einem Projekt mit `src/`-Verzeichnis gehört die Datei nach **`src/proxy.ts`**. Im Projektwurzelverzeichnis wird sie stillschweigend ignoriert.

**Die Probe darauf hat sich mit Next 16 geändert, und die alte ist jetzt irreführend.** Bis Next 15 galt: steht nach dem Build `"middleware": {}` in `.next/server/middleware-manifest.json`, wurde die Datei nicht gefunden. In Next 16 steht dort **immer** `{}`, auch bei einwandfrei registriertem Proxy — die Registrierung ist nach `.next/server/functions-config-manifest.json` gewandert und heißt dort `/_middleware`, mitsamt dem eigenen `matcher` und `"runtime": "nodejs"`. Wer die alte Probe weiterbenutzt, diagnostiziert einen Fehler, den es nicht gibt. Die belastbare Probe ist ohnehin eine andere und kostet nicht mehr: den Production-Server starten und in **einer** Anfrage Header und HTML vergleichen — die Nonce aus `Content-Security-Policy` muss an den `<script>`-Tags derselben Antwort stehen. Zwei getrennte `curl`-Aufrufe taugen dafür nicht, denn die Nonce wird je Anfrage neu gezogen. Genau das prüft `production-csp.spec.ts`.

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

**Erledigt mit Next 16, und zwar an der Ursache:** `next dev` schreibt seither nach `.next/dev`, `next build` nach `.next/server` — getrennte Verzeichnisse, dazu eine Sperrdatei gegen zwei gleichzeitige Instanzen desselben Kommandos. Nachgeprüft statt geglaubt: ein voller `pnpm run build` neben einem laufenden Dev-Server, danach antwortet der Dev-Server unverändert mit `200` auf `/` und `/login`. Die Regel oben ist damit hinfällig — **ein Grund bleibt aber**, beides nicht gleichzeitig zu starten: der E2E-Lauf belegt Port 3002, und den belegt der Dev-Server nach `.claude/launch.json` ebenfalls. Das ist ein Portkonflikt, kein Bündelungsproblem, und die Meldung sagt das auch.

### Prisma-Client-Regenerierung erfordert Server-Neustart

Nach `prisma generate` (z. B. nach Schema-Änderungen) muss der laufende `next dev`-Prozess neu gestartet werden — Hot Reload lädt den neu generierten Client nicht automatisch nach.

**Und: jedes `pnpm add`/`pnpm remove` kann den generierten Client wegräumen.** Er liegt nicht im Repository, sondern im Paketverzeichnis; schreibt pnpm dort um, ist er weg. Die Meldung führt dann in die Irre, weil sie nach einem Typproblem aussieht statt nach einem fehlenden Generat:

```
error TS2305: Module '"@prisma/client"' has no exported member 'PrismaClient'
```

Aufgetreten beim Anheben auf TypeScript 6 — direkt nach einem `pnpm add -D typescript@6`, also genau dort, wo man den Fehler der neuen Compilerversion zuschreibt. Behoben mit `pnpm exec prisma generate`. Beim nächsten `pnpm add` (pino-pretty) trat er sofort wieder auf; es ist also kein Einzelfall, sondern die Regel.

**Wonach man dabei nicht sucht:** `node_modules/.prisma/client`. Unter Prisma 7 mit pnpm liegt das Generat im Store, beim Paket selbst — der Pfad im Projektwurzelverzeichnis existiert auch nach einem erfolgreichen `generate` nicht. Ein `ls` darauf beantwortet die Frage also nie, egal wie plausibel er aussieht (hier stand eine Weile genau diese falsche Probe). Die Probe ist der Typecheck, oder schlicht `prisma generate` selbst: es ist idempotent und dauert eine Drittelsekunde.

**Regel:** Nach einer Abhängigkeitsänderung, deren Folgefehler `@prisma/client` betreffen, erst neu generieren und dann urteilen.

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

**Dependabot schlägt es trotzdem jeden Monat wieder vor — deshalb steht `archiver` ab 8 jetzt im `ignore`-Block** von `.github/dependabot.yml`, samt `@types/archiver`: getrennt ignoriert käme der Typ-Teil allein wieder und passte dann nicht zur Laufzeitversion. Dieselbe Überlegung wie bei ESLint 10 (Übergabe Punkt 4): die CI hält den PR ohnehin auf, aber ein Vorschlag, der planmäßig scheitert und monatlich wiederkommt, erzieht dazu, rote Läufe zu überfliegen. Wieder entfernen, sobald Jest und der Next-Build ESM tragen — die Probe ist der Versuch gegen beide Läufe, nicht der Typecheck.

### Der Abschlussknopf war dauerhaft gesperrt — durch die Bestätigung, die er selbst erzeugt

Beim Browser-Test der PIN-Sperre aufgefallen, und der schwerste UI-Fehler bisher: **kein Arbeitsschritt ließ sich vom Online-Bildschirm abschließen.** Der Knopf stand auf „Abschließen (1 fehlend)" und war deaktiviert, auch nachdem alle Nachweise erfasst waren.

Die eine fehlende Anforderung war `CONFIRMATION_MISSING` — die Bestätigung, die das Formular mit dem PIN-Feld gerade erzeugen will. `openRequirementCount` zählt sie mit, `signature_required` steht auf **jedem** Planschritt, also war der Knopf immer gesperrt. Serverseitig war nichts falsch: `submitWorkStepCompletion` schreibt die `StepConfirmation` und validiert erst danach, die Lücke ist zum Prüfzeitpunkt also geschlossen.

Zweiter Fund derselben Zeile: der Knopf sperrte auch bei **Toleranzverletzungen**. Damit erreichte ein Messwert außerhalb der Toleranz den Server nie — und weil die NCR erst beim Abschluss entsteht (Abnahmeszenario D), erfuhr die Qualitätssicherung von der Abweichung überhaupt nichts. Eine Sperre, die verhindert, dass ein Fehler gemeldet wird.

Getrennt in zwei Fragen, die vorher eine waren: `openRequirementCount` bleibt, was die Liste „Offene Anforderungen" zeigt — alles, was der Server gerade ablehnen würde, inklusive Bestätigung und Toleranzverletzung, denn der Mitarbeiter soll das sehen. `requirementsBlockingCompletion` ist das, was den Knopf sperren darf: fehlende Nachweise, die der Mitarbeiter noch liefern kann. Nur Letzteres steckt jetzt im Knopf.

**Warum keine andere Kontrolle das sah:** Integrationstests rufen `submitWorkStepCompletion` direkt, der Knopf kommt darin nicht vor. Die Unit-Tests prüften `evaluateStepRequirements`, das korrekt ist. Und der Offline-Weg hat sein eigenes Formular. Es gab keinen Test, der die Frage „darf der Knopf gedrückt werden" überhaupt stellte — jetzt gibt es drei.

### Eine `'use server'`-Datei darf ausschließlich async-Funktionen exportieren

Beim Bau der Stammdatenformulare aufgetreten. Neben den Aktionen stand, was daneben zu stehen scheint:

```ts
export const INITIAL_PRODUCT_STATE: ProductFormState = { error: null, result: null };
```

`next build` bricht daran ab — „A `use server` file can only export async functions, found object" —, und zwar nicht beim Kompilieren, sondern beim Einsammeln der Seitenkonfiguration. **Typecheck und Lint sehen nichts**: es ist gültiges TypeScript, die Regel gehört Next.js. Exportierte **Typen** sind unproblematisch, sie werden ohnehin gelöscht.

Behoben, indem der Initialzustand in der Client-Komponente steht — wo die übrigen Formulare dieses Projekts ihn ohnehin schon hatten (`DossierExportForm`). Die Abweichung war meine, das etablierte Muster war richtig.

**Bemerkenswert daran ist die Einordnung:** dieselbe Familie wie „pdfkit findet seine Schriftmetriken nicht" und die CSP-Einträge — ein Fehler, den nur ein vollständiger Build sieht. Wer nach einer Änderung an Server Actions nur `typecheck` und `lint` laufen lässt, hat die Stufe ausgelassen, die ihn findet.

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

### Blockweise verglichene Konfigurationen messen die Maschine, nicht die Konfiguration

Beim Durchmessen der Sync-Hebel (Messreihe unter „Lasttest") liefen die ersten Vergleiche blockweise: erst alle Läufe mit Poolgröße 10, dann alle mit 25, dann 50, dann 80. Das Ergebnis sah eindeutig aus — Pool 10 mit 17,4 Stapel/s gegen 58,8 bei Pool 25, also Faktor drei — und war falsch. **Verschränkt** gemessen (10, 25, 10, 25, …) verschwindet der Unterschied vollständig: 66,1/69,7/67,8/67,5 gegen 67,4/67,7/63,3/67,6.

Die Ursache ist eine Drift der Maschine über die Sitzung: dieselbe Konfiguration lieferte zu verschiedenen Zeitpunkten 57 bis 70 Stapel/s. Blockweise gemessen liegt jede Konfiguration in einem anderen Zeitfenster, und die Drift wird ihr zugeschrieben. Ein einzelner Ausreißer verstärkt das noch — der erste Lauf einer Sitzung ist regelmäßig der langsamste (kalte Container, kalter Seitencache), und blockweise trifft er immer dieselbe Konfiguration.

Dasselbe Verfahren kippte einen zweiten Befund in die Gegenrichtung: blockweise sahen mehrere Organisationen wirkungslos aus (59,9 gegen 62,9 Stapel/s), verschränkt gewinnen vier Organisationen **4 von 4** Runden mit +15 %.

**Lehre:** Wer zwei Konfigurationen desselben Lasttests vergleicht, misst sie verschränkt und wertet **paarweise** aus — „gewinnt in 4 von 4 Runden" trägt, „im Mittel 9,7 Stapel/s schneller" trägt auf einer driftenden Maschine nicht. Und ein Unterschied, der nur in einer Richtung auftritt und dabei größer ist als die Streuung derselben Konfiguration, ist zuerst verdächtig und erst danach ein Befund.

### Der Service Worker eines Production-Laufs beliefert danach den Dev-Server

Eine Änderung an `globals.css` blieb im Browser wirkungslos. Server neu gestartet: unverändert. `.next` gelöscht und neu gestartet: unverändert. Die Datei auf der Platte war richtig, der Prozess frisch, das Arbeitsverzeichnis das richtige — und der Browser zeigte weiter den alten Stand.

Der Grund stand nicht im Projekt, sondern im Browser:

```js
navigator.serviceWorker.controller; // http://localhost:3002/sw.js
await caches.keys(); // ['proquado-shell-v1']
```

Ein früherer `pnpm run start` auf **demselben Port** hatte den Service Worker registriert. Er überlebt das Ende des Prozesses, kontrolliert die Origin weiter und liefert Seite, CSS und Chunks aus seinem Cache — genau das, wofür er in der Halle da ist. Für den Dev-Server auf Port 3002 heißt das: er baut korrekt, und niemand sieht es.

Besonders tückisch ist die Fehlersuche, zu der das verleitet. Alles zeigt auf den eigenen Code: die Klasse hängt am Element, die Regel steht in der Datei, der Prozess ist neu. Also sucht man den Fehler dort, wo keiner ist. Erkennen lässt es sich an einer Kleinigkeit — das ausgelieferte Stylesheet ist **kleiner**, als die Datei sein müsste.

**Was hilft:**

```js
for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
```

**Lehre:** Wer nach einem Production-Lauf auf demselben Port weiterentwickelt, meldet den Service Worker ab, bevor er dem Dev-Server misstraut. Und wenn eine Stiländerung wirkungslos scheint, ist die erste Frage nicht „stimmt mein CSS", sondern **„sehe ich überhaupt mein CSS"** — nachzusehen mit einem `fetch` auf die Stylesheet-URL und einer Suche nach dem neuen Selektor.

### Eine Regel mitten in eine Selektorliste zu setzen, bemerkt keine Prüfstufe

Beim Vergrößern der Zielgrößen kam eine Regel für Kontrollkästchen dazu. Sie landete drei Zeilen zu weit oben:

```css
.touch-target,
.tablet button,
.tablet select,
.tablet input[type='text'],
/* … erklärender Kommentar … */
input[type='checkbox'],
input[type='radio'] {
  width: 24px;
  height: 24px;
}
```

**Ein Kommentar beendet keine Kommaliste.** Für den Parser steht dort eine einzige Regel, und `.touch-target` und `.tablet button` erbten klaglos `width: 24px`. Die Knöpfe im Offline-Arbeitsbereich schrumpften von 196 auf **34 px** und überlappten einander.

Nichts davon war zu sehen, außer auf dem Bildschirm: **Prettier hat es formatiert** (es ist ja gültiges CSS), **ESLint prüft kein CSS**, der Typecheck erst recht nicht, und kein Test rendert eine Seite und misst Knopfbreiten. Aufgefallen ist es nur, weil ein Screenshot angesehen wurde — die Messung der Zielgrößen allein hätte es nicht gefunden, denn gemessen wurde auf anderen Bildschirmen.

**Lehre:** Eine mehrzeilige Selektorliste sieht aus wie mehrere Regeln und ist eine. Wer in einem fremden Stylesheet etwas einfügt, prüft zuerst, ob die Zeile darüber mit einem Komma endet. Und: nach jeder Stiländerung mindestens **eine** betroffene Seite ansehen, nicht nur die geänderten Werte nachmessen — dieselbe Regel wie beim Durchspielen im Browser, nur eine Ebene tiefer.

### `prisma format` erfindet Felder, um einen falsch platzierten Rückverweis zu bedienen

Das neue Modell `WorkStepSupplement` verweist auf `DocumentRevision`. Der Rückverweis landete beim Einfügen ein Modell zu früh — in `Document`, weil beide Modelle dieselben Feldzeilen (`stepBindings`, `ifcDrawingReferences`) tragen und die Textersetzung die **erste** Fundstelle traf.

Danach lief `prisma format`. Es hat den Fehler nicht gemeldet, sondern **repariert**: dem Modell wurde stillschweigend

```prisma
document   Document? @relation(fields: [documentId], references: [id])
documentId String?
```

hinzugefügt, damit der Rückverweis in `Document` ein Gegenüber hat. Das Schema war danach gültig (`prisma validate` 🚀), der Client ließ sich erzeugen, **der Typecheck lief durch** — und die Migration, die vorher geschrieben worden war, kannte die Spalte `documentId` natürlich nicht.

Aufgefallen ist es erst im Integrationstest:

```
The column `work_step_supplements.documentId` does not exist in the current database.
```

Die Meldung nennt eine Spalte, die niemand geschrieben hat. Wer sie für einen Migrationsfehler hält, sucht an der falschen Stelle — die Migration ist richtig, das **Schema** hat sich verändert.

**Lehre:** Nach `prisma format` das Diff des Schemas ansehen, nicht nur den Exit-Code. Und bei einem neuen Modell einmal prüfen, an welchem Modell die Rückverweise tatsächlich stehen:

```bash
grep -n "meinRueckverweis" prisma/schema.prisma | while read -r l; do n=${l%%:*}; echo "$n -> $(awk -v n=$n 'NR<=n && /^model /{m=$0} NR==n{print m}' prisma/schema.prisma)"; done
```

Verwandt mit „Relationsnamen bei bidirektionalen Prisma-Beziehungen" weiter oben — dort war der Name das Problem, hier der Ort.

### Eine Erfolgsmeldung, die in der Bedingung steckt, die sie aufhebt

Die Schaltfläche „Zeichnungsverweise nachschlagen" stand unter `openDrawingCount > 0` — sinnvoll, ein Knopf ohne Gegenstand lädt nur dazu ein, ihn zu drücken und nichts zu erfahren. Die Erfolgsmeldung war Zustand der Client-Komponente und stand deshalb **im Formular**:

```tsx
{openDrawingCount > 0 && <ResolveDrawingReferencesForm … />}
```

Nach einem erfolgreichen Lauf ist kein Verweis mehr offen. Also verschwand das Formular — samt der Meldung, die eine Zehntelsekunde vorher entstanden war. Wer drückte, sah die Zeichnung unter „Verbindliche Dokumente" auftauchen und bekam kein Wort dazu, ob das nun der Knopf war oder Zufall.

**Die Bedingung gehört in die Komponente, nicht um sie herum.** Nur sie weiß, ob sie noch etwas zu sagen hat:

```tsx
if (openCount === 0 && !state.message && !state.error) return null;
```

Gefunden beim Durchspielen im Browser; Typecheck, Lint und sechs Integrationstests waren grün. Ein E2E-Test hält es jetzt fest, und die Gegenprobe ist gemacht — mit der alten Bedingung schlägt er an Zeile 42 fehl.

**Lehre:** Wenn eine Aktion die Bedingung beseitigt, unter der ihr eigenes Bedienelement steht, verschwindet mit dem Element auch die Antwort. Beim Entwerfen einer solchen Schaltfläche einmal zu Ende denken: **was sieht der Benutzer unmittelbar nach dem Erfolg?**

Am selben Bildschirm trat zusätzlich **Stolperstein #30 erneut auf** — der Service Worker eines früheren Production-Laufs lieferte das alte Client-Bündel, und der Knopf blieb sichtbar, obwohl der Server längst `openCount: 0` schickte. Die Serverdaten daneben waren frisch, was die Suche zuerst in die falsche Richtung schickte. Merkmal für das nächste Mal: **frische Serverdaten plus veraltetes Verhalten einer Client-Komponente** heißt altes Bündel, nicht falscher Code.

### Ein privates Repository verliert seine Schutzregel — und bekommt sie nicht zurück

Das Repository war zwischenzeitlich wieder **privat** geschaltet. Aufgefallen ist das nicht daran, dass jemand es gemerkt hätte, sondern an einem roten CodeQL-Lauf mit einer Meldung, die nichts mit Code zu tun hat:

```
Resource not accessible by integration
CodeQL job status was configuration error
```

Drei API-Abfragen sagten dann dasselbe:

```
gh api .../branches/main/protection    → 403 "Upgrade to GitHub Pro or make this repository public"
gh api .../rulesets                    → 403 dieselbe Meldung
gh api .../code-scanning/default-setup → 403 "Code scanning is not enabled"
```

**Zwei Sicherungen waren damit still weg**: die Branch Protection auf `main` und das Code Scanning. Direktes Pushen auf `main` war wieder möglich, und `gh pr merge --auto` hätte wieder sofort gemergt statt auf grün zu warten — genau der Weg, auf dem PR #3 vor seinen eigenen Checks landete. Gemerkt hätte man es erst an den Folgen.

**Und das Wichtigste**: Wieder öffentlich zu schalten bringt die Regel **nicht** zurück. GitHub hat sie gelöscht, nicht stillgelegt —

```
gh api .../branches/main/protection → 404 "Branch not protected"
```

— sie muss neu angelegt werden. Die Job-Namen dafür holt man aus einem tatsächlich gelaufenen grünen CI-Lauf und tippt sie nicht ab; ein Tippfehler in `contexts` blockiert jeden künftigen Merge auf einen Check, den es nicht gibt:

```bash
gh run view <id> --json jobs -q '.jobs[].name'
```

```bash
gh api -X PUT repos/<owner>/<repo>/branches/main/protection --input - <<'JSON'
{"required_status_checks":{"strict":true,"contexts":["lint-and-typecheck","unit-tests","integration-tests","e2e-tests","build"]},"enforce_admins":true,"required_pull_request_reviews":null,"restrictions":null}
JSON
```

CodeQL gehört **nicht** in `contexts`, solange Code Scanning nicht eingeschaltet ist — als erforderliche Prüfung sperrte es sonst jeden Merge.

**Nachgeprüft statt geglaubt**, denn eine angelegte Regel ist noch keine wirksame: ein leerer Probe-Commit direkt auf `main` wurde abgewiesen (`GH006: Protected branch update failed … 5 of 5 required status checks are expected`) und danach zurückgenommen.

**Lehre:** Eine Schutzeinstellung, die an der Sichtbarkeit des Repositories hängt, ist keine Eigenschaft des Projekts, sondern des Tarifs. Wer die Sichtbarkeit ändert, ändert die Sicherungen mit — und beim Zurückschalten kommen sie nicht von allein wieder. Verwandt mit „Eine Aussage im Dokument ist keine Funktion" am Ende dieser Datei: dass hier oben „mit Branch Protection" stand, machte sie nicht wirksam.

### `git checkout -b` nimmt den Zweig, auf dem man steht — nicht `main`

Dreimal an einem Tag, und die Folgen waren jedes Mal andere:

1. **Der Zweig für PR #71 entstand auf `feat/load-test-series`** statt auf `main`. Damit trug #71 die beiden Commits von #70 huckepack, und sein Squash-Merge nahm sie mit. Nichts ging verloren — aber #70 war danach ein PR ohne Inhalt, musste geschlossen statt gemergt werden, und die Historie schreibt den Lasttest jetzt einem Commit zu, dessen Titel von Kanten und Kontrast spricht.
2. **Ein Commit landete auf dem Zweig von #72**, nachdem dessen Auto-Merge schon gefeuert hatte. Der Push gelang, der PR war zu — der Commit hing an einem toten Zweig.
3. Beim Aufräumen fiel derselbe Reflex ein drittes Mal auf.

**Was daran täuscht:** `git checkout -b` sagt nichts darüber, worauf es aufsetzt. Es fühlt sich an wie „neuer Zweig", heißt aber „neuer Zweig **von hier**". Nach einem `git push` bleibt man auf dem gepushten Zweig stehen, und genau dort greift man zum nächsten Vorhaben.

**Der Handgriff davor**, jedes Mal:

```bash
git switch main && git pull && git switch -c <neuer-zweig>
```

Wer schon danebengegriffen hat, setzt den Commit sauber neu auf, statt den Zweig zu reparieren:

```bash
git switch main && git pull && git switch -c <neuer-zweig> && git cherry-pick <commit>
```

**Und die Gegenprobe vor dem PR**, die alle drei Fälle gefunden hätte:

```bash
git log --oneline origin/main..HEAD
```

Steht dort mehr als die eigene Arbeit, sitzt der Zweig falsch. Das kostet zwei Sekunden und hat an diesem Tag dreimal gefehlt.

**Lehre:** Ein Kommando, dessen Wirkung vom unsichtbaren Zustand „wo bin ich gerade" abhängt, braucht den Blick auf diesen Zustand als festen Teil des Ablaufs — nicht als Ausnahme, wenn etwas schiefging. Dasselbe Muster wie bei „Ein privates Repository verliert seine Schutzregel": nicht der Befehl war falsch, sondern die Annahme über die Lage, in der er ausgeführt wurde.

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

  **Zweiter Nachtrag (10.08.2026), verschränkt gemessen — die Hälfte davon stimmt nicht mehr.** Die Richtung hält: vier Organisationen sind schneller als eine, und zwar in **4 von 4** Runden. Die Größe nicht: **+15 %**, nicht +33 % (67,9/63,7/60,7/57,1 gegen 76,7/75,4/65,1/71,1 Stapel/s). Und der zweite Satz ist falsch — **die Verbindungszahl ist unterhalb von `max_connections` gar kein Hebel**: von 10 auf 25 ist kein Unterschied messbar. Die Serialisierung je Organisation ist damit der **größere** der beiden gemessenen Effekte, nicht der kleinere. Der eigentliche Kostenträger ist aber keiner von beiden, sondern die Zahl der Transaktionen je Kommando (22,6 je Stapel) — die vollständige Reihenfolge steht bei „Messreihe: welcher Hebel wirklich wirkt".

- **Der Revisionsvergleich sitzt in der normalen Abschlussvalidierung**, nicht im Sync-Pfad. docs/06 listet ihn unter den Bedingungen, die der Server beim Abschluss erneut prüft — und ein Online-Client kann genauso einen veralteten Dokumentsatz vor sich haben wie ein Offline-Gerät (eine Seite, die über eine Freigabe hinweg offen bleibt). Ein zweiter Erkennungspfad wäre eine zweite Gelegenheit, es falsch zu machen. Folge: `CompleteStepForm` sendet die angezeigten Revisions-IDs mit; ein leeres Feld heißt „keine Aussage" und löst deshalb keinen Konflikt aus, ein _überholte_ Bindung dagegen immer.
- **Die Outbox darf ohne Berechtigung zugestellt werden.** `processSyncCommands` prüft absichtlich **kein** `sync.execute` — ein Rechteentzug würde sonst offline erfasste Arbeit dauerhaft auf dem Tablet einsperren, während docs/06 ausdrücklich verlangt, dass sie erhalten bleibt und zur Entscheidung wird (Negativtest #5). _Angewendet_ wird trotzdem nichts ohne Berechtigung: jedes Kommando wird einzeln autorisiert und wird andernfalls zum `PERMISSION_REVOKED`-Konflikt mit unveränderter Nutzlast. Lesen (Changes, Offline-Bundle) bleibt hinter `sync.execute` — das gibt Daten heraus, statt sie entgegenzunehmen.
- **„Weiterhin gültig" überspringt keine Prüfungen.** Die Entscheidung lautet „die alte Revision ist weiterhin akzeptabel", nicht „Abschluss durchwinken": `acceptAsValid` schickt die Abschlussmeldung durch dieselbe `validateSubmissionWithin`, nur mit der Revisionsfrage als bereits beantwortet markiert. Ein Schritt mit fehlendem Pflichtfoto bleibt auch nach dieser Entscheidung abgelehnt.
- **`ACCEPT_AS_VALID` gibt es bei `PERMISSION_REVOKED` nicht.** docs/04 sagt, offline erfasste Arbeit nach Rechteentzug werde „nicht automatisch freigegeben" — und sie stellvertretend durchzuwinken ist derselbe Vorgang mit einer anderen Unterschrift darunter. Möglich bleiben Zusatzprüfung oder Verwerfen der Abschlussmeldung; die erfassten Nachweise bleiben in beiden Fällen erhalten.
- **`devices` hat jetzt `organization_id` und eine RLS-Policy.** Die Phase-1-Migration hatte notiert, Mandantentrennung für `devices`/`sessions` laufe „bis zu einer eigenen Policy" auf Anwendungsebene. Phase 5 ist der erste Verwender und schließt die Lücke für `devices`; `sessions` bleibt offen (kein Verwender).
- **Berechtigungsatome, die nicht in docs/04 stehen.** `sync.execute`, `sync_conflict.view`, `sync_conflict.decide` und `device.manage` sind in Phase 5 dazugekommen. docs/04 beschreibt das Verhalten („erfordert manuelle Entscheidung durch berechtigte Person"), benennt aber nicht das Atom, das „berechtigt" definiert. Vergabe: `sync.execute` an WORKER und INSPECTOR, `sync_conflict.decide` an die beiden Rollen, die docs/06 bei einem Konflikt benachrichtigt (PROJECT_LEAD, QUALITY_MANAGER), `device.manage` an ADMIN. In Phase 7 kamen `product_release.decide` und `product_release.view` dazu (siehe unten), zuletzt **`customer.manage` und `product.manage`** für die Stammdatenerfassung. Bei diesen beiden war die Alternative, ein bestehendes Atom still mitzubenutzen — `project.update` für Produkte läge nahe, sie hängen am Projekt. Dagegen sprach, dass eine zweite, unbenannte Bedeutung eines Atoms sich nicht prüfen lässt und in keiner Matrix steht. Vergabe: `customer.manage` an ADMIN (Kunden gelten organisationsweit), `product.manage` an PROJECT_LEAD (das Produkt gehört zum Projekt, und ADMIN hat nicht einmal `project.create`). Dieselbe Art Abweichung wie bei `production_plan.release` weiter oben — dokumentiert, nicht stillschweigend.

- **Die Stammdatenerfassung entstand zuletzt, und das war kein Zufall.** Standort, Abteilung, Arbeitsplatz, Kunde, Produkt, Benutzer und Rollenzuweisung waren bis dahin ausschließlich Seed-Ausgabe. Solange eine Datenmigration aus einem Altsystem eingeplant war, fiel das nicht auf — sie hätte die Stammdaten mitgebracht. `docs/10` führt sie als „falls Altsystem vorhanden" und stellt die andere Hälfte der Frage nie. **Die Lücke stand also in einer Formulierung des Plans, nicht im Code**, und ohne sie wäre ein Pilot am ersten Tag vor leeren Auswahllisten gestanden.

- **Abteilung und Arbeitsplatz bekamen ihre Eindeutigkeit erst mit dem Formular** (Migration `20260810120000_department_workcenter_uniqueness`). Solange beide nur im Seed entstanden, war ein Constraint entbehrlich; vor einer Eingabemaske sind Dubletten eine Frage der Zeit, und eine zweite „Montage" am selben Standort macht jede Auswahlliste mehrdeutig, **ohne dass irgendetwas fehlschlägt**. Der Zuschnitt ist die eigentliche Entscheidung: der **Name** gilt je Standort beziehungsweise je Abteilung — zwei Werke dürfen beide eine Montage haben, jede Abteilung einen „Prüfplatz 1" —, das **Kürzel** dagegen organisationsweit, damit es als Kennung taugt. Es ist optional, und Postgres behandelt NULL-Werte im Unique-Index als verschieden: beliebig viele Abteilungen ohne Kürzel bleiben erlaubt, zwei mit demselben nicht. Beide Dienste tragen `site.manage` und kein eigenes Atom — eine Abteilung ist eine Untergliederung des Standorts, keine eigene Art Stammdatum.

- **Die Bestätigungs-PIN vergibt jeder für sich, und niemand für einen anderen.** `setConfirmationPin` nimmt keine Benutzerkennung entgegen, die Route heißt `/api/v1/me/confirmation-pin`. Wer eine PIN für jemanden vergibt, kennt sie — ab da trägt die Zurechnung im Audit-Trail nicht mehr. Aus demselben Grund gibt es administrativ nur ein **Löschen** (`clearConfirmationPin`, mit Pflichtbegründung im Audit-Trail) und kein Setzen: das Konto steht danach wie ein frisches da, und der Inhaber vergibt selbst neu. Das Ändern verlangt die bisherige PIN und läuft über `confirmWithPin`, erbt damit die Fehlversuchssperre, statt sie ein zweites Mal zu implementieren.

- **Der scrypt-Kostenparameter ist niedriger, als der Kommentar behauptete — und lässt sich nicht einfach anheben.** Beim Durchmessen des Sync fiel auf, dass `confirmation-pin.ts` „N=2^15" beschrieb, die Aufrufe aber keine Optionen übergeben: es gilt Nodes Vorgabe N=2^14. Gemessen sind das 21 ms je Ableitung. Der Kommentar ist korrigiert, der Parameter **nicht** — und zwar mit Absicht, denn das ist keine Einzeiler-Änderung: das gespeicherte Format `scrypt$salt$hash` trägt die Kostenparameter nicht mit, ein geändertes N macht also jeden bestehenden Hash unprüfbar. Wer ihn anheben will, ergänzt zuerst die Parameter im gespeicherten String und prüft gegen den dort gefundenen Wert; sonst verliert beim Ausrollen jeder Benutzer in der Halle seine PIN. Für die Bewertung, ob 2^14 genügt, ist ADR-005 die Stelle — dort steht die Bedrohungsannahme, hier nur der Befund. Ein Angreifer, der die Hashes hat, probiert 10 000 vierstellige PINs in rund 3,5 Minuten Rechenzeit; die Fehlversuchssperre schützt den Online-Pfad, nicht diesen.
- **`sync_commands.status` kennt ein `PENDING`, das docs/05 nicht hat.** docs/05 definiert vier _Antwort_-Status (ACCEPTED/REJECTED/CONFLICT/DUPLICATE); `PENDING` wird nie an einen Client gesendet. Es ist die Zeile, die **vor** der Ausführung geschrieben wird, damit ein Absturz zwischen „angewendet" und „quittiert" eine Spur hinterlässt statt gar nichts — der Wiederholungsversuch findet sie und führt idempotent erneut aus, statt ein unfertiges Kommando für ein Duplikat zu halten.
- **`step_document_bindings` bekam erst in Phase 5 einen Service, die UI erst in Phase 7.** docs/10 listet die Schritt-Dokumentbindung unter Phase 2; das Modell entstand dort, der Service nicht. Abnahmeszenario C ist vollständig über diese Bindungen definiert und war ohne ihn aus der Anwendung heraus gar nicht herstellbar — daher `bindDocumentToPlanStep`. Der Planungsbildschirm bietet die Bindung jetzt an (Auswahl, Seite, Markierung) und erlaubt das Entfernen, solange die Revision DRAFT ist.
- **Zur Auswahl stehen nur freigegebene Revisionen des Projekts, zu dem der Plan gehört** (`listBindableDocumentRevisions`). Nur RELEASED, weil der Service nichts anderes annimmt — alles andere wäre eine Auswahlliste voller Einträge, die der Server ablehnt. Nur das eigene Projekt, weil ein fremdes Dokument für diesen Plan nicht verbindlich sein kann. Wer `document.view` nicht hat, bekommt eine leere Liste statt eines Fehlers, und **nicht** die Anzahl dessen, was er nicht sehen darf — dieselbe Regel wie bei der Suche.
- **Eine Revision darf je Schritt nur einmal gebunden werden** (Unique-Index + Prüfung im Service). Das war implizit, solange der einzige Aufrufer ein Test war; mit einem Knopf davor ist ein Doppelklick eine Dublette. Und Dubletten sind hier nicht kosmetisch: `hashIdSet` hasht die sortierte Liste der gebundenen Revisions-IDs in den `documentSetHash`, der in jedem Release Token steckt — eine wiederholte ID ändert diesen Hash, ohne dass sich der Dokumentsatz geändert hat.
- **Entfernen löscht, statt zu markieren — weil es nur im DRAFT geht.** `loadEditableStep` sperrt den Vorgang ab, sobald die Revision eingereicht ist. Ein nie freigegebener Plan hat keine Ausführungshistorie zu schützen, und nichts stromabwärts konnte die Bindung je referenzieren. Jede freigegebene Revision bleibt unangetastet — genau das schützt Geschäftsgrundsatz 6. Das Audit-Event trägt die entfernten Werte, die Löschung ist also selbst rekonstruierbar.
- **Ein Release-Token wird pro Schritt genau einmal gültig gehalten.** Der Server speichert nur den Hash der Signatur, kann ein ausgegebenes Token also nicht erneut herausgeben — die Auslieferung ans Gerät prägt ein **neues** und ersetzt den Hash, wodurch das vorherige ungültig wird. Gewollt: ein verlorenes Tablet kann nicht weiter an einem Schritt arbeiten, der inzwischen auf einem anderen Gerät liegt.
- **Der Offline-Arbeitsbereich ist bewusst eine einzelne clientseitig gerenderte Seite** (`/offline`). Alle übrigen Seiten sind Server Components und brauchen einen Netzwerk-Roundtrip, um überhaupt etwas anzuzeigen — genau das fehlt in der Halle, für die dieser Bildschirm gedacht ist.
- **Die Produktionsakte wird nie gespeichert, sondern bei jedem Aufruf neu abgeleitet.** Masterprompt Kap. 10 nennt sie einen „reproduzierbaren Nachweis des tatsächlichen Herstellungsverlaufs" — ein einmal gespeicherter Schnappschuss würde weiter mit sich selbst übereinstimmen, nachdem die Primärdaten weitergezogen sind, und genau das darf ein Auditdokument nicht. Festgehalten wird stattdessen der **Zeitpunkt**: `data_as_of` sagt, wann gelesen wurde, `template_version`, welches Layout gerendert hat. Damit ist „warum sieht das PDF von März anders aus" beantwortbar, ohne die Daten einzufrieren.
- **Das Manifest führt zwei Hashes je Datei, nicht einen.** `declaredSha256` ist, was die Datenbank bei der Annahme festgehalten hat; `actualSha256` ist, was der Export über die tatsächlich gepackten Bytes gerechnet hat. Abnahmeszenario F behauptet, dass diese beiden übereinstimmen — sie gleichzusetzen hieße, die Behauptung vorauszusetzen. Weichen sie ab, wandert die Datei **trotzdem** ins Archiv und der Eintrag bekommt `MISMATCH`: sie wegzulassen würde eine Beschädigung verstecken, die ein Auditor zu Recht finden will. Fehlt die Datei im Objektspeicher ganz, steht `MISSING` im Manifest.
- **Die ESLint-Konfiguration liegt im Flat-Format** (`eslint.config.mjs`), weil ESLint ab Version 9 kein anderes mehr liest. `next/core-web-vitals`, `@typescript-eslint` und `prettier` kommen weiterhin aus ihren Paketen statt nachgebaut zu werden — ihre Regellisten gehören den Paketen, nicht uns. Seit `eslint-config-next` 16 liefern alle drei Flat-Konfigurationen unmittelbar; `FlatCompat` und `@eslint/eslintrc` sind damit entfallen. Wer eine Ausnahme ergänzt: im Flat-Format überschreiben spätere Einträge frühere, und ein Eintrag mit `ignores` ohne `files` gilt global.
- **zod 4 kostete eine Zeile Code und eine Entscheidung.** Die Zeile: `z.record` verlangt seit v4 beide Schemata, also `z.record(z.string(), z.unknown())` im Sync-Envelope (`sync-command-types.ts`) — der einzige Typfehler in 61 Dateien, die zod benutzen. Die Entscheidung betrifft die **Vorgabetexte der Fehler**, die über `error-response.ts` in `errors[].message` jeder 422-Antwort landen:

  | Fall           | zod 3                              | zod 4                                                |
  | -------------- | ---------------------------------- | ---------------------------------------------------- |
  | fehlendes Feld | `Required`                         | `Invalid input: expected string, received undefined` |
  | falscher Typ   | `Expected number, received string` | `Invalid input: expected number, received string`    |

  Übernommen, nicht eingefroren. docs/05 typisiert `message` als freien String und schreibt keinen Wortlaut vor; ein eigener Error-Map, nur um eine fremde Zeichenkette festzuhalten, wäre Code ohne Zweck. Wer die Texte je vereinheitlichen will — `detail` ist deutsch, `message` war immer englisch —, hat mit dem vereinheitlichten `error`-Parameter aus v4 jetzt den bequemeren Weg dafür.

  Was **nicht** brach, obwohl es auf der Liste der Bruchstellen steht: die 34 `.uuid()` (v4 prüft strenger nach RFC 4122, aber sie bewachen ausnahmslos Datenbankschlüssel aus `gen_random_uuid()`/`randomUUID()`), die 21 `z.coerce`, die 20 `z.enum` (kein `nativeEnum` im Code) und die Fehlerauswertung selbst — sie liest nur `issue.path` und `issue.message`, beide unverändert. Eigens nachgesehen: die festgeschriebenen Keycloak-Demo-IDs (`11111111-…`) sind **nicht** RFC-konform und fielen unter v4 durch — nur wird `external_id` nirgends mit `uuid()` geprüft.

- **Der Weg vom `ZodError` zur 422-Antwort hat seit zod 4 einen Test** (`src/lib/api/__tests__/error-response.test.ts`). Er hatte bis dahin keinen: die vorhandenen `VALIDATION_ERROR`-Zusicherungen in den Integrationstests betreffen sämtlich die gleichnamige `DomainError` aus den Diensten, nicht die Schemaprüfung an der Anfragegrenze — also ausgerechnet nicht den Pfad, dessen Ausgabe sich geändert hat. Zugesichert wird, was docs/05 verspricht: 422, `code`, und je beanstandetem Feld ein Eintrag mit gepunktetem Pfad (`nested.sequenceNumber`, `commands.1.sequenceNumber` — der Index zählt, weil ein Sync-Stapel bis zu 500 Kommandos meldet) und einer nicht leeren Meldung. **Ausdrücklich nicht zugesichert wird der Wortlaut**: der gehört zod und würde bei jeder Anhebung rot, ohne dass etwas kaputt wäre.

- **TypeScript 6 zieht `@types`-Pakete nicht mehr von selbst herein — und das ist die eigentliche Anhebung.** Bis TypeScript 5 galt: jedes sichtbare Paket unter `node_modules/@types` ist automatisch dabei. Ab 6 nicht mehr. Wer davon lebt, merkt es nur dort, wo ein Paket **Globals** liefert und nicht importiert wird — hier `@types/jest`: 1124 Fehler, alle in Testdateien, alle „Cannot find name 'describe' / 'it' / 'expect'". Die Anwendungstypen blieben unauffällig, weil `@types/node`, `@types/react` und der Rest über Importe hereinkommen und nicht über die Automatik. Behoben mit `"types": ["node", "jest"]` in `tsconfig.json`; damit steht ausdrücklich da, was vorher stillschweigend galt.

  **Nachgemessen, weil die offizielle Migrationsanleitung (`aka.ms/ts6`) zum Zeitpunkt der Anhebung noch ein Platzhalter war:** ein Wegwerfprojekt mit einem einzigen, rein globalen `@types`-Paket und sonst nichts. TypeScript 5.9.3 findet das Global, 6.0.3 nicht. Damit ist es eine gemessene Eigenschaft der Version und keine Vermutung über unser Setup — und wer den nächsten Sprung macht, weiß, wonach er sucht.

- **`baseUrl` ist entfallen, nicht stummgeschaltet.** TypeScript 6 meldet es als deprecated („will stop functioning in TypeScript 7.0") und bietet `"ignoreDeprecations": "6.0"` an. Das wäre das Verschieben derselben Arbeit um eine Hauptversion gewesen. Die `paths` hier stehen ohnehin schon relativ (`./src/*`) und funktionieren seit TypeScript 5 ohne `baseUrl`; nichts im Code hängt an der Auflösung nackter Bezeichner gegen das Projektwurzelverzeichnis (nachgesehen). Next 16 schreibt den Eintrag auch nicht zurück — mit einem Build nachgeprüft.

  Beachten: **ein Optionsfehler in `tsconfig.json` bricht `tsc` ab, bevor es eine einzige Datei prüft.** Der `baseUrl`-Fehler war deshalb zuerst der einzige, und die 1124 Fehler dahinter wurden erst danach sichtbar. Wer nach einer Anhebung „nur ein Fehler" liest, hat womöglich noch gar nichts geprüft.

- **`eslint-config-next` 16 bringt den TypeScript-Parser mit, aber keine TypeScript-Regel.** Sein Eintrag `next/typescript` registriert Plugin und Parser und hat **null** Regeln — die Menge aus `plugin:@typescript-eslint/recommended` kam vorher über `FlatCompat` und muss seither ausdrücklich als `flat/recommended` dastehen. Wer sie beim Umstellen wegfallen lässt, verliert die halbe TypeScript-Prüfung, ohne dass irgendetwas rot wird.
- **Die Umstellung wurde verglichen, nicht geglaubt.** `eslint --print-config` vor und nach der Migration, für je eine Datei aus Anwendung, Komponenten, E2E, Seed und Lasttest: gleiche Zahl aktiver Regeln, gleiche Ausnahmen je Verzeichnis. Die beiden scheinbaren Unterschiede (`prefer-const`, `no-unused-expressions`) waren keine — ESLint 9 druckt die Standardoptionen aus, die vorher implizit galten. Ohne diesen Vergleich wäre eine stille Lockerung nicht aufgefallen: eine Konfiguration, die nur „läuft", kann die halbe Regelmenge verloren haben.
- **Derselbe Vergleich beim Wechsel auf `eslint-config-next` 16**, dieselben fünf Dateien: **keine Regel weggefallen**, keine Schwere herabgesetzt, 15 Regeln neu (die kompilerbasierten `react-hooks/*` aus dem neuen Plugin, dazu `@next/next/no-location-assign-relative-destination`). Genau der Punkt, an dem der fehlende `flat/recommended`-Eintrag aufgefallen wäre — der Vergleich ist hier kein Ritual, sondern die einzige Kontrolle, die eine stille Lockerung überhaupt sieht.
- **Prisma 7 verbindet über einen Treiber-Adapter, nicht mehr selbst.** Die Rust-Engine ist weg; `src/lib/db/client.ts` baut den Client mit `PrismaPg`. Verbindungs-URLs stehen deshalb nicht mehr im Schema, sondern an zwei getrennten Stellen mit je einem Zweck: `DATABASE_URL` beim Client (Rolle `proquado_app`, RLS gilt) und `DIRECT_DATABASE_URL` in `prisma.config.ts` für Migrationen (schemabesitzend). Die Trennung aus ADR-006 ist damit sichtbarer als vorher, wo beides in derselben Schemadatei stand.
- **`connection_limit` in der URL tut seit Prisma 7 nichts mehr.** Den Parameter wertete die Rust-Engine aus; der Adapter überliest ihn und nimmt die Vorgabe von `pg` (10 Verbindungen). Die Poolgröße steht jetzt in `DATABASE_POOL_MAX` (Vorgabe 25) und wird dem Adapter übergeben. Wer an der URL dreht und keine Wirkung sieht, sucht an der falschen Stelle — und das ist keine Kleinigkeit, weil der Lasttest die Verbindungszahl als härteste Grenze des Sync ausweist.
- **`params` und `searchParams` sind seit Next 15 Promises.** Eine neue Seite oder Route schreibt sich `async function Page(props: { params: Promise<{ id: string }> })` und holt sich die Werte mit `await props.params` — nicht mehr destrukturiert in der Signatur. Betroffen waren 75 Dateien; umgestellt hat sie der offizielle Codemod (`@next/codemod next-async-request-api`), nicht die Hand. Zwei weitere Umbenennungen derselben Anhebung: `experimental.serverComponentsExternalPackages` heißt jetzt `serverExternalPackages` und steht nicht mehr unter `experimental` (die pdfkit-Ausnahme hängt daran, siehe Stolpersteine), und `useFormState` aus `react-dom` heißt in React 19 `useActionState` aus `react` — `useFormStatus` bleibt, wo es war.
- **Der Grund für den Sprung auf Next 15 war kein Aufräumen, sondern eine Sicherheitslücke im eigenen Bau.** Unter den offenen Warnungen stand „cross-site scripting in App Router applications using CSP nonces", behoben erst ab 15.5.16 — also genau in dem Mechanismus, den `src/proxy.ts` seit Phase 7 benutzt. Dazu SSRF in Server Actions und ein DoS im App Router, alle als hoch eingestuft. Wer die Anhebung rückgängig machen will, hebt diese drei mit auf.
- **Die CSP-Nonce sitzt seit Next 16 in `src/proxy.ts`, nicht mehr in `src/middleware.ts`.** Next 16 hat die Konvention umbenannt — Dateiname und benannter Export —, die alte Form gilt als deprecated. Inhaltlich ist es dieselbe Funktion mit demselben `matcher`. Ein Unterschied ist zu kennen: `proxy` läuft ausschließlich in der **Node.js**-Laufzeit, `edge` steht dort nicht mehr zur Verfügung und lässt sich auch nicht konfigurieren. Für diesen Code ist das folgenlos (er benutzt `crypto.getRandomValues`, `btoa`, `URL`); wer dort je etwas Laufzeitabhängiges ergänzt, muss es wissen. Nachgeprüft wurde nicht der Dateiname, sondern die Wirkung: im Production-Build tragen alle zwölf `<script>`-Tags der Anmeldeseite die Nonce aus dem Header **derselben** Antwort.
- **Next 16 baut mit Turbopack, auch `next build`.** Das ist die Voreinstellung, nicht mehr ein Flag. Für dieses Projekt war die Frage nicht die Geschwindigkeit, sondern ob `serverExternalPackages` weiterhin trägt: pdfkit und archiver dürfen nicht gebündelt werden, sonst fehlen pdfkit die Schriftmetriken (siehe Stolpersteine). Sie tragen — geprüft nicht am Build, sondern am **Ergebnis**: gegen den Production-Build erzeugt, liefert der Export eine PDF-Akte mit `%PDF`-Signatur und ein ZIP mit `PK`. Dieselbe Überlegung wie bei der CSP: eine Bündelungsausnahme muss man benutzen, nicht kompilieren. Das Projekt hat **keine** eigene Webpack-Konfiguration; sonst wäre `next build` mit Turbopack ausdrücklich fehlgeschlagen und die Wahl `--turbopack` gegen `--webpack` eine echte gewesen.
- **Next 16 schreibt `tsconfig.json` beim Build um** — es setzt `jsx` auf `react-jsx` und nimmt `.next/dev/types/**/*.ts` in `include` auf (Folge der getrennten Dev-Ausgabe). Beides ist gewollt und eingecheckt. Beachtenswert ist nur, dass Next dabei seinen **eigenen** JSON-Stil schreibt, der von Prettier abweicht und `pnpm run format:check` rot macht. Einmal `prettier --write tsconfig.json` genügt: Next schreibt die Datei nur, wenn ihm ein **Wert** fehlt, nicht wegen der Formatierung — nachgeprüft mit einem zweiten Build, der die Datei unangetastet ließ. Eine Ausnahme in `.prettierignore` wäre die falsche Antwort gewesen, weil sie die Datei dauerhaft aus der Formatprüfung nähme, um ein einmaliges Problem zu lösen.
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
- **Ein Zeichnungsverweis wird aufgelöst oder gebunden — das sind zwei Vorgänge** (`src/domain/production-plans/resolve-drawing-references.ts`). Beim IFC-Import wird jede im Modell genannte Zeichnung **einmal** gesucht. Fehlte sie, blieb der Verweis offen — und blieb es für immer, auch wenn sie zwei Tage später hochgeladen und freigegeben wurde; die Oberfläche versprach dabei ausdrücklich das Gegenteil („bis das Dokument im Projekt liegt"). Die Entscheidung beim Nachrüsten war nicht, ob nachgeschlagen wird, sondern **was Nachschlagen bewirken darf**:
  - **Auflösen** hält fest, dass die Zeichnung inzwischen als Dokument im System liegt. Das ist eine Feststellung über die Wirklichkeit — der Verweis ist ein Fund aus der Datei, nichts, das der Plan anordnet. Deshalb jederzeit zulässig, unabhängig vom Planstatus.
  - **Binden** macht die Revision für den Schritt verbindlich. Das ist eine Planänderung, geht in den `documentSetHash` ein und bleibt auf DRAFT beschränkt, genau wie `bindDocumentToPlanStep`.

  An einer freigegebenen Planrevision wird also **aufgelöst und nicht gebunden**. Der Verweis steht danach im Arbeitsschritt als „liegt inzwischen im Projekt, gehört aber nicht zu den verbindlichen Unterlagen" — mit Link, ohne Behauptung. Wer ihn für einen laufenden Auftrag in die Akte holen will, reicht ihn nach; wer ihn verbindlich machen will, braucht eine neue Planrevision.

  **Zwei Auslöser**: eine Schaltfläche am Plan, und automatisch beim **Einreichen zur Prüfung** — der letzte Moment, zu dem eine Bindung überhaupt noch entstehen kann. Der zweite ist der wichtigere: die Zeichnungen treffen typischerweise zwischen Import und Einreichen ein, und ein Plan soll nicht deshalb mit offenen Verweisen zu QM gehen, weil niemand auf einen Knopf gedrückt hat. Berechtigung ist `work_step_definition.update` — dasselbe Atom, das eine Bindung von Hand verlangt, weil hier Bindungen entstehen.

  **Eine Falle, die dabei entschärft wurde**: `execution-queries.ts` lud die Verweise mit `where: { documentRevisionId: null }`, begründet damit, die aufgelösten stünden ohnehin unter den verbindlichen Unterlagen. Das galt nur, solange Auflösen ausschließlich beim Import geschah, wo beides zusammen entsteht. Mit dem Nachschlagen sind „aufgelöst" und „gebunden" zwei Zustände — der Filter hätte genau den neuen Fall unsichtbar gemacht: gefunden und nirgends gezeigt.

- **Eine nachgereichte Unterlage hängt an der Schrittinstanz, nicht am Planschritt** (`work_step_supplements`, `src/domain/execution/work-step-supplements.ts`). Anlass war eine Aussage aus der Fertigung: „Detailzeichnungen oder Zulassungen werden nachträglich zugeordnet." Der vorhandene Weg konnte das nicht — `bindDocumentToPlanStep` verlangt eine Planrevision im Status **DRAFT**, und nach dem Einreichen ist der Plan zu. Die Entscheidung war nicht, ob so etwas möglich sein soll, sondern **woran es hängt**, und das ist der ganze Zuschnitt:
  - Eine Beilage **ändert den Plan nicht**. Ein zweiter Auftrag gegen dieselbe Planrevision bekommt sie nicht mit — sie gehört zu diesem Vorgang, nicht zur Vorschrift.
  - Sie geht **nicht in den `documentSetHash`** der Schrittfreigabe ein und löst deshalb keinen Revisionskonflikt aus. Ein Werker, der gerade arbeitet, wird nicht unterbrochen. Genau dieser Preis wäre bei einer echten Bindung fällig gewesen.
  - Sie ist deshalb auch an einem **laufenden oder längst abgeschlossenen** Schritt zulässig. Dafür gibt es sie: die Zulassung trifft ein, wenn das Modul fertig ist.
  - Verlangt bleibt, was auch eine Bindung verlangt: nur eine **freigegebene** Revision, nur aus **demselben Projekt** (RLS trennt Mandanten, nicht Projekte), und eine **Begründung** — sie steht sonst ohne Zusammenhang in der Akte. Ein stornierter Auftrag nimmt nichts mehr an.

  **Was das ausdrücklich nicht abdeckt:** eine Zeichnung, die die Arbeit ändert. Das ist eine Planänderung und braucht eine neue Planrevision. Diese Unterscheidung ist **nicht technisch erzwingbar** — sie steht im Namen („nachgereicht"), im erklärenden Satz über der Liste und in der Akte, die beides getrennt ausweist. Wer sie aufweicht, hat den Unterschied zwischen Anweisung und Nachweis aufgegeben, ohne dass ein Test das meldet.

  In der Produktionsakte steht sie unter Abschnitt 3.–4. als **eigene Liste** unter den verbindlichen Unterlagen, nicht als elfter Abschnitt: die zehn Abschnitte aus Masterprompt Kap. 10 sind eine zugesicherte Struktur, und ein Prüfer sucht Unterlagen an einer Stelle. Im ZIP liegt sie in `nachweise/nachgereicht/`, getrennt von `nachweise/dokumente/` — wer das Archiv ohne die Akte daneben öffnet, muss den Unterschied trotzdem sehen. `work_step_supplement.manage` haben PROJECT_LEAD **und** QUALITY_MANAGER; eine bauaufsichtliche Zulassung trifft typischerweise bei der Qualitätssicherung ein. Ausdrücklich **nicht** `work_step_definition.update` — wer den Plan ändern darf, ist eine andere Frage als wer einen Nachweis beilegen darf.

- **`product_release.decide` liegt allein bei QM, `product_release.view` bei allen lesenden Rollen.** docs/04 nennt das Atom nicht — Masterprompt Kap. 10 beschreibt den Abschnitt der Akte, sagt aber nicht, wer entscheidet, weil bisher niemand entschied. Vergeben nach derselben Begründung, die docs/04 bei Dokumenten benutzt: wo QM die eindeutige Instanz ist, ist es die einzige. Dieselbe Art Abweichung wie bei `sync.execute` — dokumentiert, nicht stillschweigend. **Seed nachziehen nicht vergessen**, sonst liefert die Anwendung `PERMISSION_DENIED` für eine Berechtigung, die im Code längst vergeben ist.

---

## Test-Kommandos

Die vollständige Kette, in dieser Reihenfolge — jede Stufe findet etwas, das die vorherige nicht sieht:

```bash
pnpm run typecheck          # Sekunden
pnpm run lint
pnpm run format:check
pnpm run test:unit          # 209 Tests, keine Infrastruktur nötig
pnpm run build              # Kompilier- UND Bündelungsprüfung
pnpm run test:integration   # 143 Tests, echte Postgres+MinIO-Container (Testcontainers)
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
pnpm exec prisma migrate deploy && pnpm exec prisma db seed              # einmalig
pnpm run test:e2e                    # 26 Tests (vier davon Anmeldungen), ~2 Min inkl. Build
pnpm run test:e2e work-step          # nur eine Datei
pnpm exec playwright show-trace test-results/<…>/trace.zip        # nach einem Fehlschlag
```

Vier Eigenheiten, die man kennen sollte, bevor man daran arbeitet:

- **Der Lauf baut und startet den Production-Build selbst** (`playwright.config.ts`, `webServer`) und belegt dafür Port **3002**. `next dev` darf daneben nicht laufen — `pnpm run build` schreibt in dasselbe `.next/` (siehe Stolperstein oben). Ein bereits laufender Server wird bewusst **nicht** wiederverwendet: er könnte ein Dev-Server sein, und der Lauf prüfte dann still die falsche Sache.
- **Warum Production und nicht `next dev`:** die CSP ist in der Entwicklung abgeschaltet und verhinderte in Production jede Hydration, ohne dass die gesamte übrige Prüfkette etwas merkte. `production-csp.spec.ts` hält diese Voraussetzung selbst fest — er prüft, dass die ausgelieferte Antwort eine Nonce-CSP trägt **und** dass Next.js seine Skripte damit gestempelt hat. Zusätzlich lässt `test/e2e/support/test.ts` jeden Test rot werden, sobald im Browser ein CSP-Verstoß, ein React-Fehler oder eine unbehandelte Ausnahme auftaucht.
- **Angemeldet wird über den echten Keycloak** (`auth.setup.ts`, einmal je Rolle, Ergebnis als `storageState` unter `test/e2e/.auth/`). Kein nachgebautes Sitzungscookie: die Kontoverknüpfung entsteht genau auf diesem Weg, und genau dieser Weg ist in Phase 7 zweimal gebrochen.
- **Ebene 9 läuft im selben Kommando** (`accessibility.spec.ts`): axe-core über Anmeldeseite, Meine Aufträge, Arbeitsschritt in Arbeit, Planungsbildschirm und Akte mit Freigabeformular — jeweils im Zustand mit den meisten Bedienelementen, weil ein leerer Bildschirm keine Barrieren hat. Alle fünf sind ohne Verstoß, ohne eine einzige Ausnahmeregel.
- **Der App-Shell-Cache hängt mit drin** (`offline-shell.spec.ts`), aus demselben Grund wie die CSP: der Service Worker wird nur im Production-Build registriert, keine andere Stufe der Kette sieht ihn je. Geprüft werden Registrierung und Übernahme, die Herkunft der Chunks (`/_next/static/`, denn nur die cacht `sw.js`), das Laden ohne Verbindung (`transferSize: 0`), der Rückfall jeder Navigation in den Offline-Arbeitsbereich — und die Gegenprobe, dass `/api/**` **nicht** aus dem Cache beantwortet wird. Ein gecachtes „alles in Ordnung" über einen Schrittstatus wäre schlechter als keine Antwort (docs/06).
- **Der Export hängt seit Next 16 ebenfalls drin** (`dossier-export.spec.ts`), und zwar über Knopf und Downloadlink statt über die API: geprüft wird nicht, dass der Dienst antwortet, sondern dass am Ende **Bytes** ankommen, die ein PDF (`%PDF`) beziehungsweise ein ZIP sind. Beim ZIP zusätzlich das End-of-Central-Directory — ein abgebrochener Strom hat keines — und `manifest.json` im Archiv, ohne das Abnahmeszenario F nichts trägt. Gelesen wird das ohne Bibliothek, aus den Rohbytes. Auch dieser Test ist nachgestellt: pdfkit aus `serverExternalPackages` genommen ⇒ beide Fälle rot mit dem historischen `ENOENT … Helvetica.afm` im Serverprotokoll.
- **Der Fehlerfall hat dabei die Form des Tests bestimmt.** Ein `ENOENT` ist keine `DomainError`, also reicht die Server Action es durch, statt es als `{ error }` zurückzugeben — das Formular zeigt **nichts** an. Wer schlicht auf den Downloadlink wartet, wartet 30 s und liest am Ende „locator not visible". Gewartet wird deshalb auf das Ende des Pending-Zustands des Knopfes; danach ist ein fehlender Link kein Warten mehr, sondern ein Befund. Fehlschlag jetzt nach 5,7 s statt 30,6 s, mit dem Hinweis aufs Serverprotokoll.
- **`EXPORT` erlaubt fünf Exporte je Benutzer und Stunde**, und der Test verbraucht zwei — ohne Gegenmaßnahme wäre der dritte Lauf innerhalb einer Stunde rot, ohne dass etwas kaputt wäre. `resetExportRateLimit` löscht deshalb das Zeitfenster in `rate_limit_windows` vor jedem Fall. **Zurückgesetzt wird das Fenster, nicht die Grenze angehoben**: eine für Tests hochgedrehte Grenze prüft etwas anderes als das, was ausgeliefert wird — und ausgerechnet diese Grenze ist das Mittel, auf das sich ADR-007 beruft, wenn es einen synchronen Export für vertretbar erklärt.
- **Dass diese Tests anschlagen, ist nachgestellt worden.** Registrierung abgeschaltet ⇒ beide Offline-Fälle rot. Beim ersten Versuch allerdings erst nach 60 s und mit „page.evaluate: Test timeout exceeded", weil `navigator.serviceWorker.ready` ohne Registrierung schlicht nie erfüllt wird. Das Warten ist jetzt auf 10 s begrenzt und die Meldung lautet `Received: "nicht registriert"`. Dieselbe Überlegung wie bei „Access Denied" im Keycloak-Eintrag: eine Kontrolle, die rot wird, aber nicht sagt warum, kostet die nächste Person eine Stunde.
- **In der CI ist das die Stufe `e2e-tests`** (`.github/workflows/ci.yml`), die die Infrastruktur über die **projekteigene** `docker-compose.yml` hochfährt statt über GitHubs `services:` — eine zweite Beschreibung derselben Container wäre eine, die irgendwann abweicht, und MinIO braucht ein `command`, das `services:` nicht kennt. Gewartet wird auf die Discovery-Antwort des **Realms**, nicht auf den Containerstatus: nur sie beweist, dass der Import durch ist.
- **Die Tests bauen ihre Fixtures selbst** (`test/e2e/support/scenario.ts`): eigener Plan, eigener Auftrag, eigene Zuweisung, alles mit dem Präfix `E2E-`, angelegt über die Domänendienste und angehängt an die Demo-Konten (die Anmeldung bindet an `users.email`). Der Demo-Auftrag wird dabei nicht angefasst — und ein Test, dessen Voraussetzung Handarbeit ist, wäre keiner.

**Auch diese Kette ist nicht vollständig.** Zwei Fehler in Phase 6/7 waren erst im Browser sichtbar: die fehlenden pdfkit-Schriftmetriken (nur beim Bündeln, nicht beim Kompilieren) und die Doppelbenutzer des Seeds (nur mit einer echten, eingeloggten Sitzung). Ebene 6 deckt davon jetzt einen Teil ab, aber nur die Abläufe, die dort stehen — wer an UI oder an Paketen arbeitet, die zur Laufzeit Dateien lesen, sollte die betroffene Seite weiterhin einmal wirklich öffnen. **Der PDF- und ZIP-Export war genau so eine Lücke** und ist seit `dossier-export.spec.ts` geschlossen: er hatte beim Sprung auf Next 16 noch von Hand geprüft werden müssen, weil kein Test ihn anfasste. In der CI laufen beide Ebenen als eigene Stufe `e2e-tests` (siehe unten).

### Lasttest (docs/09 Ebene 8)

```bash
pnpm run test:load                    # volle Größe aus docs/09, ~30 s plus Containerstart
LOAD_DEVICES=40 pnpm run test:load    # kleiner, für zwischendurch
```

Stellschrauben, alle mit der Vorgabe aus docs/09: `LOAD_DEVICES=200`, `LOAD_STEPS=500`, `LOAD_PHOTOS=2000`, `LOAD_DASHBOARDS=50`, dazu `LOAD_DB_CONNECTION_LIMIT=25` und `LOAD_ORGS=1`. Testcontainers starten Postgres und MinIO; sonst wird nichts gebraucht.

**Was gemessen wird und was nicht.** Der Harness ruft die Domänendienste direkt auf, nicht die HTTP-API. Gemessen wird damit die Arbeit, die der Server tatsächlich leistet — Transaktionen, RLS, Berechtigungen, Audit und Outbox, PDF und ZIP —, **nicht** HTTP, TLS, Next.js und der Netzweg. Das ist eine Grenze mit Grund: die API hängt an NextAuth-Cookies, 200 Geräte bräuchten 200 echte Keycloak-Anmeldungen, und gemessen würde am Ende überwiegend die Anmeldung. Der erwartete Engpass sitzt ohnehin in der Datenbank.

**Ergebnis (MacBook, Postgres im Container, drei Läufe):**

| Szenario                        | Ziel docs/09 | Gemessen                                                  |
| ------------------------------- | ------------ | --------------------------------------------------------- |
| Schichtwechsel-Sync, 200 Geräte | p95 < 3 s    | **3,0–3,1 s** (Prisma 5), **3,2–3,9 s** (Prisma 7, zod 4) |
| Deadlocks                       | 0            | 0                                                         |
| Nicht angenommene Kommandos     | 0            | 0                                                         |
| Große Akte, PDF (500/2000)      | < 30 s       | 0,2 s                                                     |
| ZIP-Export (innerhalb Grenze)   | < 60 s       | 0,04 s                                                    |
| Dashboard, 50 gleichzeitig      | p95 < 500 ms | 84 ms                                                     |

Vier Dinge, die aus diesen Zahlen folgen:

- **Der einzige knappe Wert ist der Sync, und er liegt genau auf der Grenze.** Nicht darunter mit Reserve: 3,0 s bei einem Ziel von 3 s, in einem Lauf 4,7 s. Wer die Zahl als bestanden verbucht, verbucht eine Punktlandung.
- **Es ist eine Warteschlange, keine Streuung.** p50 und p95 liegen 3 % auseinander (3023 / 3078 ms) — alle Geräte warten auf dieselbe Ressource und werden fast gleichzeitig fertig. Der aussagekräftige Wert ist deshalb der Durchsatz: **rund 64 Stapel/s, 255 Kommandos/s**, stabil über die Läufe.
- **Eine zu hohe Verbindungsobergrenze bricht den Lauf.** Mit `LOAD_DB_CONNECTION_LIMIT=100` scheiterten 93 von 200 Stapeln an Postgres' `max_connections` („too many clients"), während der p95 der übrigen scheinbar besser aussah — genau deshalb zählt der Harness abgebrochene Vorgänge getrennt und nicht als schnelle Läufe. **Der Satz hieß hier ursprünglich „die härtere Wand als die Outbox" und ist in dieser Form überholt**: unterhalb dieser Grenze ist die Verbindungszahl gar kein Hebel, siehe die Messreihe weiter unten.
- **Alles bleibt korrekt.** Null Deadlocks, null abgewiesene Kommandos, alle 200 Stapel vollständig angewendet. Unter Last wird das System langsam, nicht falsch.

**Nachtrag zum Wechsel auf Prisma 7:** derselbe Lauf auf derselben Maschine ist mit dem Treiber-Adapter durchweg langsamer als mit der alten Rust-Engine — p95 3,2/3,5/3,7 s gegen 3,0/3,06/3,08 s, Durchsatz 54–62 statt rund 64 Stapel/s. Damit wird das 3-Sekunden-Ziel hier **gerissen**, wo es vorher knapp gehalten wurde. Die naheliegende Erklärung wurde geprüft und trägt nicht: die Poolgröße ausdrücklich auf 25 zu setzen statt der stillen Vorgabe 10 des Adapters ändert an den Zahlen nichts. Die Ursache liegt im Adapter selbst, nicht in seiner Konfiguration. **Dieser Satz ist inzwischen verschränkt nachgemessen und bestätigt** (Messreihe unten) — anders als der Kommentar in `src/lib/db/client.ts`, der dasselbe Gegenteil behauptete und deshalb korrigiert wurde. Für den Piloten gilt: auf der Zielhardware nachmessen; die Reihenfolge der Hebel steht jetzt in der Messreihe und lautet nicht mehr „zuerst Verbindungsverwaltung".

**Nachgemessen nach zod 4** (drei Läufe, dieselbe Maschine): p95 **3899 / 3321 / 3171 ms**, Durchsatz 50,6 / 59,0 / 62,0 Stapel/s. zod validiert jedes Sync-Kommando, die Anhebung hätte also durchschlagen können — sie tut es nicht: die Zahlen liegen in demselben Band wie unter zod 3. Der Sync ist damit weiterhin der einzige gerissene Zielwert, und die Ursache liegt nicht bei der Validierung.

**Der erste Lauf ist zugleich die lehrreichste Zahl.** Er lag mit 3899 ms deutlich über den beiden folgenden, und der Unterschied war nicht der Code, sondern die Maschine: acht Container liefen, die Systemlast stand bei 2,9. Wer diesen Wert misst, misst zu einem guten Teil, was sonst noch läuft — ein weiteres Argument dafür, dass er **nicht** in die CI gehört (siehe unten) und dass die Messung auf der Zielhardware kein Formalismus ist. Für eine belastbare lokale Zahl: andere Container stoppen und mehrfach laufen lassen.

#### Messreihe: welcher Hebel wirklich wirkt (10.08.2026)

Anlass war Übergabepunkt 5 — der Sync ist der einzige gerissene Zielwert, und die Reihenfolge der Hebel stand bis dahin als Vermutung da. Gemessen wurde mit `LOAD_STEPS=5 LOAD_PHOTOS=5`: Szenario 2 läuft **vor** dem Aufbau der großen Akte und bleibt davon unberührt, ein Durchgang dauert damit 15 s statt einer Minute. Gerätezahl unverändert 200.

**Das Verfahren zuerst, weil es das Ergebnis bestimmt.** Die ersten beiden Durchgänge liefen blockweise — erst alle Läufe der einen Konfiguration, dann die der anderen — und lieferten zwei Befunde, die beide falsch waren: Pool 10 sei dreimal langsamer als 25, und mehr Organisationen brächten nichts. Dieselbe Konfiguration lieferte über die Sitzung 57–70 Stapel/s (p95 2856–3446 ms); blockweise gemessen schreibt man diese Drift der Konfiguration zu. **Verschränkt** (A, B, A, B, …) und paarweise ausgewertet kippen beide Befunde. Siehe „Blockweise verglichene Konfigurationen messen die Maschine".

| Hebel                              | verschränkt gemessen        | Runden             |
| ---------------------------------- | --------------------------- | ------------------ |
| `LOAD_DB_CONNECTION_LIMIT` 10 → 25 | **kein Unterschied**        | 4, ohne Vorzeichen |
| `UV_THREADPOOL_SIZE` 4 → 16        | **+5 %** (≈ 150 ms vom p95) | gewinnt 5 von 5    |
| `LOAD_ORGS` 1 → 4                  | **+15 %** (≈ 430 ms)        | gewinnt 4 von 4    |

Einzelwerte, damit die Streuung mitlesbar bleibt (Stapel/s): Pool 10 → 66,1 / 69,7 / 67,8 / 67,5 gegen Pool 25 → 67,4 / 67,7 / 63,3 / 67,6. Threadpool 4 → 59,2 / 56,6 / 59,1 / 57,1 / 67,9 gegen 16 → 61,5 / 59,9 / 60,7 / 62,2 / 69,9. Eine Organisation → 67,9 / 63,7 / 60,7 / 57,1 gegen vier → 76,7 / 75,4 / 65,1 / 71,1.

**Die Verbindungen sind nicht mehr die Wand.** Das ändert die bisherige Hebel-Reihenfolge: von 10 auf 25 ist kein Effekt messbar, und oberhalb von 25 erst recht nicht (blockweise gemessen, aber in dieselbe Richtung: 50 → 56,6/59,9, 80 → 56,9/56,8). Die Poolgröße ist damit richtig eingestellt und als Hebel erledigt — nicht der erste Schritt, sondern ein erledigter.

**Der erste Verdacht: die Zahl der Transaktionen je Stapel** — er hat sich nur halb bestätigt, siehe den Nachtrag weiter unten. An Postgres' eigenem Zähler gemessen (`pg_stat_database.xact_commit + xact_rollback` vor und nach Szenario 2, 200 Stapel): **4524 Transaktionen, also 22,6 je Stapel und 5,7 je Kommando.** Der Grund steht in `sync-commands.ts`: jedes Kommando durchläuft `claimCommand`, `executeCommand`, `finalizeCommand` und `rememberBatchVersion` als **je eigene** Transaktion, jede mit `BEGIN`, `set_config` für den Mandantenkontext und `COMMIT`. `rememberBatchVersion` öffnet eine ganze Transaktion, um eine einzige Spalte zu lesen.

**Der Durchsatz sättigt ab etwa 100 Geräten** (Stapel/s bei 1 / 10 / 50 / 100 / 200 Geräten: 9,3 / 41,4 / 45,8 / 56,8 / 57,1). Ein einzelner Stapel ohne Konkurrenz braucht 107 ms. Weil alle Geräte gleichzeitig starten, ist der p95 praktisch die Gesamtdauer — **das 3-Sekunden-Ziel ist bei 200 Geräten arithmetisch ein Durchsatzziel von ≥ 67 Stapel/s**, und genau auf dieser Schwelle liegt der Wert.

**Die PIN-Prüfung kostet weniger, als sie isoliert aussieht.** `scrypt` braucht einzeln 21 ms; 200 gleichzeitig 1013 ms mit dem voreingestellten Threadpool von vier Plätzen, 291 ms mit sechzehn. Das legte 700 ms Ersparnis nahe — im echten Lauf sind es 150 ms, weil die Ableitung sich größtenteils mit Datenbankwartezeit überlappt. Ein Beispiel dafür, dass ein isolierter Mikrobenchmark die Obergrenze nennt und nicht die Wirkung.

**Nachtrag, direkt danach ausprobiert — und er widerlegt den Absatz oben zur Hälfte.** `rememberBatchVersion` ist in `finalizeCommand` hineingezogen worden; die Transaktionen je Stapel fielen dadurch von **23,4 auf 20,0** (−15 %, verschränkt gemessen, 0 abgewiesene Kommandos). Der Durchsatz zog dabei um **2,4 %** an (3 von 4 Runden), der **p50 um 224 ms** (4 von 4) — und der **p95 gar nicht** (2 von 4, im Rauschen). Also genau der Wert nicht, den docs/09 vorgibt.

Das ist kein Nullergebnis, sondern eine Auskunft über die Form der Last: **der Rumpf des Feldes hängt an der Arbeit je Kommando, der Schwanz an etwas Serialisiertem.** Dazu passt die Messung mit vier Organisationen, wo p50 und p95 weit auseinandergehen (2036 gegen 2554 ms) statt wie sonst 3 % (2823 gegen 2892 ms): das letzte Gerät wartet nicht auf Rechenarbeit, sondern auf die Zeilensperre des Outbox-Zählers. **Für den p95 ist deshalb der Zähler der Hebel, nicht die Transaktionszahl.**

**Reihenfolge der Hebel nach dieser Messung**, an die Stelle der bisherigen:

1. **Zähler je Produktionsauftrag statt je Organisation.** +15 %, und der einzige gemessene Hebel, der den **p95** bewegt — die anderen verbessern den Median. Viel Umbau; `outbox-sequence.ts` benennt genau diesen Weg als den vorgesehenen und die Rückkehr zur Postgres-Sequenz ausdrücklich als den falschen.
2. **`UV_THREADPOOL_SIZE=16`** in der Zielumgebung setzen. Eine Umgebungsvariable, +5 %, kein Risiko — nicht gesetzt bedeutet vier Plätze für jede scrypt-Ableitung des Prozesses.
3. **Weitere Transaktionen je Kommando zusammenlegen.** Nach dem Nachtrag oben stehen 20,0 je Stapel; unter 3 je Kommando käme man nur, indem man `claimCommand` mit der Ausführung verschmilzt — und das gäbe die Absturzspur auf, die `PENDING` überhaupt erst begründet. Der Rest lohnt als Aufräumen, nicht als Beschleunigung: gemessene 2,4 % für 15 % weniger Transaktionen.

**Und der Vorbehalt, der über allem steht:** auf diesem Laptop ist der Wert nicht entscheidbar. Dieselbe Konfiguration lieferte p95 zwischen 2856 ms (Ziel gehalten) und 3446 ms (Ziel gerissen), je nach Zustand der Maschine. Die Messung auf der Zielhardware bleibt genau deshalb offen.

**Bewusst nicht in der CI.** Messwerte hängen an der Maschine; ein Gate, das je nach Runner-Auslastung rot wird, erzieht dazu, rote Läufe zu ignorieren. Der Lauf prüft die Ziele trotzdem und endet mit Exit-Code 1, wenn eines gerissen wird — für einen Lauf von Hand vor einem Release ist das die richtige Härte.

#### Der Lauf urteilt jetzt über eine Reihe, nicht über eine Zahl (13.08.2026)

Der Vorbehalt oben — „auf diesem Laptop ist der Wert nicht entscheidbar" — war richtig, aber der Lauf selbst wusste nichts davon. Er meldete einen p95, und je nachdem, welchen man erwischte, stand dort „bestanden" oder „gerissen". Auf der Zielhardware wäre das genauso gewesen: **die Streuung kommt vom Szenario, nicht von der Maschine.** Eine Messung, die dort einmal läuft, hätte das Problem mitgenommen statt es zu lösen.

`LOAD_REPEAT=n` fährt den Schichtwechsel-Sync deshalb n-mal gegen je **frische** Fixtures — nach dem ersten Stapel sind die Schrittversionen fortgeschritten, ein zweiter gegen dieselben Geräte würde abgewiesen und misste die Ablehnung. Die Reihe kennt drei Ausgänge statt zwei:

| Reihe                     | Urteil                                           |
| ------------------------- | ------------------------------------------------ |
| alle Läufe unter dem Ziel | bestanden                                        |
| alle Läufe über dem Ziel  | gerissen                                         |
| Läufe beidseits           | **nicht entschieden** — gilt als nicht bestanden |

**Der dritte Ausgang ist der Grund für die ganze Übung.** Bei der Reihe 2856/3446/2990 aus der Messung oben liegt der **Median bei 2990 ms**, also unter dem Ziel: ein Urteil über den Median allein hätte „bestanden" gemeldet. Nachgeprüft mit vier konstruierten Reihen; die drei Ausgänge treffen zu, „genau auf der Marke" gilt als bestanden (`measured <= target`, wie im übrigen Lasttest).

Dazu ein **Steckbrief der Maschine** in der Ausgabe und in `LOAD_RESULT_FILE` als JSON: Kerne, Takt, Speicher, Node, Docker, `UV_THREADPOOL_SIZE`, `DATABASE_POOL_MAX`, Vorlast. Die Frage lautet nicht „ist der p95 unter 3 s", sondern „ist er es **auf dieser Hardware**" — und die zweite ist an einer Zahl ohne Maschine nicht zu beantworten. Liegt die Vorlast beim Start über 0,3 je Kern, warnt der Lauf: dann misst man den Zustand der Maschine.

**Vergleichswert auf dem Entwicklungsrechner** (Apple M5 Pro, 18 Kerne, 48 GB, `UV_THREADPOOL_SIZE` nicht gesetzt), 200 Geräte, 5 Läufe: p95 **3064–3554 ms, Median 3112**, Streuung 15,8 % — **alle fünf über dem Ziel**, also „gerissen" und nicht „nicht entschieden". Deadlocks 0, abgewiesene Kommandos 0.

**Und eine Probe, die nichts ergab, aber trotzdem hierhergehört.** Nach dem Grundlauf lag nahe, dass `UV_THREADPOOL_SIZE=16` (+5 % laut Messung oben) die 3112 ms unter 3000 drücken könnte. Verschränkt gemessen, 5 Paare: 16 war in **3 von 5** Paaren schneller, Median der Paardifferenz 98 ms (2,4 %) — bei Einzeldifferenzen von **−859 bis +607 ms**. Der Effekt ist kleiner als das Rauschen; mit fünf Paaren ist er weder bestätigt noch widerlegt. Bemerkenswerter ist etwas anderes: dieselbe Konfiguration lag in dieser Probe bei p95 3625–4654 ms gegen 3064–3554 ms zwanzig Minuten zuvor. **Die Maschine war schlicht eine andere geworden.** Wer auf der Zielhardware misst, misst im Leerlauf und liest den Vorlast-Hinweis.

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

Die Gates vor dem Piloten sind abgearbeitet, ebenso die bekannten Lücken aus der Phase-6-Übergabe; die Testpyramide aus docs/09 ist vollständig. Bis auf **Punkt 0** braucht alles Verbliebene eine Zielumgebung, eine Entscheidung außerhalb dieses Repositories oder den Piloten selbst.

**Nach dem Piloten gehören drei Dokumente nachgezogen**, und sie sagen das selbst: die ⚠️-Kennzeichen in [docs/13](docs/13_STAGING_SETUP.md) und [docs/14](docs/14_RUNBOOK.md) durch das, was tatsächlich gelaufen ist; die neun `[FESTZULEGEN]`-Punkte in [docs/16](docs/16_ON_CALL.md) durch eure Festlegungen — bis dahin ist es eine Vorlage und kein Verfahren; und die fünf Missverständnisse in [docs/15](docs/15_TRAINING.md) durch die, die wirklich angerufen haben, denn sie sind aus der Konstruktion abgeleitet und nicht aus Beobachtung.

0. **Verwaiste Uploads im Objektspeicher — erledigt, mit einer verbliebenen Lücke.**

   Der Befund war: **11 Objekte unter `ifc/`, eine einzige Zeile in `ifc_imports`, 156 MB.** Zehn davon aus Importen, die abgewiesen wurden — dieselbe Datei ein zweites Mal, eine belegte Plannummer, ein gekappter Körper. Jeder Versuch hatte 23 MB abgelegt und nie wieder angefasst.

   **Der laufende Fall ist behoben:** die Route räumt eine hochgeladene Datei weg, sobald der Import nicht durchläuft, und schreibt eine Warnung mit Grund ins Protokoll. Die Reihenfolge Ablegen → Scannen → Lesen bleibt unangetastet — der Virenscanner arbeitet auf dem Objektspeicher und nicht auf einem Puffer.

   **Für die Altlast gibt es ein Kommando:**

   ```bash
   pnpm run ifc:orphans                     # nur berichten
   pnpm run ifc:orphans -- --delete         # nach dem Bericht auch löschen
   pnpm run ifc:orphans -- --min-age-hours=48
   ```

   Drei Sicherungen darin, und die erste ist die wichtigste — sie ist auch der Grund, warum dieses Werkzeug nicht in fünf Zeilen zu haben war:

   1. **Es läuft über `DIRECT_DATABASE_URL`, nicht über die Anwendungsrolle.** `proquado_app` unterliegt RLS und sieht ohne gesetzten Organisationskontext **null** Zeilen (docs/13 Schritt 6 misst das nach). Mit dieser Rolle hielte der Lauf jedes Objekt für verwaist. **Nachgestellt**: mit der Anwendungsrolle gestartet, meldete er alle 11 Objekte als Waisen — und brach vor dem Löschen ab.
   2. **Objekte unter 24 Stunden bleiben unangetastet.** Zwischen `putObject` und dem `INSERT` liegen bei 23 MB einige Sekunden; ein Lauf in diesem Fenster löschte eine Datei, deren Import gerade läuft. Sie werden im Bericht als „geschützt, zu jung" ausgewiesen, nicht verschwiegen.
   3. **Null bekannte Schlüssel bei vorhandenen Objekten bricht ab.** Leere Tabelle und RLS-verborgene Zeilen sehen von dort aus gleich aus, und raten ist hier die teuerste Option.

   **Ausgeführt** gegen die Entwicklungsumgebung: 8 Objekte gelöscht, 90 MB; die referenzierte Datei blieb, die beiden zu jungen ebenfalls.

   **Der Lauf unterscheidet zwei Arten von Waisen**, und das war die eigentliche Arbeit. Eine Datei **ohne Spur im Audit-Trail** gehört zu einem abgewiesenen Versuch: nie ein Plan, nichts zugerechnet, Abfall. Eine mit Eintrag `ifc_import.executed` gehört zu einem Import, der stattgefunden hat und dessen Plan später verschwand — nach ADR-004 bleibt der Vorgang zugerechnet, und seine Datei wegzuwerfen macht daraus einen unbelegbaren. Solche Funde werden **nie** automatisch gelöscht, sondern getrennt ausgewiesen und einem Menschen vorgelegt.

   Möglich wurde das erst, indem der Audit-Eintrag den **Speicherschlüssel** mitführt. Dateiname und Hash trugen es nicht: beide sagen nichts darüber, wo die Datei liegt. **Rückwirkend lässt es sich nicht nachtragen** — für Importe davor bleibt die Zuordnung unmöglich, und ältere Funde erscheinen als „ohne Spur", obwohl sie es womöglich nicht sind. Wer eine Umgebung mit Importhistorie aufräumt, sollte das wissen.

   **Am lebenden System durchgespielt**: importieren, Plan löschen, Lauf mit `--delete --min-age-hours=0`. Ergebnis — zwei Waisen ohne Spur gelöscht, die dritte mit dem Vermerk „im Audit-Trail verzeichnet — von Hand entscheiden" stehen geblieben.

   Der zweite Weg zu einer Waise besteht ebenfalls fort: wer eine Plan-Revision löscht, löst die Zeile, nicht das Objekt. Solange es dafür keine Oberfläche gibt, betrifft das nur, wer von Hand in der Datenbank arbeitet.

1. **Wenn ein realer ERP-Konsument da ist**, ADR-008 neu bewerten: dann zeigt sich, ob das Ereignisformat trägt oder eine Abbildungsschicht dazugehört. Genau dafür hatte docs/10 die Umsetzung ursprünglich zurückgestellt.

2. **Scheduler für `POST /api/v1/integrations/webhooks/dispatch` einrichten**, sobald ein Webhook produktiv genutzt wird. Ohne ihn sammeln sich Zustellungen als `PENDING` an, ohne dass jemand etwas merkt.

3. **Die CI-Stufe `e2e-tests` läuft — mit einer Reserve, die man im Auge behalten sollte.** Sie steht in `.github/workflows/ci.yml`, deckt Ebene 6 und 9 mit demselben Kommando ab und war in PR #1 erstmals grün: alle fünf Jobs, `e2e-tests` in 3 min 25 s, darin damals 13 Tests in 1,6 min (inzwischen 26). Zwei Zahlen daraus sind es wert, gemerkt zu werden, weil sie lokal ganz anders aussehen:
   - **Keycloak brauchte 14 Versuche** (rund 28 s), bis der Realm antwortete; lokal ist er nach dem ersten da. Die Warteschleife gibt 60 Versuche à 2 s. Reserve ist also reichlich, aber es ist die Stelle, die bei einem langsameren Runner zuerst kippt — und wenn sie kippt, sagt die Meldung samt angehängtem `docker compose logs keycloak` genau das.
   - **Der Testlauf dauert auf dem Runner das Fünffache** (1,6 min gegen 17 s lokal), im Wesentlichen der Production-Build. Wer Tests ergänzt, sollte das einrechnen, bevor er sich über die Wartezeit wundert.

   Bis dahin war die Stufe zweimal gescheitert, beide Male vor dem ersten Test — siehe „Die CI war sieben Phasen lang nie gelaufen".

4. **Next 16 ist gemacht, ESLint 10 bleibt offen — und zwar nicht aus Bequemlichkeit.** ESLint 10 entfernt die alten `context`-Methoden; `eslint-config-next` 16 bringt `eslint-plugin-react@7.37.5` mit, das `context.getFilename()` weiterhin aufruft. Der Lauf stirbt sofort und für **jede** Datei: `TypeError: Error while loading rule 'react/display-name': contextOrFilename.getFilename is not a function`. Die Paketstände sagen dasselbe voraus — `eslint-plugin-react` nennt als Peer `^9.7` als Obergrenze, und 7.37.5 ist der aktuelle Stand, es gibt also keine Fassung, auf die man ausweichen könnte. Die beiden Auswege wären gewesen, die React-Regeln abzuschalten oder die Konfiguration von Hand nachzubauen; beides tauscht eine Versionsnummer gegen einen Teil der Prüfung. Deshalb: ESLint bleibt bei **9.39.5**, `eslint-config-next` und `eslint-config-prettier` sind mitgezogen. Wiederaufnehmen, sobald `eslint-plugin-react` ESLint 10 als Peer nennt — die Prüfung dafür ist ein Einzeiler:

   ```bash
   npm view eslint-plugin-react peerDependencies
   ```

   **Dependabot ist dafür stillgelegt**, nicht bloß dieser eine PR geschlossen: `.github/dependabot.yml` ignoriert `eslint` ab Version 10, mit der Begründung im Klartext daneben. Ein PR, der monatlich neu aufsteht und jedes Mal an derselben Stelle scheitert, erzieht dazu, rote Läufe zu übersehen — dieselbe Überlegung, aus der der Lasttest nicht in der CI steht. Patch- und Minor-Anhebungen innerhalb von ESLint 9 laufen unverändert weiter. Nennt die Probe oben eines Tages ESLint 10, gehört der `ignore`-Block weg.

5. **Den Sync-Wert auf der Zielhardware nachmessen, bevor der Pilot startet.** Er ist der einzige Zielwert aus docs/09, der nicht mit Reserve besteht — und der einzige, den kein Entwicklungsrechner entscheiden kann. **Das Kommando steht bereit und dauert etwa eine Minute:**

   ```bash
   UV_THREADPOOL_SIZE=16 LOAD_REPEAT=5 LOAD_RESULT_FILE=sync-zielhardware.json pnpm run test:load
   ```

   Auf der Zielhardware braucht es dafür **Docker, Node ≥ 22.13 und pnpm**, sonst nichts — der Lauf bringt Postgres und MinIO als Container selbst mit. `LOAD_REPEAT=5` ist kein Feinschliff: ein einzelner Lauf beantwortet die Frage auch dort nicht, weil die Streuung vom Szenario kommt und nicht von der Maschine. Die Reihe kennt deshalb „nicht entschieden" als eigenen Ausgang — siehe „Der Lauf urteilt jetzt über eine Reihe, nicht über eine Zahl". `LOAD_RESULT_FILE` schreibt Messwerte samt Maschinensteckbrief als JSON; ohne den ist ein Wert später keiner Hardware zuzuordnen.

   **Vergleichswert vom 13.08.2026** (Apple M5 Pro, 18 Kerne, `UV_THREADPOOL_SIZE` nicht gesetzt): p95 3064–3554 ms über 5 Läufe, **alle über dem Ziel**. Ein schneller Laptop reißt die Marke also deutlich — wer einen Server mietet, sollte das einrechnen und nicht auf die Hebel allein setzen.

   **Die Hebel sind durchgemessen** („Messreihe: welcher Hebel wirklich wirkt", 10.08.2026), und die Reihenfolge lautet nicht mehr „zuerst Verbindungsverwaltung": die Poolgröße ist kein Hebel mehr. Den **p95** bewegt allein die Serialisierung des Outbox-Zählers je Organisation; die Zahl der Transaktionen je Stapel bestimmt den Median und wurde bereits um 15 % gesenkt, ohne dass der Zielwert davon profitierte. **`UV_THREADPOOL_SIZE=16`** ist ein risikoloser Gewinn von etwa 5 % und gehört in die Deployment-Konfiguration — dass er allein die Lücke schließt, ist allerdings **nicht belegt**: eine verschränkte Probe mit fünf Paaren blieb im Rauschen.

6. **Code Scanning — erledigt, und der Weg dorthin ist die eigentliche Auskunft.** Hier stand bis zum 13.08.2026, es sei abgeschaltet und `.github/workflows/codeql.yml` scheitere deshalb bei jedem PR (`Resource not accessible by integration`). Beides war richtig — **solange das Repository privat war**. Mit der Rückkehr auf öffentlich hat GitHub die Analyse von selbst wieder aufgenommen; nichts eingeschaltet, nichts geändert.

   **Nachgeprüft an den hochgeladenen Analysen**, nicht am grünen Haken:

   ```bash
   gh api "repos/4b5j6f4m95-create/ProQuaDo/code-scanning/analyses?per_page=3" \
     --jq '.[] | "\(.created_at)  \(.category)  Regeln=\(.rules_count)  Ergebnisse=\(.results_count)"'
   ```

   Drei Analysen seit `7532417`, je **201 Regeln, 0 Ergebnisse**. Die Zahl der Regeln ist dabei der Beleg und nicht die Null: **null Befunde bei null gelaufenen Regeln sähen genauso aus.** Dieselbe Überlegung wie beim axe-Helfer, der eine Mindestzahl bestandener Regeln verlangt, damit ein Scan auf einer leergebliebenen Seite nicht als „keine Verstöße" durchgeht.

   **Eine Falle für das nächste Mal:** `code-scanning/default-setup` meldet weiterhin `state: not-configured`, und das ist **kein** Widerspruch. Das Feld beschreibt allein die Standardeinrichtung über die Weboberfläche; hier läuft die Analyse über den Workflow (Advanced Setup). Wer den Zustand an dieser Abfrage festmacht — wie es hier zuerst stand —, liest dauerhaft „aus", während geprüft wird. Die belastbare Frage ist, ob **Analysen ankommen**.

   Offen bleibt allein, dass CodeQL **nicht** unter den erforderlichen Checks der Branch Protection steht. Das war richtig, solange der Job scheiterte; jetzt spräche nichts mehr dagegen, ihn aufzunehmen — mit dem Vorbehalt, dass er bei der nächsten Umschaltung auf privat wieder rot würde und dann jeden Merge sperrte. Siehe „Ein privates Repository verliert seine Schutzregel".

7. **Die Staging-Passwörter sind aus der Compose-Datei heraus — die alte Umgebung braucht trotzdem noch einen Handgriff.** `staging_owner_secret`, `staging_minio_secret` und `staging_keycloak_secret` standen fest in `infra/staging/docker-compose.staging.yml`, **nicht** als Platzhalter gekennzeichnet, anders als in `.env.example`, wo „replace-with-openssl-rand-base64-32" schon durch seinen Wortlaut zum Ersetzen auffordert. Sie kommen jetzt aus `infra/staging/.env`, und die `${VAR:?...}`-Form lässt `docker compose up` mit benannter Meldung abbrechen, wenn ein Wert fehlt.

   **Eine Korrektur an dem, was hier zuerst stand:** „Es hängt kein System daran, die Umgebung ist nie aufgesetzt worden" war falsch. Nur **Schritt 8** trägt ⚠️; die Schritte 1–7 sind ✅ und liefen gegen eine echte Staging-Umgebung — mit genau diesen Passwörtern. Ihre Daten liegen weiterhin unter `infra/staging/.staging-data` (67 MB). Die Ports lagen auf localhost, das Risiko ist also klein, aber die Werte waren echte Zugangsdaten und keine Beispiele. Wer diese Umgebung weiterbenutzt, muss sie **aktiv wechseln**: neue Werte in `.env` genügen für PostgreSQL nicht, weil `POSTGRES_PASSWORD` nur beim ersten Anlegen des Datenverzeichnisses ausgewertet wird — `ALTER ROLE`, siehe docs/13. MinIO und Keycloak übernehmen ihre Werte bei jedem Start neu. Alternativ `.staging-data` wegwerfen und neu aufsetzen.

   Verwandt mit „Eine Aussage im Dokument ist keine Funktion": ein Wert, der wie ein Beispiel aussieht, ist keiner, solange er funktioniert. Und die Fehldiagnose oben ist ein zweites Beispiel derselben Art — ein ⚠️ am Ende eines Dokuments las sich wie ein ⚠️ über dem ganzen.

### Arbeitsweise, die sich in diesem Projekt bewährt hat

- Vor jeder Phase die zugehörigen `docs/`-Kapitel lesen; sie sind vor dem Code entstanden und enthalten die Begründungen.
- Abweichungen von `docs/` **hier** festhalten, nicht stillschweigend umsetzen — der Abschnitt „Architekturentscheidungen mit Nachwirkung" ist genau dafür da und hat mehrfach Widersprüche sichtbar gemacht.
- Am Ende jeder Phase die vollständige Prüfkette laufen lassen, dazu `pnpm run test:e2e`, **und** die betroffenen Seiten einmal im Browser öffnen. Die E2E-Tests ersetzen das Durchspielen nicht — sie halten fest, was einmal durchgespielt wurde.
- Bei jedem gefundenen Fehler zusätzlich fragen, warum die vorhandenen Kontrollen ihn nicht gesehen haben — die lehrreichsten Einträge unter „Bekannte Stolpersteine" sind so entstanden.
- **Einen Ablauf einmal ganz durchspielen, nicht nur seine Teile testen.** Der Offline-Durchlauf in Phase 7 fand drei Fehler, obwohl jeder einzelne Baustein grüne Tests hatte. Der schwerste entstand erst aus der Kombination: mehrere Kommandos mit demselben `baseVersion` in einem Stapel — eine Form, die kein Test erzeugte, weil jeder Test seine Kommandos mit dem Wissen des Servers baut, das ein echter Client nicht hat. Wo Tests Eingaben konstruieren, konstruieren sie leicht die bequemen.
- **Was nur in Production greift, muss auch einmal in Production laufen.** Die CSP war in der gesamten Prüfkette abgeschaltet und verhinderte dort, wo sie galt, jede Hydration — sieben Phasen lang unbemerkt, weil niemand `next start` ausgeführt hatte. Grün heißt nur „geprüft, was geprüft wurde".
- **Jeder Zweig beginnt auf `main`, und das wird geprüft, nicht gehofft.** `git checkout -b` setzt auf dem Zweig auf, auf dem man gerade steht — nach einem `git push` ist das der eben gepushte. An einem Tag hat dieser Reflex dreimal zugeschlagen (siehe „`git checkout -b` nimmt den Zweig, auf dem man steht"): einmal trug ein PR die Commits eines anderen huckepack und machte ihn dadurch inhaltslos, einmal landete ein Commit auf einem Zweig, dessen PR schon gemergt war. Deshalb `git switch main && git pull && git switch -c <zweig>` als eine Handlung — und vor jedem PR die Gegenprobe:

  ```bash
  git log --oneline origin/main..HEAD
  ```

  Steht dort mehr als die eigene Arbeit, sitzt der Zweig falsch.

- **Das Mergen vor grünen Checks verhindert jetzt GitHub, nicht mehr die Aufmerksamkeit.** Auf `main` liegt eine Branch-Protection-Regel mit allen fünf CI-Jobs als erforderlichen Checks, `strict` und `enforce_admins` eingeschlossen — sie gilt also auch für Administratoren. Zwei Folgen für die tägliche Arbeit: direktes `git push` auf `main` geht nicht mehr, alles läuft über PRs; und `gh pr merge --auto` tut endlich, was der Name sagt. Vorgeschichte: PR #3 landete vor seinen eigenen Checks, weil `--auto` ohne erforderliche Checks sofort mergt, und die Regel selbst war damals gesperrt — Branch Protection ist bei GitHub für **private** Repositories dem Pro-Plan vorbehalten. Seit das Repository öffentlich ist, greift sie. **Diese Bedingung ist keine Fußnote**: das Repository war zwischenzeitlich wieder privat, damit war die Regel weg, und beim Zurückschalten kam sie nicht von allein wieder — siehe „Ein privates Repository verliert seine Schutzregel". Wer an der Sichtbarkeit dreht, prüft danach `gh api .../branches/main/protection`.
- **Eine Betriebsanweisung, die hier hineingeschrieben wird, sollte einmal ausgeführt worden sein.** Der `--force-recreate`-Hinweis für Keycloak stand eine halbe Phase lang da, war plausibel formuliert und entwertete beim Befolgen jede Kontoverknüpfung. Dokumentation, die man nur zu Ende gedacht hat, ist eine Vermutung mit Befehlszeile.
- **Zahlen, die eine Begründung tragen, gehören in einen Test.** Zweimal an einem Tag hatte ein Kommentar eine Größenordnung behauptet, die nicht stimmte (Dauer eines PIN-Durchprobierens, Anzahl gefundener Fehler). Wo eine Zahl das Argument ist, prüft sie am besten die Testsuite — siehe `lockSecondsForAttempts`.
- **Fragen, was am ersten Tag zu tun ist — nicht nur, was der Code kann.** Die folgenreichste Lücke dieses Projekts stand nicht im Code, sondern in einer Formulierung des Plans: `docs/10` führt die Datenmigration als „falls Altsystem vorhanden" und stellt die andere Hälfte der Frage nie. Dahinter lag, dass sich Stammdaten und Bestätigungs-PINs überhaupt nicht erfassen ließen — ein Pilot wäre vor leeren Auswahllisten und arbeitsunfähigen Konten gestanden. Kein Test hätte das gefunden, denn alles Vorhandene war richtig; gefehlt hat, was niemand verlangt hatte. Bei jeder Phase lohnt deshalb die Gegenfrage: **wenn morgen jemand mit einer leeren Datenbank anfängt, woran scheitert er zuerst?**
- **Eine Aussage im Dokument ist keine Funktion.** Vier Sätze in dieser Datei und in docs/12–14 beschrieben eine Absicht und lasen sich wie eine Beschreibung: der Seed-Befehl, der ohne exportierte Variablen scheitert; „echte Benutzer setzen ihre PIN selbst"; „eine vergessene PIN ist Selbstbedienung"; „nichts davon ist Programmierarbeit". Alle vier standen plausibel da, bis jemand sie ausführen wollte. Wer hier etwas behauptet, das jemand später tun soll, sollte es einmal getan haben — und wenn nicht, es kennzeichnen (⚠️, wie in docs/13 und docs/14).
