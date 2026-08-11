# 12. Betrieb und Inbetriebnahme

**Dokumentversion:** 1.0
**Status:** Betriebsdokumentation (entstanden nach der Implementierung, anders als docs/01–10)
**Gültig ab:** 2026-08-10

Was ein Server braucht, damit ProQuaDo läuft — und was er zusätzlich braucht, damit es _in Produktion_ läuft. Die Trennung ist nicht kosmetisch: mehrere Absicherungen dieses Systems greifen ausschließlich bei `NODE_ENV=production` und sind in der Entwicklung abgeschaltet.

Ergänzt docs/01 (Zieltopologie, nichtfunktionale Anforderungen) und docs/08 (Bedrohungsmodell). Wo dieses Dokument von docs/01 abweicht, ist docs/01 die ältere Absicht und dieses hier der Stand der Implementierung.

---

## 1. Komponenten

| Komponente                     | Anforderung                     | Anmerkung                                                                                              |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Node.js                        | **≥ 22.13**                     | `packageManager` ist pnpm 11, das `node:sqlite` lädt. Node 20 scheitert schon bei `pnpm install`.        |
| PostgreSQL                     | 15+ (erprobt: 16)               | Datenbankname **muss `proquado`** sein — er steht fest in einer Migration (`GRANT CONNECT ON DATABASE`). |
| S3-kompatibler Objektspeicher  | Bucket muss vorab existieren    | MinIO, AWS S3, Ceph. Die Anwendung legt keinen Bucket an.                                                |
| OIDC-Provider                  | Discovery-Endpunkt erreichbar   | Generisch (ADR-001). Keycloak ist das Entwicklungsbeispiel, keine Voraussetzung.                         |
| clamd (ClamAV)                 | über TCP erreichbar, **x86-64** | Pflicht: `MALWARE_SCANNER=stub` wird in Produktion mit hartem Fehler abgelehnt. Das gepinnte `clamav/clamav:1.4` gibt es **nur für amd64** — siehe §8. |
| Reverse Proxy                  | TLS 1.3                         | Auch zuständig für unauthentifizierte Fluten — die App drosselt erst nach der Anmeldung (docs/08).       |
| Scheduler (cron o. ä.)         | nur bei genutzten Webhooks      | Ruft den Dispatch-Endpunkt auf, siehe §6.                                                                |

**Nicht erforderlich:** Redis, Message Queue, separate Worker. ADR-007 hält Queue-Infrastruktur bewusst aus dem MVP heraus; Exporte laufen synchron hinter einem Job-Datensatz, Benachrichtigungen werden beim Lesen verteilt.

---

## 2. Umgebungsvariablen

### Pflicht

| Variable                                                                      | Bedeutung                                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                | Verbindung der Anwendungsrolle `proquado_app`. RLS gilt für sie — die App läuft hierüber. |
| `DIRECT_DATABASE_URL`                                                         | Schemabesitzende Rolle. **Nur** für `prisma migrate` und den Seed, nie zur Laufzeit.     |
| `AUTH_SECRET` 🔑                                                              | `openssl rand -base64 32`. Signiert die Sitzung.                                         |
| `AUTH_URL`                                                                    | Öffentliche URL der Anwendung, exakt. Redirects und Cookies hängen daran.                |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` 🔑                      | Anbindung an den Identitätsanbieter.                                                     |
| `RELEASE_TOKEN_SECRET` 🔑                                                     | HMAC-Schlüssel der Release Tokens (docs/06). **Eigener Wert**, nicht `AUTH_SECRET`.      |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` 🔑, `S3_SECRET_ACCESS_KEY` 🔑 | Objektspeicher. Siehe §5 zur Wirkung von `S3_ENDPOINT` auf die CSP.          |
| `MALWARE_SCANNER=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT`                        | Virenscan. Ohne Wert: Produktion bricht beim ersten Upload hart ab.                      |
| `NODE_ENV=production`                                                         | Ohne das: keine CSP, kein Verbot des Scanner-Stubs, prozesslokale Rate Limits.           |

