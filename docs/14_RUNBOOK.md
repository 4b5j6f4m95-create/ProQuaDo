# 14. Betriebs-Runbook

**Dokumentversion:** 1.0
**Status:** Betriebsanleitung (entstanden nach der Implementierung, wie docs/11–13)
**Gültig ab:** 2026-08-10

Was im laufenden Betrieb regelmäßig zu tun ist, worauf alarmiert wird, und was bei den Störungen zu tun ist, die dieses System kennt.

**Abgrenzung:** [docs/12](12_DEPLOYMENT.md) ist die Referenz (was ein Server braucht), [docs/13](13_STAGING_SETUP.md) die einmalige Aufsetzfolge. Hier steht, was **danach** wiederkehrt. Grenzwerte und Begründungen werden nicht wiederholt, sondern verlinkt.

**Kennzeichnung wie in docs/13:** ✅ ausgeführt und mit dem angegebenen Ergebnis nachgemessen · ⚠️ aus dem Code oder docs/12 abgeleitet, in einer Zielumgebung noch nicht durchgespielt.

---

## 1. Wiederkehrende Aufgaben

| Takt                  | Aufgabe                          | Warum sie nicht entfallen darf                                                     |
| --------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| **nach jedem Release** | Seed laufen lassen               | Der einzige Weg, neue Berechtigungsatome in bestehende Organisationen zu bringen      |
| **wöchentlich**        | Restore-Probe                    | docs/01. Eine Wiederherstellung, die nie geprobt wurde, ist eine Vermutung             |
| **alle 5–15 min**      | Webhook-Dispatch (nur falls genutzt) | Ohne Scheduler stapeln sich Zustellungen als `PENDING`, ohne dass jemand etwas merkt |
| **monatlich**          | Dependabot-PRs durchsehen        | Sicherheitswarnungen kommen unabhängig davon sofort                                    |

### 1.1 Seed nach jedem Release ✅

```bash
pnpm exec prisma db seed
```

**Nicht `pnpm exec tsx prisma/seed.ts`, wenn die Konfiguration in einer `.env` steht.** `prisma/seed.ts` liest `process.env.DIRECT_DATABASE_URL` unmittelbar und lädt selbst kein dotenv; geladen wird es von `prisma.config.ts`, und das sieht nur die Prisma-CLI. Stehen die Variablen bereits in der Prozessumgebung — der Normalfall in einer Deployment-Pipeline —, funktionieren beide Formen. Steht die Konfiguration in einer Datei, scheitert die erste mit einer Meldung, die nach einem Datenbankproblem aussieht und keines ist:

```
Error: SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string
```

Beide Formen nachgestellt: die dokumentierte scheitert, `prisma db seed` läuft durch. `pnpm exec prisma db seed` ist deshalb die robustere Anweisung — sie funktioniert in beiden Fällen.

**Idempotenz nachgemessen:** nach mehrfachem Lauf ein Demo-Projekt, keine doppelten Benutzer. Der Seed darf jederzeit erneut laufen.

**Woran man merkt, dass er gefehlt hat:** die Anwendung antwortet mit `PERMISSION_DENIED` für ein Recht, das im Code längst vergeben ist. Siehe §3.2.

### 1.2 Wöchentliche Restore-Probe ⚠️

```bash
pnpm run test:restore
```

Prüft sich selbst mit; `RESTORE_DRILL_FAULT=missing-file` und `missing-row` müssen **rot** enden. Für den Betriebslauf gilt aber der Zusatz aus docs/12 §7: dieselbe Prüfkette gehört hinter das **echte** Backup dieser Umgebung. Das Skript erzeugt sein Backup selbst und beweist damit nur, dass aus Dump plus Objekten ein arbeitsfähiges System entsteht — nicht, dass die nächtliche Sicherung läuft und lesbar ist.

Zwei Speicher müssen zueinander konsistent sein: PostgreSQL **und** der Objektspeicher. Ein Restore, der nur die Datenbank zurückholt, liefert eine Akte, deren Nachweise im Manifest als `MISSING` stehen — ehrlich, aber nicht Sinn der Sache.

`pg_dump` sichert **keine Rollen**. Ohne vorab angelegte `proquado_app` scheitert das Einspielen am ersten GRANT (docs/13 Schritt 1).

### 1.3 Webhook-Dispatch ⚠️

```
POST /api/v1/integrations/webhooks/dispatch      (Berechtigung integration.manage)
```

