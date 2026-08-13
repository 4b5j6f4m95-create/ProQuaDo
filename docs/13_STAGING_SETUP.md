# 13. Staging aufsetzen

**Dokumentversion:** 1.0
**Status:** Betriebsanleitung (entstanden nach der Implementierung, wie docs/11 und docs/12)
**Gültig ab:** 2026-08-10

Eine durchgehende Schrittfolge für die erste Umgebung, die kein Entwicklungsrechner ist.

**Dieses Dokument ist keine zweite Referenz.** Was eine Variable bedeutet, welche Komponente wofür da ist und warum eine Grenze so hoch liegt, steht in [docs/12](12_DEPLOYMENT.md) und wird hier nicht wiederholt — eine zweite Beschreibung derselben Sache ist eine, die irgendwann abweicht. Hier steht nur, was docs/12 nicht leisten kann: die **Reihenfolge**, und nach jedem Schritt die Probe, an der man merkt, dass er wirklich gewirkt hat.

---

## Warum Staging, und nicht gleich Produktion

Drei Prüfungen vor dem Piloten lassen sich auf keinem Entwicklungsrechner erledigen, und alle drei brauchen dieselbe Umgebung:

1. **Der Sync-Durchsatz auf der Zielhardware.** Der einzige Wert aus dem Lasttest ohne Reserve — p95 3,2–3,7 s gegen ein Ziel von unter 3 s (docs/12 §8).
2. **Die Restore-Probe gegen das echte Backup-Verfahren.** `pnpm run test:restore` beweist, dass die Anwendung aus Dump plus Objekten wiederherstellbar ist. Nicht, dass die nächtliche Sicherung läuft.
3. **Der externe Penetrationstest.** Er braucht ein Ziel, das kein Laptop ist.

Wer die drei zusammenlegt, baut die Umgebung einmal statt dreimal. Das ist der eigentliche Grund für dieses Dokument.

---

## Was hiervon nachgewiesen ist

Dieses Projekt hat einmal eine Betriebsanweisung veröffentlicht, die beim Aufschreiben plausibel und beim Befolgen falsch war (`--force-recreate` für Keycloak, notes.md). Deshalb steht bei jedem Schritt dabei, ob er ausgeführt wurde:

| Kennzeichen           | Bedeutung                                                                     |
| --------------------- | ------------------------------------------------------------------------------- |
| ✅ **ausgeführt**     | genau so gelaufen, mit dem angegebenen Ergebnis                                  |
| ⚠️ **nicht ausgeführt** | aus docs/12 abgeleitet, in einer echten Zielumgebung noch nicht durchgespielt |

Die ✅-Schritte sind gegen eine **eigene Staging-Umgebung** gelaufen, die zu diesem Zweck aufgesetzt wurde: [`infra/staging/docker-compose.staging.yml`](../infra/staging/docker-compose.staging.yml). Sie ist bewusst keine zweite Entwicklungsumgebung — eigener Projektname, eigenes Netz, eigene Ports und Volumes, zwei getrennte Datenbankrollen, `clamd` fest dabei statt optional, Bucket mit Versionierung, und Geheimnisse, die nicht aus `.env.example` stammen.

```bash
cp infra/staging/.env.example infra/staging/.env   # einmalig, dann Werte einsetzen
docker compose -f infra/staging/docker-compose.staging.yml up -d
```

**Der erste Befehl ist keine Bequemlichkeit.** Die drei Passwörter der Umgebung standen bis zum 13.08.2026 fest in der Compose-Datei — in einem öffentlichen Repository, ohne Kennzeichen, dass sie zu ersetzen wären, und die ✅-Schritte unten sind mit genau diesen Werten gelaufen. Jetzt kommen sie aus `infra/staging/.env` (von `.gitignore` erfasst), und die `${VAR:?...}`-Form sorgt dafür, dass `up` mit einer benannten Fehlermeldung **abbricht**, wenn ein Wert fehlt. Es gibt keinen stillen Rückfall mehr auf etwas Veröffentlichtes — was fehlt, fällt beim Hochfahren auf und nicht später.