### Optional

| Variable                        | Vorgabe                       | Wirkung                                                                             |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------- |
| `S3_FORCE_PATH_STYLE`           | `false`                       | Für MinIO auf `true`.                                                                   |
| `DATABASE_POOL_MAX`             | `25`                          | Poolgröße des Treiber-Adapters. **`connection_limit` in der URL wirkt seit Prisma 7 nicht mehr** — siehe unten. |
| `RATE_LIMIT_STORE`              | `postgres` (in Produktion)    | So lassen. `memory` zählt je Prozess und vervielfacht hinter N Repliken jedes Limit.    |
| `CLAMAV_TIMEOUT_MS`             | `30000`                       |                                                                                         |
| `LOG_LEVEL`                     | `info`                        |                                                                                         |
| `SERVER_NODE_ID`                | —                             | Je Instanz unterschiedlich setzen; steht im Audit-Trail.                                |
| `UV_THREADPOOL_SIZE`            | `4` (Node-Vorgabe)            | Auf **16** setzen. Nodes Threadpool bearbeitet jede `scrypt`-Ableitung der PIN-Prüfung; mit vier Plätzen stehen sie beim Schichtwechsel Schlange. Gemessene 5 % Durchsatz, kein Risiko — siehe §8. |
| `ALLOW_PRIVATE_WEBHOOK_TARGETS` | —                             | Nur Entwicklung. In Produktion bedingungslos ignoriert.                                 |

---

### 2.1 Verbindungen seit Prisma 7

Prisma 7 hat die Rust-Engine abgelöst; der Client verbindet über einen Treiber-Adapter (`pg`). Drei Folgen für den Betrieb:

- **Im Schema stehen keine URLs mehr.** Die Anwendung liest `DATABASE_URL` selbst (`src/lib/db/client.ts`), `prisma migrate` und der Seed lesen `DIRECT_DATABASE_URL` über `prisma.config.ts`. Die Trennung aus ADR-006 liegt damit in zwei Dateien statt in zwei Feldern derselben.
- **Die Poolgröße steuert `DATABASE_POOL_MAX`**, nicht mehr `connection_limit` in der URL. Der Parameter wird stillschweigend überlesen; ohne die Variable nähme der Adapter die Vorgabe von `pg` (10 Verbindungen).
- **Der Sync ist damit langsamer geworden** als unter Prisma 5 — siehe §8. Wer an der Durchsatzgrenze plant, sollte das einrechnen.

---

## 3. Vor dem ersten Start

### 3.1 Datenbankrolle selbst anlegen — sonst kommt ein Passwort aus dem Repository mit

Die Migration legt die Anwendungsrolle nur an, **wenn es sie noch nicht gibt**:

```sql
IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'proquado_app') THEN
  CREATE ROLE proquado_app LOGIN PASSWORD 'proquado_app_dev_only';
```

Wer in der Zielumgebung einfach migriert, bekommt eine Rolle mit einem Passwort, das öffentlich im Quelltext steht. Richtige Reihenfolge:

```sql
CREATE ROLE proquado_app LOGIN PASSWORD '<echtes Geheimnis>';
```

Danach greift `IF NOT EXISTS`, und die Migration lässt die Rolle unangetastet. Die Rechte (GRANTs, RLS-Policies) vergibt sie weiterhin selbst.

### 3.2 Bucket anlegen

Der Bucket aus `S3_BUCKET` muss existieren, bevor der erste Upload kommt; die Anwendung erzeugt ihn nicht. Empfohlen: Versionierung und serverseitige Verschlüsselung aktiv (docs/01).

### 3.3 OIDC-Client konfigurieren

Beide Listen müssen gepflegt sein:

- `redirectUris` — Rücksprung nach der Anmeldung
- `post.logout.redirect.uris` — Rücksprung nach der **Abmeldung**