Nur nötig, wenn Abonnements bestehen. Ohne regelmäßigen Aufruf wird nichts zugestellt — das ist eine Betriebsvoraussetzung, keine Feinheit (ADR-008).

---

## 2. Alarmierung

### Worauf ✅

| Signal                                        | Bedeutung                                    |
| --------------------------------------------- | ---------------------------------------------- |
| `/api/health/ready` → `checks.database`       | nicht `ok` ⇒ die Anwendung kann nichts        |
| `/api/health/ready` → `checks.malwareScanner` | nicht `ok` ⇒ **jeder Nachweis-Upload wird abgelehnt** |
| `/api/health/ready` → `scannerKind`           | `"stub"` in Produktion ⇒ Fehlkonfiguration     |

### Worauf **nicht** ✅

**Nicht auf den HTTP-Status von `/api/health/ready`.** Bei totem clamd antwortet der Endpunkt mit **HTTP 200** und `status: "degraded"` — nachgemessen:

```json
{
  "status": "degraded",
  "checks": { "database": "ok", "malwareScanner": "unreachable", "scannerKind": "clamav" },
  "uploadsBlocked": true,
  "detail": "clamd unter … antwortet nicht — Nachweis-Uploads werden abgelehnt."
}
```

Das ist Absicht: clamd fällt für alle Instanzen gleichzeitig aus. Ein 503 nähme die ganze Anwendung aus der Rotation und machte aus „Nachweis-Uploads werden abgelehnt" ein „niemand kann mehr arbeiten". Wer auf dem HTTP-Status alarmiert, **sieht diesen Ausfall nie**.

`/api/health` ist reine Liveness und prüft nichts außer dem Prozess — eine langsame Datenbank darf keinen Neustart auslösen. Ebenfalls nachgemessen: bei totem clamd weiterhin HTTP 200.

---

## 3. Störungen

### 3.1 Uploads werden abgelehnt, sonst läuft alles ✅

**Symptom:** Mitarbeiter können Fotos und Dokumente nicht hochladen; `/api/health/ready` meldet `degraded` mit `uploadsBlocked: true`.

**Ursache:** clamd nicht erreichbar. Der Scan schließt bei Ausfall (`ERROR` statt `CLEAN`), und Aufrufer akzeptieren nur `CLEAN` — ein Ausfall blockiert Uploads, statt sie durchzuwinken.

**Vorgehen:** clamd wiederherstellen. Die Anwendung **nicht** neu starten und **nicht** aus der Rotation nehmen — alles außer Nachweis-Uploads funktioniert weiter, und Arbeit, die offline erfasst wurde, bleibt in der Warteschlange des Geräts erhalten.

**Was nicht getan wird:** `MALWARE_SCANNER=stub` setzen. In Produktion wird das mit hartem Fehler abgelehnt, und das ist die Absicht — ein Scanner, der jede Datei durchwinkt, ist schlechter als keine Uploads.

### 3.2 `PERMISSION_DENIED` für ein Recht, das es geben müsste ✅

**Symptom:** Eine Rolle darf etwas nicht, obwohl die Berechtigungsmatrix es vorsieht — typischerweise direkt nach einem Release.

**Ursache:** Der Seed lief nicht. Neue Berechtigungsatome kommen ausschließlich über `seedOrganizationRbac` in bestehende Organisationen, und nichts im Deployment-Pfad ruft das automatisch auf.

**Vorgehen:** `pnpm exec prisma db seed` (siehe §1.1). Idempotent, gefahrlos wiederholbar.

### 3.3 „Access Denied" bei der Anmeldung ⚠️

**Symptom:** Der Bildschirm zeigt „Access Denied — You do not have permission to sign in." Im Log steht `Login denied: no matching user record`.

**Ursache:** Die `external_id` des Kontos zeigt auf ein OIDC-Subject, das es nicht mehr gibt — etwa nach einem Neuaufbau des Identitätsanbieters. Es ist **keine** Berechtigungsfrage, obwohl die Meldung danach aussieht.

**Vorgehen:** Die betroffenen Konten auf den Einladungszustand zurücksetzen; sie binden sich beim nächsten Login neu, ohne Datenverlust:

```sql
UPDATE users SET external_id = 'pending:' || email WHERE external_id NOT LIKE 'pending:%';
```

Vorher mit `SELECT email, external_id FROM users;` eingrenzen, welche Konten wirklich betroffen sind — die Anweisung oben trifft sonst alle.

### 3.4 Verlorenes oder gestohlenes Tablet ⚠️

**Vorgehen:** Gerät fernsperren.