Wer eine Umgebung weiterbenutzt, die vor dieser Änderung lief, muss die alten Passwörter **aktiv wechseln**. Neue Werte in `.env` genügen für PostgreSQL nicht: `POSTGRES_PASSWORD` wird nur beim ersten Anlegen des Datenverzeichnisses ausgewertet, und `infra/staging/.staging-data/postgres` liegt dann schon.

```bash
docker compose -f infra/staging/docker-compose.staging.yml exec postgres \
  psql -U proquado_owner -d proquado \
  -c "ALTER ROLE proquado_owner PASSWORD '<neuer Wert>'"
```

MinIO und Keycloak übernehmen ihre Werte dagegen bei jedem Start neu.

Was Zielhardware, echten Objektspeicher, einen anderen OIDC-Anbieter als Keycloak oder einen TLS-Proxy voraussetzt, konnte auch dort nicht laufen und bleibt gekennzeichnet.

---

## Schritt 1 — PostgreSQL, und die Rolle **vor** der Migration ✅

Die Datenbank **muss `proquado` heißen** (ein `GRANT CONNECT ON DATABASE` steht so in einer Migration).

Zuerst die Anwendungsrolle mit einem echten Geheimnis anlegen — als schemabesitzende Rolle verbunden:

```sql
CREATE ROLE proquado_app LOGIN PASSWORD '<echtes Geheimnis aus dem Secret-Store>';
```

**Warum diese Reihenfolge nicht verhandelbar ist:** die Migration legt die Rolle nur an, wenn es sie noch nicht gibt — andernfalls mit `PASSWORD 'proquado_app_dev_only'`, einem Wert, der öffentlich im Repository steht.

**Probe (beide Hälften ausgeführt):**

| Vorgehen                                | Anmeldung mit dem Repository-Passwort |
| --------------------------------------- | --------------------------------------- |
| Rolle **vorher** angelegt, dann migriert | abgewiesen — `password authentication failed` |
| direkt migriert                          | **verbunden als `proquado_app`**        |

Der Unterschied ist also real und nicht theoretisch. Nachgemessen wurde von **außerhalb** des Containers über den gemappten Port: innerhalb greift in den offiziellen Postgres-Images `host all all 127.0.0.1/32 trust`, und dann verbindet jedes beliebige Passwort. Eine Probe, die von innen läuft, prüft die Passwörter gar nicht — sie sieht nur so aus.

---

## Schritt 2 — Objektspeicher ✅ (teilweise)

Bucket aus `S3_BUCKET` anlegen, mit Versionierung und serverseitiger Verschlüsselung; die Anwendung erzeugt ihn nicht.

**Versionierung ausgeführt** — der `minio-init`-Dienst der Staging-Compose legt den Bucket an und schaltet sie ein (`mc version enable`), und meldet den Zustand im Protokoll. **Serverseitige Verschlüsselung nicht**: MinIO verlangt dafür einen KMS, und was ein echter Objektspeicher an dieser Stelle bietet, ist Sache der Zielumgebung.

**Die eine Falle, die docs/12 §5 beschreibt und die hier zuschlägt:** der Browser lädt Fotos und Dokumente mit einer presignierten URL **direkt** in den Objektspeicher, und die CSP leitet `connect-src` aus `S3_ENDPOINT` ab. Steht davor ein Proxy oder CDN mit anderer Adresse, blockiert der Browser jeden Upload — bei grünem Server und grünen Tests. Also: die Adresse, unter der der Browser den Speicher erreicht, **ist** die, die in `S3_ENDPOINT` gehört.

Für MinIO zusätzlich `S3_FORCE_PATH_STYLE=true`.

Probe: kommt in Schritt 7, weil sie einen laufenden Server braucht.

---

## Schritt 3 — OIDC-Client ✅ (gegen Keycloak)

Beide Listen pflegen, `redirectUris` **und** `post.logout.redirect.uris`. Fehlt die zweite, scheitert die Abmeldung mit „Invalid redirect uri" — und die Abmeldung ist auf einem geteilten Hallentablet der einzige Weg, den Benutzer zu wechseln.