Fehlt die zweite, scheitert die Abmeldung mit „Invalid redirect uri". Sie wird gebraucht: auf einem geteilten Hallentablet ist die Abmeldung der einzige Weg, den Benutzer zu wechseln, und die App ermittelt den `end_session_endpoint` über die Discovery — ein fest verdrahteter Keycloak-Pfad wäre ein Bruch von ADR-001.

---

## 4. Inbetriebnahme

```bash
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec prisma migrate deploy       # nutzt DIRECT_DATABASE_URL
pnpm exec prisma db seed              # legt Rollen und Berechtigungsatome an
pnpm run build
pnpm run start                        # oder über einen Prozessmanager
```

**`prisma db seed`, nicht `tsx prisma/seed.ts`.** Beide führen dasselbe Skript aus, aber `prisma/seed.ts` liest `DIRECT_DATABASE_URL` unmittelbar aus der Prozessumgebung und lädt selbst kein dotenv — das tut `prisma.config.ts`, und das sieht nur die Prisma-CLI. Stehen die Variablen bereits in der Umgebung (der Normalfall in einer Pipeline), funktionieren beide. Liegt die Konfiguration in einer Datei, scheitert die direkte Form mit `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` — einer Meldung, die nach einem Datenbankproblem aussieht und keines ist. Der Weg über die CLI funktioniert in beiden Fällen.

**Der Seed ist kein einmaliger Schritt.** Neue Berechtigungsatome gelangen ausschließlich über einen erneuten Lauf in bestehende Organisationen — nichts im Deployment-Pfad ruft `seedOrganizationRbac` automatisch auf. Wer ein Release einspielt, das ein Atom ergänzt hat, und den Seed auslässt, bekommt `PERMISSION_DENIED` für Rechte, die im Code längst vergeben sind. Der Seed ist idempotent und darf jederzeit erneut laufen.

---

## 5. Was nur in Produktion greift

Diese Mechanismen sind in der Entwicklung abgeschaltet. Jeder von ihnen hat in diesem Projekt schon einmal einen Fehler verdeckt, der erst beim ersten `next start` sichtbar wurde.

| Mechanismus                | Bedingung                | Wirkung                                                                     |
| -------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| Content-Security-Policy    | `NODE_ENV=production`    | Nonce je Anfrage; `src/proxy.ts`                                              |
| Verbot des Scanner-Stubs   | `NODE_ENV=production`    | `MALWARE_SCANNER=stub` → harter Fehler                                        |
| Gemeinsamer Rate-Limit-Speicher | `NODE_ENV=production` | `rate_limit_windows` statt prozesslokal                                       |
| Service Worker             | Production-Build         | Offline-Rückfall; in `next dev` bewusst nicht registriert                     |

**Die CSP kennt den Objektspeicher.** Fotos und Dokumente lädt der Browser mit einer presignierten URL **direkt** dorthin (ADR-003), also auf eine fremde Origin. `connect-src` wird deshalb aus `S3_ENDPOINT` abgeleitet; ohne gesetzten Endpunkt aus Region und Bucket (AWS). Zwei Folgerungen für den Betrieb:

- Steht vor dem Objektspeicher ein Proxy oder CDN mit **anderer** Adresse als `S3_ENDPOINT`, blockiert der Browser die Uploads. Dann muss die presignierte URL über dieselbe Adresse gehen, unter der der Browser den Speicher erreicht.
- Die Zusicherung dazu steht in `test/e2e/production-csp.spec.ts` (Header) und `test/e2e/document-upload.spec.ts` (echter Upload gegen einen Speicher auf fremder Origin).

---

## 6. Laufender Betrieb

### Health

| Endpunkt            | Zweck                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| `/api/health`       | Liveness. Prüft nichts außer dem Prozess — eine langsame Datenbank darf keinen Neustart auslösen. |
| `/api/health/ready` | Readiness inklusive Datenbank, Objektspeicher und Scanner.                                        |