```
POST /api/v1/devices/{id}/revoke      (Berechtigung device.manage, Rolle ADMIN)
```

Danach weist der Server jede Aktion dieses Geräts ab — auch außerhalb des Sync-Pfads, seit `resolveDeviceId` die Geräteidentität überall nachschlägt statt sie zu glauben.

**Was das nicht leistet:** bereits offline erfasste, noch nicht übertragene Arbeit auf dem Gerät bleibt dort. Die verschlüsselte lokale Ablage schützt sie; die Bildschirmsperre des Geräts ist die zweite Linie. Gegen ein liegengelassenes Gerät hilft nicht die Sitzungsdauer (8 Stunden, eine Schicht), sondern diese beiden.

**Gesperrte Geräte zählen nicht gegen die Obergrenze** von 10 aktiven Geräten je Benutzer — der Ersatz scheitert also nie an ihr.

### 3.5 „Bereits 10 Geräte registriert" ⚠️

**Ursache:** `MAX_ACTIVE_DEVICES_PER_USER` ist erreicht.

**Vorgehen:** Alte Geräte sperren (§3.4), **nicht** die Grenze anheben. Sie ist keine Komfortgrenze: Rate Limits zählen je Gerät, unbegrenzte Registrierung wäre ein unbegrenztes Kontingent — und ein Sync-Stapel löst bis zu 500 vollständige serverseitige Neuvalidierungen aus.

### 3.6 Bestätigung gesperrt (HTTP 423 `CONFIRMATION_LOCKED`) ⚠️

**Symptom:** Ein Mitarbeiter kann nichts mehr mit PIN bestätigen; auch die richtige PIN wird abgewiesen.

**Ursache:** Fünf aufeinanderfolgende Fehlversuche. Die Sperre beginnt bei einer Minute und verdoppelt sich bis höchstens 15 Minuten; ein Erfolg setzt den Zähler zurück.

**Vorgehen: warten.** Die Sperre löst sich selbst.

**Was der Support nicht tun kann und nicht tun soll:** sie aufheben. Geprüft wird gegen den authentifizierten Actor — niemand kann jemand anderen aussperren, und niemand muss jemanden befreien. Eine Sperre, die Administration braucht, wird an der Maschine durch geteilte PINs umgangen, und damit wäre genau die Zurechenbarkeit weg, für die die PIN existiert (ADR-005).

**Wer seine PIN vergessen hat, kommt derzeit nicht weiter — das ist eine bekannte Lücke.** Unter **Mein Konto** lässt sich die PIN setzen und ändern, aber das Ändern verlangt die bisherige. Ein Konto, dessen Inhaber die PIN nicht mehr kennt, ist damit ohne Eingriff in die Datenbank arbeitsunfähig.

Der vorgesehene Weg ist nicht, dass die Administration eine neue PIN vergibt — dann kennt sie jemand anderes, und die Zurechnung im Audit-Trail trägt nicht mehr. Vorgesehen ist, dass die Administration die hinterlegte PIN **löscht**, ohne je eine zu kennen; das Konto steht danach wie ein frisches da und der Inhaber setzt seine eigene neu. Diese Funktion fehlt noch und kommt mit der Benutzerverwaltung (siehe Übergabe in `notes.md`). Bis dahin: `confirmation_pin_hash` auf `NULL` setzen, mit derselben Sorgfalt wie jeder andere direkte Eingriff.

### 3.7 Konflikte stauen sich im Konfliktcenter ⚠️

**Symptom:** Unter **Konflikte** sammeln sich offene Einträge.

**Ursache:** Normalbetrieb. Konflikte entstehen, wenn offline erfasste Arbeit auf einen veränderten Serverstand trifft — sieben Typen, alle in docs/06 beschrieben.

**Vorgehen:** Entscheiden lassen, nicht auflösen. Zuständig sind PROJECT_LEAD und QUALITY_MANAGER (`sync_conflict.decide`), jede Entscheidung mit PIN und Begründung. **Nichts davon darf im Betrieb per SQL „aufgeräumt" werden** — die Entscheidung ist der Nachweis, und ein stillschweigend entfernter Konflikt ist offline erfasste Arbeit, die niemand mehr beurteilt hat.

Ein Sonderfall lohnt die Kenntnis: nach einem Rechteentzug wird offline erfasste Arbeit **nicht** automatisch freigegeben, und ein stellvertretendes Durchwinken gibt es dafür bewusst nicht (`ACCEPT_AS_VALID` fehlt bei `PERMISSION_REVOKED`). Möglich sind Zusatzprüfung oder Verwerfen der Abschlussmeldung; die erfassten Nachweise bleiben in beiden Fällen erhalten.