**Probe, ausgeführt:** `curl <OIDC_ISSUER>/.well-known/openid-configuration` muss ein JSON mit `end_session_endpoint` liefern — in der Staging-Umgebung tut es das (`…/protocol/openid-connect/logout`).

**Der Fehler, der beim Aufsetzen die meiste Zeit gekostet hat, sitzt ebenfalls hier:** ein falsches `OIDC_CLIENT_SECRET`. Die Anmeldung führt dann durch Keycloak hindurch und kommt **nicht** zurück; im Browser passiert sichtbar nichts, und der Grund steht ausschließlich im Serverprotokoll:

```
[auth][cause]: server responded with an error in the response body
[auth][details]: { "error": "unauthorized_client",
                   "error_description": "Invalid client or Invalid client credentials" }
```

Wer eine Umgebung aufsetzt, sollte das Geheimnis deshalb aus der Konfiguration des Anbieters **kopieren**, nicht aus dem Gedächtnis schreiben — und beim ersten fehlgeschlagenen Login zuerst ins Serverprotokoll sehen, nicht in den Browser.

Dabei fiel außerdem auf, was ein neuer Port an dieser Stelle kostet: **beide** Listen brauchen ihn. Die Realm-Datei führt jetzt neben 3000 und 3002 auch 3003, in `redirectUris` **und** in `post.logout.redirect.uris`. Die Anwendung ermittelt den Endpunkt darüber, statt ihn zu bilden (ADR-001); fehlt er in der Discovery, funktioniert die Abmeldung nicht, egal was am Client eingetragen ist.

---

## Schritt 4 — clamd ✅

Über TCP erreichbar machen, `MALWARE_SCANNER=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT` setzen. Der Stub wird bei `NODE_ENV=production` mit hartem Fehler abgelehnt.

**Auf den Containerstatus ist kein Verlass** — clamd nimmt Verbindungen an, bevor seine Signaturen geladen sind. Verlässlich ist erst die Probe aus Schritt 7.

Ausgeführt: der Container brauchte **30 Sekunden bis `healthy`**, mit bereits vorhandenen Signaturen (das Volume ist mit der Entwicklungsumgebung geteilt). Beim allerersten Start sind es Minuten und ~250 MB Download; wer den Startvorgang einer Umgebung terminiert, sollte damit rechnen.

---

## Schritt 5 — Geheimnisse ✅

Alle aus einem Secret-Store, keines aus `.env.example`. Zwei Werte werden gern verwechselt:

- `AUTH_SECRET` signiert die Sitzung.
- `RELEASE_TOKEN_SECRET` ist der HMAC-Schlüssel der Release Tokens (docs/06) und muss **ein eigener Wert** sein.

Beide erzeugt `openssl rand -base64 32`. Ausgeführt und nachgesehen: die beiden Werte sind verschieden und stehen in keiner `.env.example`.

**Ein Fund dabei, der jede Umgebung betrifft, die ihre Konfiguration in eine Datei schreibt:** `.gitignore` deckte `.env.staging` **nicht** ab. Dort standen `.env` (ein exakter Treffer) und `.env*.local` (verlangt die Endung) — eine frisch erzeugte `.env.staging` samt beider Geheimnisse wäre also eingecheckt worden. Korrigiert zu `.env.*`; nachgeprüft mit `git check-ignore`, und `.env.example` bleibt verfolgt. Wer eine Umgebungsdatei anlegt, sollte das **vor** dem ersten `git add` prüfen:

```bash
git check-ignore -v .env.<name>
```

Dazu `DATABASE_POOL_MAX` **ausdrücklich setzen**: ohne die Variable nimmt der Treiber-Adapter zehn Verbindungen, und `connection_limit` in der URL wirkt seit Prisma 7 nicht mehr. Der Lasttest weist die Verbindungszahl als härteste Grenze des Sync aus — das ist kein Feinschliff.

---

## Schritt 6 — Ausrollen ✅ (teilweise)

