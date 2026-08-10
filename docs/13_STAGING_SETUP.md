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

Die ✅-Schritte liefen gegen zwei Wegwerf-Container (PostgreSQL 16) und gegen den lokalen Production-Build. Was Zielhardware, echten Objektspeicher, einen anderen OIDC-Anbieter als Keycloak oder einen TLS-Proxy voraussetzt, konnte hier nicht laufen und ist entsprechend gekennzeichnet.

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

## Schritt 2 — Objektspeicher ⚠️

Bucket aus `S3_BUCKET` anlegen, mit Versionierung und serverseitiger Verschlüsselung; die Anwendung erzeugt ihn nicht.

**Die eine Falle, die docs/12 §5 beschreibt und die hier zuschlägt:** der Browser lädt Fotos und Dokumente mit einer presignierten URL **direkt** in den Objektspeicher, und die CSP leitet `connect-src` aus `S3_ENDPOINT` ab. Steht davor ein Proxy oder CDN mit anderer Adresse, blockiert der Browser jeden Upload — bei grünem Server und grünen Tests. Also: die Adresse, unter der der Browser den Speicher erreicht, **ist** die, die in `S3_ENDPOINT` gehört.

Für MinIO zusätzlich `S3_FORCE_PATH_STYLE=true`.

Probe: kommt in Schritt 7, weil sie einen laufenden Server braucht.

---

## Schritt 3 — OIDC-Client ⚠️

Beide Listen pflegen, `redirectUris` **und** `post.logout.redirect.uris`. Fehlt die zweite, scheitert die Abmeldung mit „Invalid redirect uri" — und die Abmeldung ist auf einem geteilten Hallentablet der einzige Weg, den Benutzer zu wechseln.

Probe: `curl <OIDC_ISSUER>/.well-known/openid-configuration` muss ein JSON mit `end_session_endpoint` liefern. Die Anwendung ermittelt den Endpunkt darüber, statt ihn zu bilden (ADR-001); fehlt er in der Discovery, funktioniert die Abmeldung nicht, egal was am Client eingetragen ist.

---

## Schritt 4 — clamd ⚠️

Über TCP erreichbar machen, `MALWARE_SCANNER=clamav`, `CLAMAV_HOST`, `CLAMAV_PORT` setzen. Der Stub wird bei `NODE_ENV=production` mit hartem Fehler abgelehnt.

**Auf den Containerstatus ist kein Verlass** — clamd nimmt Verbindungen an, bevor seine Signaturen geladen sind. Verlässlich ist erst die Probe aus Schritt 7.

---

## Schritt 5 — Geheimnisse ⚠️

Alle aus einem Secret-Store, keines aus `.env.example`. Zwei Werte werden gern verwechselt:

- `AUTH_SECRET` signiert die Sitzung.
- `RELEASE_TOKEN_SECRET` ist der HMAC-Schlüssel der Release Tokens (docs/06) und muss **ein eigener Wert** sein.

Beide erzeugt `openssl rand -base64 32`.

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

`migrate deploy` und der Seed sind gegen eine frische Datenbank gelaufen: alle Migrationen angewendet, fünf Demo-Konten und das Demo-Projekt angelegt. `build` und `start` liefen lokal, nicht auf Zielhardware.

**Der Seed ist kein einmaliger Schritt.** Neue Berechtigungsatome gelangen nur über einen erneuten Lauf in bestehende Organisationen; er ist idempotent und darf jederzeit wieder laufen. Wer ein Release einspielt, das ein Atom ergänzt hat, und den Seed auslässt, bekommt `PERMISSION_DENIED` für Rechte, die im Code längst vergeben sind.

**Probe, dass die Mandantentrennung greift** (ausgeführt): mit der Anwendungsrolle verbinden und ohne gesetzten Organisationskontext lesen —

```sql
SELECT count(*) FROM users;         -- erwartet: 0
SELECT count(*) FROM organizations; -- erwartet: 0
```

Null, nicht ein Fehler. Genau das ist RLS (ADR-006): die Rolle darf fragen und bekommt nichts zu sehen. Kommt hier eine Zahl größer null, läuft die Anwendung mit der falschen Rolle.

---

## Schritt 7 — Rauchtest gegen das, was nur in Produktion greift ⚠️ (Verfahren lokal erprobt)

Vier Mechanismen sind in der Entwicklung abgeschaltet, und jeder hat in diesem Projekt schon einmal einen Fehler verdeckt. Alle vier einzeln **benutzen**, nicht nur starten:

| Prüfung          | Vorgehen                                                             | Erwartung                                                        |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Readiness        | `GET /api/health/ready`                                              | `status: "ready"`, **`scannerKind: "clamav"`** — nicht `"stub"`   |
| CSP und Nonce    | eine Seite laden, Header und HTML **derselben** Antwort vergleichen  | die Nonce aus `Content-Security-Policy` steht an den `<script>`-Tags |
| Upload           | ein Dokument aus dem **Browser** hochladen                           | landet im Objektspeicher; keine `connect-src`-Meldung in der Konsole |
| Offline-Rückfall | `/offline` laden, Netz trennen, neu laden                            | Seite rendert aus dem Cache, Navigation landet im Offline-Bereich   |

Zur CSP-Probe: die Nonce wird **je Anfrage** neu gezogen. Zwei getrennte `curl`-Aufrufe vergleichen deshalb zwei verschiedene Nonces und schlagen immer fehl — Header und Körper müssen aus einem Aufruf stammen.

Die letzten drei sind zugleich E2E-Tests (`production-csp`, `document-upload`, `offline-shell`) und dort gegen den lokalen Production-Build grün. In der Zielumgebung geht es um das, was die Tests nicht kennen: die echten Adressen, den echten Speicher, den echten Scanner.

---

## Schritt 8 — Die drei Messungen, für die Staging existiert ⚠️

**Sync-Durchsatz.** `pnpm run test:load` auf der Zielhardware. Der Harness ruft die Domänendienste direkt auf, misst also die Arbeit des Servers ohne HTTP und Netzweg. Bleibt p95 über 3 s: **zuerst an der Verbindungsverwaltung** arbeiten (pgbouncer, `max_connections`, `DATABASE_POOL_MAX`), erst danach an feinerer Sequenzierung. Die umgekehrte Reihenfolge ist gemessen und bringt ein Drittel.

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