### 3.8 Export wird abgewiesen ⚠️

**Ursache:** Die Akte überschreitet 500 Nachweisdateien oder 512 MB (ADR-007).

**Vorgehen:** Nicht die Grenze anheben. Sie ist die ehrlichere Antwort als ein 60-Sekunden-Request, der einen Server blockiert. Wenn ein realer Auftrag diese Größe erreicht, ist die offene Entscheidung aus ADR-007 fällig: asynchrone Erzeugung. Das ist eine Änderung, kein Betriebsgriff.

Nebenbei: Exporte sind auf **5 je Benutzer und Stunde** begrenzt. Das ist das Mittel, auf das sich ADR-007 beruft, wenn es einen synchronen Export für vertretbar erklärt.

### 3.9 Sync ist langsam, „too many clients" im Log ⚠️

**Ursache:** Die Datenbankverbindungen sind die härteste Grenze des Sync — gemessen, nicht vermutet (docs/12 §8).

**Vorgehen, in dieser Reihenfolge:**

1. `DATABASE_POOL_MAX` prüfen. Ohne die Variable nimmt der Treiber-Adapter **10** Verbindungen; `connection_limit` in der URL wirkt seit Prisma 7 nicht mehr.
2. `max_connections` der Datenbank und einen Verbindungspooler (pgbouncer) betrachten.
3. Erst danach an feinerer Sequenzierung arbeiten. Die naheliegende Vermutung, die Outbox-Serialisierung je Organisation sei der Engpass, ist gemessen und bringt aufgeteilt nur ein Drittel.

### 3.10 Gehäufte HTTP 429 ⚠️

**Ursache:** Rate Limits (docs/05).

**Vorgehen:** Zuerst prüfen, ob `RATE_LIMIT_STORE` in Produktion auf `postgres` steht. Auf `memory` zählt jede Instanz für sich und erlaubt hinter N Repliken das N-fache — dann sind die Limits nicht zu streng, sondern faktisch abgeschaltet, und ein 429 kommt von einer einzelnen überlasteten Instanz.

---

## 4. Was nie getan wird

| Nie                                                      | Warum                                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Zeilen in `audit_events` ändern oder löschen             | Append-only ist die Zusicherung des Systems (ADR-004). Die Anwendungsrolle hat dort weder UPDATE noch DELETE — wer es als schemabesitzende Rolle tut, zerstört genau das, wofür das System existiert |
| Eine bereits angewendete Migration nachträglich ändern   | `prisma migrate status` meldet danach weiterhin „up to date", die Datenbank ist aber eine andere |
| Eine erteilte Produktfreigabe per SQL „korrigieren"      | Eine Freigabe zurückzunehmen ist ein **Rückruf**, keine Korrektur. Die Tabelle ist mehrzeilig, damit die Historie lesbar bleibt |
| `MALWARE_SCANNER=stub` in Produktion                     | Wird hart abgelehnt. Eine Kontrolle, die vom Erinnern abhängt, ist keine                     |
| `RATE_LIMIT_STORE=memory` hinter mehreren Instanzen      | Vervielfacht still jedes Limit aus dem Vertrag                                              |
| Eine Grenze anheben, statt die Ursache zu beheben        | Gilt für Geräte, Exporte und Rate Limits gleichermaßen — jede dieser Zahlen trägt eine Begründung |

---

## 5. Was dieses Runbook nicht abdeckt

- **Eskalationswege und On-Call.** Wer wann geweckt wird, steht nicht im Code und gehört in eure Betriebsorganisation (docs/10 Phase 7).
- **Kapazitätsplanung über die Messwerte hinaus.** docs/12 §8 nennt Zahlen von einem Entwicklungsrechner; die Zielhardware ist noch nicht vermessen.
- **Alles, was aus dem Piloten kommt.** Die Störungen oben sind die, die dieses System **konstruktionsbedingt** kennt. Welche im Hallenbetrieb tatsächlich auftreten, weiß erst der Pilot — und die gehören dann hierher.

**Wer eine Störung bearbeitet, die hier fehlt, sollte sie ergänzen** — mit Symptom, Ursache und dem, was tatsächlich geholfen hat. Und wer ein ⚠️ ausführt, ersetzt es durch ✅ oder durch die Korrektur dessen, was hier falsch stand.