`/api/health/ready` antwortet bei ausgefallenem clamd mit **HTTP 200 und `status: "degraded"`**, nicht mit 503. Grund: clamd fällt für alle Instanzen gleichzeitig aus, ein 503 nähme die ganze Anwendung aus der Rotation und machte aus „Nachweis-Uploads werden abgelehnt" ein „niemand kann mehr arbeiten". **Alarmiert wird auf `checks.malwareScanner`, nicht auf dem HTTP-Status.** Daneben steht `scannerKind`, damit ein `"ok"` vom Stub nie als „ein Virenscanner läuft" gelesen wird.

### Scheduler für Webhooks

Nur nötig, wenn Webhook-Abonnements genutzt werden:

```
POST /api/v1/integrations/webhooks/dispatch      (Berechtigung integration.manage)
```

Ohne regelmäßigen Aufruf sammeln sich Zustellungen als `PENDING`, ohne dass jemand etwas merkt. Das ist eine Betriebsvoraussetzung, keine Feinheit (ADR-008).

### Betriebsgrenzen, die man kennen sollte

- **Höchstens 10 aktive Geräte je Benutzer.** Keine Komfortgrenze: Rate Limits zählen je Gerät, unbegrenzte Registrierung wäre ein unbegrenztes Kontingent. Gesperrte Geräte zählen nicht mit.
- **ZIP-Export: höchstens 500 Nachweisdateien und 512 MB.** Größere Akten werden abgewiesen, nicht langsam exportiert. docs/09 Ebene 8 beschreibt ein Szenario mit 2000 Fotos, das an dieser Grenze scheitert — der Widerspruch ist bekannt und in notes.md festgehalten.
- **Sitzungsdauer 8 Stunden** (eine Schicht). Gegen ein liegengelassenes Gerät hilft nicht dieser Wert, sondern die Bildschirmsperre des Geräts und die Fernsperre.

---

## 7. Backup und Wiederherstellung

Zwei Speicher, die zueinander konsistent sein müssen: PostgreSQL und der Objektspeicher. Ein Restore, der nur die Datenbank zurückholt, liefert eine Akte, deren Nachweise fehlen — das Manifest weist sie dann als `MISSING` aus, was ehrlich, aber nicht Sinn der Sache ist.

Vorgaben aus docs/01: RPO ≤ 1 h, RTO ≤ 4 h, Aufbewahrung 7 Jahre, wöchentliche Restore-Probe.

**Die Restore-Probe gibt es als Kommando:** `pnpm run test:restore` (docs/09 Ebene 10). Sie füllt eine Quellumgebung mit echten Daten, sichert beide Speicher, sichert in eine **zweite, leere** Umgebung zurück und prüft dann Zeilenzahlen, Dateien, Hashes, Audit-Bezüge und — als eigentlichen Beweis — ob dieselbe Produktionsakte zeichengleich herauskommt. `RESTORE_DRILL_FAULT=missing-file|missing-row` schleust einen Schaden ein; beide Läufe müssen rot enden.

Was sie **nicht** ersetzt: den Lauf gegen das echte Backup-Verfahren dieser Umgebung. Das Skript erzeugt sein Backup selbst und beweist damit, dass die Anwendung aus Dump plus Objekten vollständig wiederherstellbar ist — nicht, dass die nächtliche Sicherung tatsächlich läuft, vollständig ist und lesbar bleibt. Für den wöchentlichen Betriebslauf gehört dieselbe Prüfkette hinter das echte Backup gehängt.

**Eine Erkenntnis daraus gehört in jedes Restore-Handbuch:** `pg_dump` sichert eine Datenbank, **keine Rollen**. Ohne vorab angelegte `proquado_app` (siehe §3.1) scheitert das Einspielen am ersten GRANT.

---

## 8. Dimensionierung

### 8.1 Durchsatz