```bash
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm exec prisma migrate deploy       # DIRECT_DATABASE_URL
pnpm exec prisma db seed              # Rollen und Berechtigungsatome
pnpm run build
pnpm run start
```

Vollständig gegen die Staging-Umgebung gelaufen: alle 20 Migrationen angewendet, Seed durch, `build` und `start` mit `NODE_ENV=production` auf Port 3003. Nicht auf Zielhardware — das bleibt Schritt 8.

**Der Seed ist kein einmaliger Schritt.** Neue Berechtigungsatome gelangen nur über einen erneuten Lauf in bestehende Organisationen; er ist idempotent und darf jederzeit wieder laufen. Wer ein Release einspielt, das ein Atom ergänzt hat, und den Seed auslässt, bekommt `PERMISSION_DENIED` für Rechte, die im Code längst vergeben sind.

**Probe, dass die Mandantentrennung greift** (ausgeführt): mit der Anwendungsrolle verbinden und ohne gesetzten Organisationskontext lesen —

```sql
SELECT count(*) FROM users;         -- erwartet: 0
SELECT count(*) FROM organizations; -- erwartet: 0
```

Null, nicht ein Fehler. Genau das ist RLS (ADR-006): die Rolle darf fragen und bekommt nichts zu sehen. Kommt hier eine Zahl größer null, läuft die Anwendung mit der falschen Rolle.

---

## Schritt 7 — Rauchtest gegen das, was nur in Produktion greift ✅

Vier Mechanismen sind in der Entwicklung abgeschaltet, und jeder hat in diesem Projekt schon einmal einen Fehler verdeckt. Alle vier einzeln **benutzen**, nicht nur starten:

| Prüfung          | Vorgehen                                                             | Ergebnis in dieser Umgebung                                       |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Readiness ✅     | `GET /api/health/ready`                                              | `status: "ready"`, **`scannerKind: "clamav"`** — nicht `"stub"`   |
| CSP und Nonce ✅ | eine Seite laden, Header und HTML **derselben** Antwort vergleichen  | alle **12** `<script>`-Tags tragen die Nonce des Headers            |
| Abgeleitete Adressen ✅ | `connect-src` und `form-action` im Header ansehen              | `connect-src 'self' http://localhost:9020`, `form-action 'self' http://localhost:8091` — die **Staging**-Adressen, nicht die der Entwicklung |
| Upload ✅        | ein Dokument aus dem **Browser** hochladen                           | presignierter `PUT` auf `http://localhost:9020` → **HTTP 200**, keine CSP-Meldung in der Konsole, und der Server hat die Datei **anerkannt** (Hashvergleich plus echter Virenscan) |
| Offline-Rückfall ✅ | `/offline` laden, Netz trennen, neu laden                         | Worker `activated`, 12 Einträge im Cache, `transferSize: 0` ohne Verbindung, Navigation landet im Offline-Arbeitsbereich, `/api/**` bleibt unerreichbar |

Zur CSP-Probe: die Nonce wird **je Anfrage** neu gezogen. Zwei getrennte `curl`-Aufrufe vergleichen deshalb zwei verschiedene Nonces und schlagen immer fehl — Header und Körper müssen aus einem Aufruf stammen.

**Der Upload kann hier mehr als in der Prüfkette.** `document-upload.spec.ts` bricht bewusst nach dem `PUT` ab: der E2E-Lauf fährt gegen einen Production-Build, und dort wird `MALWARE_SCANNER=stub` mit hartem Fehler abgelehnt — die Anerkennung der Datei ist dort also gar nicht prüfbar. In Staging läuft echtes clamd, und deshalb geht der Weg bis zum Ende: Hashvergleich, Scan, Revision mit Dateiangabe. Die Datei liegt danach im **versionierten** Bucket.

Beide Zeilen brauchten eine angemeldete Sitzung. Die gespeicherten Anmeldungen der E2E-Suite gelten hier nicht — Staging hat ein eigenes `AUTH_SECRET` —, also lief die Anmeldung über denselben automatisierten Weg wie in `auth.setup.ts`, nur gegen Port 3003 und Keycloak auf 8091.

