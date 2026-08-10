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
| clamd (ClamAV)                 | über TCP erreichbar             | Pflicht: `MALWARE_SCANNER=stub` wird in Produktion mit hartem Fehler abgelehnt.                          |
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
| `RATE_LIMIT_STORE`              | `postgres` (in Produktion)    | So lassen. `memory` zählt je Prozess und vervielfacht hinter N Repliken jedes Limit.    |
| `CLAMAV_TIMEOUT_MS`             | `30000`                       |                                                                                         |
| `LOG_LEVEL`                     | `info`                        |                                                                                         |
| `SERVER_NODE_ID`                | —                             | Je Instanz unterschiedlich setzen; steht im Audit-Trail.                                |
| `ALLOW_PRIVATE_WEBHOOK_TARGETS` | —                             | Nur Entwicklung. In Produktion bedingungslos ignoriert.                                 |

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
pnpm exec tsx prisma/seed.ts          # legt Rollen und Berechtigungsatome an
pnpm run build
pnpm run start                        # oder über einen Prozessmanager
```

**Der Seed ist kein einmaliger Schritt.** Neue Berechtigungsatome gelangen ausschließlich über einen erneuten Lauf in bestehende Organisationen — nichts im Deployment-Pfad ruft `seedOrganizationRbac` automatisch auf. Wer ein Release einspielt, das ein Atom ergänzt hat, und den Seed auslässt, bekommt `PERMISSION_DENIED` für Rechte, die im Code längst vergeben sind. Der Seed ist idempotent und darf jederzeit erneut laufen.

---

## 5. Was nur in Produktion greift

Diese Mechanismen sind in der Entwicklung abgeschaltet. Jeder von ihnen hat in diesem Projekt schon einmal einen Fehler verdeckt, der erst beim ersten `next start` sichtbar wurde.

| Mechanismus                | Bedingung                | Wirkung                                                                     |
| -------------------------- | ------------------------ | ----------------------------------------------------------------------------- |
| Content-Security-Policy    | `NODE_ENV=production`    | Nonce je Anfrage; `src/middleware.ts`                                         |
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

**Die Restore-Probe (docs/09 Ebene 10) ist noch nicht umgesetzt.** Sie ist der letzte offene Punkt aus Gate (c) vor dem Piloten. Was sie leisten muss: Restore in eine isolierte Umgebung, Prüfung der referenziellen Integrität (Audit ↔ Dateien ↔ Datenbank) und ein Vergleich einer Produktionsakte vor und nach dem Restore.

---

## 8. Dimensionierung

Gemessen mit `pnpm run test:load` (docs/09 Ebene 8) auf einem Entwicklungsrechner, Postgres im Container:

| Größe                                        | Messwert                            |
| -------------------------------------------- | ------------------------------------- |
| Sync-Durchsatz                               | ~64 Stapel/s, ~255 Kommandos/s        |
| 200 Tablets, Schichtwechsel gleichzeitig     | p95 ~3,0 s (Ziel docs/09: < 3 s)      |
| Akte mit 500 Schritten, PDF                  | 0,2 s                                 |
| Dashboard, 50 gleichzeitig                   | p95 84 ms                             |
| Speicherbedarf                               | 10–50 GB/Jahr, fotolastig (docs/01)   |

Der Sync liegt **auf** der Zielgrenze, nicht darunter. Vor einem Piloten mit 200 Geräten gehört diese Messung auf die Zielhardware wiederholt. Wenn beschleunigt werden muss: **zuerst die Verbindungsverwaltung** (pgbouncer, `max_connections`, Poolgröße). Die naheliegende Vermutung, die Outbox-Serialisierung je Organisation sei der Engpass, ist gemessen und bringt aufgeteilt nur ein Drittel — die Verbindungen sind die härtere Wand.

---

## 9. Checkliste vor dem Piloten

- [ ] Node ≥ 22.13, Datenbank heißt `proquado`
- [ ] `proquado_app` mit eigenem Passwort angelegt, **vor** der ersten Migration
- [ ] Bucket existiert, Versionierung und Verschlüsselung aktiv
- [ ] OIDC-Client mit Redirect- **und** Post-Logout-URIs
- [ ] `MALWARE_SCANNER=clamav`, clamd erreichbar, `/api/health/ready` meldet `scannerKind: "clamav"`
- [ ] `NODE_ENV=production`, TLS am Proxy, Rate-Limit-Speicher auf `postgres`
- [ ] Alle Geheimnisse aus einem Secret-Store, keines aus `.env.example`
- [ ] Seed nach dem Deployment gelaufen
- [ ] Ein Upload aus dem Browser tatsächlich ausgeführt (CSP, presignierte URL, Scan)
- [ ] Backup für Datenbank **und** Objektspeicher, Restore-Probe durchgeführt
- [ ] Scheduler eingerichtet, falls Webhooks genutzt werden
- [ ] Externer Penetrationstest (docs/11 §5 ersetzt ihn ausdrücklich nicht)