Gemessen mit `pnpm run test:load` (docs/09 Ebene 8) auf einem Entwicklungsrechner, Postgres im Container:

| Größe                                        | Messwert                            |
| -------------------------------------------- | ------------------------------------- |
| Sync-Durchsatz                               | 57–70 Stapel/s (Prisma 7, zod 4)      |
| 200 Tablets, Schichtwechsel gleichzeitig     | p95 **2,9–3,4 s** — Ziel docs/09 ist < 3 s und wird je nach Maschinenzustand gehalten oder gerissen |
| Akte mit 500 Schritten, PDF                  | 0,2 s                                 |
| Dashboard, 50 gleichzeitig                   | p95 84 ms                             |
| Objektspeicher                               | 10–50 GB/Jahr, fotolastig (docs/01)   |

Der Sync liegt **auf** der Zielgrenze, nicht darunter — dieselbe Konfiguration lieferte in einer Messreihe p95 zwischen 2856 und 3446 ms. Auf einem Entwicklungsrechner ist der Wert damit nicht entscheidbar, und genau deshalb steht die Messung auf der Zielhardware in §9.

Weil alle Geräte einer Schicht gleichzeitig synchronisieren, ist der p95 praktisch die Gesamtdauer: **das 3-Sekunden-Ziel ist bei 200 Geräten arithmetisch ein Durchsatzziel von ≥ 67 Stapel/s.**

### 8.2 Hardware ⚠️ abgeleitet

Die folgenden Größen sind **nicht** auf Zielhardware gemessen, sondern aus dem Lasttest hochgerechnet. Der Aufschlag darin ist Absicht: der Harness ruft die Domänendienste direkt auf, **ohne** HTTP, TLS, Next.js und React-SSR. Der echte Server leistet je Anfrage strikt mehr als das Gemessene; wie viel mehr, sagt erst der Lauf vor Ort.

Gemessener Spitzenverbrauch während des Schichtwechsels von 200 Geräten:

| Komponente                             | Spitze                        |
| -------------------------------------- | ------------------------------- |
| Anwendung (Node)                       | 213–425 % CPU, 741 MB RSS       |
| PostgreSQL                             | 171 % CPU                       |
| clamd (`clamav/clamav:1.4`, Signaturen geladen) | 429 MB RSS im Ruhezustand |

Daraus abgeleitet für einen Piloten mit 200 Tablets, **eine Maschine**:

| Anteil        | vCPU | RAM   |
| ------------- | ---- | ----- |
| Anwendung     | 4    | 4 GB  |
| PostgreSQL    | 2    | 8 GB  |
| clamd         | 1    | 2 GB  |
| Proxy, Rest   | 1    | 2 GB  |
| **Summe**     | **8** | **16 GB** |

Getrennte Maschinen gehen genauso: Anwendung 4 vCPU / 8 GB, Datenbank 4 vCPU / 16 GB. Systemplatte 100 GB; der Objektspeicher wird getrennt gebucht und wächst nach der Zeile in §8.1.

### 8.3 Zwei Eigenschaften, die wichtiger sind als die Kernzahl

**Erstens: x86-64, nicht ARM.** Das in `docker-compose.yml` gepinnte `clamav/clamav:1.4` hat für **keinen** Tag ein arm64-Manifest — ClamAV veröffentlicht ausschließlich amd64. Auf einem Ampere- oder Graviton-Server läuft clamd deshalb nur unter Emulation oder gar nicht, und `MALWARE_SCANNER=stub` lehnt die Anwendung in Produktion hart ab. Ein ARM-Server ist damit keine Sparoption, sondern ein Blocker. Wer ihn trotzdem will, braucht clamd auf einer eigenen x86-Maschine.