Was die dritte Zeile davon vorwegnimmt: die **Adressen stimmen**. Genau daran ist der Upload in Phase 7 gescheitert — nicht am Speicher, sondern daran, dass die CSP eine andere Origin kannte als der Browser ansprach. Alle drei sind zugleich E2E-Tests (`production-csp`, `document-upload`, `offline-shell`) und gegen den lokalen Production-Build grün; was Staging hinzufügt, sind die echten Adressen, der echte Speicher, der echte Scanner.

---

## Schritt 8 — Die drei Messungen, für die Staging existiert ⚠️

**Sync-Durchsatz.** `pnpm run test:load` auf der Zielhardware. Der Harness ruft die Domänendienste direkt auf, misst also die Arbeit des Servers ohne HTTP und Netzweg. Bleibt p95 über 3 s, steht die Reihenfolge der Hebel in [docs/12 §8.4](12_DEPLOYMENT.md#84-wenn-beschleunigt-werden-muss): zuerst `UV_THREADPOOL_SIZE=16`, dann die Commit-Latenz der Datenbank, dann ein feinerer Outbox-Zähler. **Nicht** die Verbindungsverwaltung — der Rat stand hier bis zur Messung und ist widerlegt: zwischen `DATABASE_POOL_MAX=10` und `25` ist kein Unterschied messbar.

**Und messt mehrfach und verschränkt, nicht einmal.** Derselbe Lauf schwankt auf einer beschäftigten Maschine zwischen p95 2856 und 3446 ms — beidseits der Zielmarke. Wer eine Konfiguration blockweise gegen eine andere stellt, vergleicht die Tagesform der Maschine (notes.md, „Blockweise verglichene Konfigurationen messen die Maschine").

Der Lauf hinterlässt Daten: je Durchgang ein Projekt `LOAD-P-…` mit bis zu 200 Aufträgen, ebenso vielen Geräten und einer Akte mit 500 Schritten und 2000 Fotos. In Staging ist das unproblematisch — in einer Umgebung, die später produktiv wird, ist es das nicht.

**Restore-Probe.** Erst `pnpm run test:restore` (prüft sich selbst, inklusive der beiden Fehlerfälle über `RESTORE_DRILL_FAULT`), dann dieselbe Prüfkette hinter das **echte** Backup dieser Umgebung hängen. Nur der zweite Lauf beantwortet die Frage, die am Tag des Ausfalls zählt. Nicht vergessen: `pg_dump` sichert keine Rollen — ohne vorab angelegte `proquado_app` scheitert das Einspielen am ersten GRANT (Schritt 1).

**Penetrationstest.** docs/11 §5 sagt ausdrücklich, dass die eigene Überprüfung der Offline-Invariante ihn nicht ersetzt.

---

## Was Staging nicht beweist

- **Nicht, dass die Software bedienbar ist.** Handschuhe, Hallenlicht, WLAN-Löcher und ein Tablet, das eine Schicht lang durchhält, zeigt nur der Pilot (docs/10 Phase 7).
- **Nicht, dass das Backup läuft.** Nur, dass ein Backup wiederherstellbar wäre. Der Unterschied ist Schritt 8.
- **Nicht, dass die Konfiguration in Produktion dieselbe ist.** Jede Abweichung zwischen Staging und Produktion ist eine ungeprüfte Annahme — am ehesten bei den Adressen, an denen die CSP hängt.

---

## Checkliste

Die verbindliche Liste steht in [docs/12 §9](12_DEPLOYMENT.md#9-checkliste-vor-dem-piloten) und wird hier nicht kopiert. Diese Anleitung ist ihre Reihenfolge; die Checkliste bleibt die Quelle.

**Wer diese Anleitung befolgt, sollte die ⚠️-Kennzeichen danach ersetzen** — durch ✅ und die Probe, die tatsächlich gelaufen ist, oder durch die Korrektur dessen, was hier falsch stand. Eine Anweisung, die niemand ausgeführt hat, ist eine Vermutung mit Befehlszeile.