**Zweitens: lokale NVMe für die Datenbank, kein netzgebundener Blockspeicher.** Der Outbox-Zähler serialisiert je Organisation (`sync_sequences`, ADR-006 und docs/06): jedes Ereignis ist eine Zeilensperre plus Commit, und ein Schichtwechsel erzeugt gut 1000 Ereignisse. Diese Kette ist **nicht parallelisierbar** — mehr Kerne helfen ihr nicht, die Commit-Latenz bestimmt sie allein. Bei 1 ms kostet sie rund eine Sekunde des Drei-Sekunden-Budgets; bei den 2–5 ms, die günstige Netzvolumes typisch liefern, wäre der Zielwert allein daran gerissen.

Dass der **Schwanz** der Verteilung serialisiert ist, ist gemessen: 15 % weniger Datenbanktransaktionen je Stapel bewegten den p95 nicht, dieselben Geräte auf vier Organisationen verteilt dagegen um 15 %. Dass die Commit-Latenz die Größe dieser Serialisierung bestimmt, ist daraus abgeleitet und gehört zu dem, was die Messung vor Ort beantwortet.

### 8.4 Wenn beschleunigt werden muss

Reihenfolge nach Messung (die vollständige Reihe steht in notes.md unter „welcher Hebel wirklich wirkt"):

1. **`UV_THREADPOOL_SIZE=16`** — eine Umgebungsvariable, 5 %, kein Risiko. Zuerst, weil kostenlos.
2. **Commit-Latenz der Datenbank** — siehe §8.3. Vor jedem Codeeingriff prüfen, worauf die Datenbank schreibt.
3. **Zähler je Produktionsauftrag statt je Organisation** — der einzige gemessene Hebel, der den **p95** bewegt statt nur den Median. Viel Umbau; `src/domain/sync/outbox-sequence.ts` benennt diesen Weg als den vorgesehenen und die Rückkehr zu einer Postgres-Sequenz ausdrücklich als den falschen.

**Nicht** die Poolgröße: zwischen `DATABASE_POOL_MAX=10` und `25` ist kein Unterschied messbar, oberhalb von 25 auch nicht. Der frühere Rat „zuerst die Verbindungsverwaltung" stand hier bis zur Messung und war falsch.

---

## 9. Checkliste vor dem Piloten

- [ ] **x86-64**, nicht ARM — clamd hat kein arm64-Image (§8.3)
- [ ] Datenbank auf **lokaler NVMe**, nicht auf netzgebundenem Blockspeicher (§8.3)
- [ ] Node ≥ 22.13, Datenbank heißt `proquado`
- [ ] `proquado_app` mit eigenem Passwort angelegt, **vor** der ersten Migration
- [ ] Bucket existiert, Versionierung und Verschlüsselung aktiv
- [ ] OIDC-Client mit Redirect- **und** Post-Logout-URIs
- [ ] `MALWARE_SCANNER=clamav`, clamd erreichbar, `/api/health/ready` meldet `scannerKind: "clamav"`
- [ ] `NODE_ENV=production`, TLS am Proxy, Rate-Limit-Speicher auf `postgres`
- [ ] Alle Geheimnisse aus einem Secret-Store, keines aus `.env.example`
- [ ] Seed nach dem Deployment gelaufen
- [ ] Ein Upload aus dem Browser tatsächlich ausgeführt (CSP, presignierte URL, Scan)
- [ ] `DATABASE_POOL_MAX` gesetzt (sonst still 10 Verbindungen — siehe §2.1)
- [ ] `UV_THREADPOOL_SIZE=16` gesetzt (§8.4)
- [ ] Sync-Durchsatz auf der **Zielhardware** gemessen, **mehrfach und verschränkt**, nicht auf einem Entwicklungsrechner (§8.1)
- [ ] Backup für Datenbank **und** Objektspeicher, Restore-Probe **gegen das echte Backup** durchgeführt
- [ ] Scheduler eingerichtet, falls Webhooks genutzt werden
- [ ] Externer Penetrationstest (docs/11 §5 ersetzt ihn ausdrücklich nicht)
