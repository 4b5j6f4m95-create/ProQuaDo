# ADR-008: Ausgehende Integrationen (ERP/Webhook)

**Status:** Akzeptiert
**Datum:** 2026-08-09

## Kontext

[docs/10_MVP_PLAN.md](../10_MVP_PLAN.md) führt die ERP-/Webhook-Anbindung unter Phase 6 mit dem Zusatz „Implementierung optional für MVP". Sie wurde dort bewusst nicht gebaut, mit der Begründung, es gebe keinen Konsumenten, an dem sich ein Adapter-Interface bewähren könnte. Diese Begründung gilt weiterhin — die Umsetzung ist trotzdem beauftragt worden.

Das ist keine Nebensächlichkeit, sondern die wichtigste Randbedingung dieses Dokuments: **wir entwerfen eine Schnittstelle, ohne die Gegenstelle zu kennen.** Jede Entscheidung unten ist darauf ausgerichtet, möglichst wenig zu erraten.

## Entscheidung

### 1. Ausgeliefert werden Outbox-Ereignisse, kein ERP-Modell

Es gibt **kein** Auftragsschema, kein Feld-Mapping, keinen Produktstamm in dieser Umsetzung. Der Webhook liefert die Ereignisse, die das System ohnehin erzeugt, in der Form, die die Outbox bereits hat: Ereignistyp, Aggregat, Sequenznummer, Zeitpunkt, Nutzlast.

Der Grund ist der fehlende Konsument. Ein erratenes Fremddatenmodell muss beim ersten echten Anschluss weggeworfen werden; das Weiterreichen von Tatsachen, die wir intern ohnehin veröffentlichen, muss das nicht. Wer später ein ERP anbindet, schreibt die Abbildung dort, wo das Wissen über dieses ERP sitzt — nicht hier.

`write-outbox-event.ts` benennt „future webhooks" seit Phase 1 als vorgesehenen Verbraucher dieses Stroms. Wir bauen den vorgesehenen Verbraucher, nicht einen neuen Strom.

### 2. Eigener Cursor je Abonnement, nicht das `processed`-Flag

Die Outbox hat ein `processed`-Flag, das der Benachrichtigungsversand als Wasserstandsmarke benutzt. Ein zweiter Verbraucher am selben Flag würde dem ersten Ereignisse wegnehmen, die er noch nicht gesehen hat.

Jedes Abonnement führt deshalb seinen eigenen `cursor` über `sequence`, und je (Abonnement, Ereignis) entsteht eine Zustellzeile. Der Cursor läuft auch über **herausgefilterte** Ereignisse weiter — sonst würde ein auf einen Ereignistyp verengtes Abonnement dieselben Zeilen endlos neu lesen und seine eigenen späteren Ereignisse nie erreichen. Dieselbe Regel wie beim Gerätesync, aus demselben Grund.

Ein neues Abonnement beginnt am **aktuellen Ende** des Stroms, nicht bei null. Ein frisch registrierter Endpunkt, der die gesamte Historie der Organisation erhält, ist für den Empfänger eine Überraschung und für uns ein Ansturm.

### 3. Kein Worker — ein authentifizierter Auslöser

[ADR-007](ADR-007-export-job-processing.md) hält Queue-Infrastruktur aus dem MVP heraus. Benachrichtigungen lösen das, indem sie beim Lesen verteilt werden; für einen Webhook trägt das nicht, weil ein Fremdsystem nicht darauf warten kann, dass ein Mensch eine Seite öffnet.

Also: `POST /api/v1/integrations/webhooks/dispatch`, hinter `integration.manage`, aufgerufen von einem Scheduler. Keine neue Komponente in der Anwendung, eine Zeile in dem, was ohnehin Cron ausführt.

**Das ist eine Betriebsvoraussetzung, keine Feinheit: Ruft niemand diesen Endpunkt auf, wird nie etwas zugestellt.** Hinter einer Berechtigung statt hinter einem geteilten Geheimnis, damit der Scheduler sich wie jeder andere Aufrufer authentifiziert — seine Aktionen stehen im selben Audit-Trail, und sein Entzug ist derselbe Vorgang wie bei einer Person.

### 4. Signatur mit geteiltem Geheimnis

HMAC-SHA256 über `<timestamp>.<body>`, Header `x-proquado-signature: v1=<hex>`. Der Zeitstempel steckt **im** signierten Material: eine Signatur nur über den Rumpf lässt sich beliebig wiedereinspielen.

Anders als der `signature_data`-Digest aus [ADR-005](ADR-005-signature-method.md) ist das eine Signatur im belastbaren Sinn — sie beweist gegenüber dem Empfänger, dass die Nutzlast von jemandem mit dem Geheimnis stammt und unverändert ankam. Über die fachliche Verantwortung sagt sie nichts; das trägt der Audit-Trail.

Das Geheimnis wird **einmal** bei der Registrierung zurückgegeben und danach nie wieder ausgeliefert, auch nicht an Berechtigte. Es liegt im Klartext in der Datenbank, weil Signieren es braucht — geschützt durch dieselben Mittel wie alles andere dort (RLS, Rechtevergabe, Zugriffskontrolle auf die Produktionsdatenbank), nicht durch zusätzliche Verschlüsselung. Wer das anders bewertet, braucht ein Schlüsselverwaltungssystem, und das ist eine eigene Entscheidung.

### 5. SSRF-Schutz als Pflicht, nicht als Zugabe

Eine vom Benutzer bestimmte ausgehende URL macht diesen Server zum Botenjungen. Geprüft wird die **aufgelöste Adresse**, nicht der Name — ein Verbot der Zeichenkette „localhost" fängt nichts, weil tausend Namen auf Loopback zeigen. Abgelehnt werden Loopback, private Bereiche, Link-Local (dort liegen Cloud-Metadatendienste), CGNAT und Multicast; **alle** Antworten des Resolvers müssen zulässig sein. In Produktion zusätzlich: nur `https`, und Weiterleitungen werden nicht verfolgt (ein 302 liefe sonst um die Adressprüfung herum).

Geprüft wird bei der Registrierung **und** erneut bei jeder Zustellung: DNS ändert sich.

### 6. Fehlschläge enden sichtbar

Sechs Versuche mit wachsendem Abstand (1 min, 5, 25, 60, …, gedeckelt bei einer Stunde — insgesamt gut zwei Stunden). Danach `FAILED` **mit Grund**, dauerhaft sichtbar. Eine stillschweigend verworfene Zustellung lässt das empfangende System unbemerkt aus dem Tritt geraten — genau der Zustand, den eine Integration verhindern soll.

## Konsequenzen

**Positiv:**

- Keine neue Infrastruktur; ADR-007 bleibt unangetastet.
- Ein wiederholter Auslauf ist harmlos: die Eindeutigkeit von (Abonnement, Ereignis) liegt als Index in der Datenbank, nicht als Sorgfalt im Code.
- Mandantentrennung ergibt sich aus RLS wie überall sonst; ein Abonnement sieht ausschließlich Ereignisse seiner Organisation.
- Der Wechsel auf einen echten Worker ersetzt später **einen** Aufrufer des schon vorhandenen Dienstes.

**Negativ:**

- **Ohne Scheduler passiert nichts.** Die auffälligste Schwäche dieser Lösung, und sie ist Absicht — siehe Entscheidung 3.
- Zustellung erfolgt im Takt des Schedulers, nicht sofort. Für ERP-Abgleich angemessen, für etwas Echtzeitnahes nicht.
- Die Nutzlast ist unser Ereignisformat. Ein Empfänger, der etwas anderes braucht, braucht einen Übersetzer — bei ihm oder in einem späteren Adapter.
- **DNS-Rebinding bleibt offen**: zwischen Adressprüfung und Anfrage kann der Resolver anders antworten. Das zu schließen verlangt eine Verbindung, die an die geprüfte Adresse gebunden ist, also einen eigenen HTTP-Client im Integrationspfad. Bewusst nicht gebaut; das Fenster ist schmal und die Konfiguration administrativ.
- Das Signaturgeheimnis liegt im Klartext in der Datenbank.

**Alternativen erwogen:**

- **Synchrone Zustellung nach dem Commit:** verworfen. Sie hängt einen fremden HTTP-Aufruf an die Anfrage eines Mitarbeiters; ein langsamer Empfänger würde die Halle ausbremsen.
- **Timer im Node-Prozess:** verworfen. Bei mehreren Instanzen liefe er mehrfach, und ADR-007 hat Hintergrundverarbeitung im Anwendungsprozess bereits abgelehnt.
- **Geteiltes Geheimnis am Dispatch-Endpunkt statt Berechtigung:** verworfen. Ein zweiter Authentifizierungsweg neben dem vorhandenen, mit eigener Rotation und ohne Audit-Zurechnung.
- **ERP-Adapter mit Feldabbildung:** verworfen, siehe Entscheidung 1 — ohne Gegenstelle ist das Raten.

## Wann diese Entscheidung neu zu treffen ist

- Sobald ein **realer Konsument** existiert. Dann zeigt sich, ob das Ereignisformat trägt oder ob eine Abbildungsschicht dazugehört — und das ist der Moment, für den docs/10 die Umsetzung ursprünglich vorgesehen hatte.
- Sobald Zustellung zeitnah sein muss: dann Worker und Queue, und ADR-007 wird mit neu bewertet.
- Sobald mehr als eine Handvoll Abonnements bestehen oder die Nutzlast Personendaten trägt, für die eine Verschlüsselung des Geheimnisses und eine Auftragsverarbeitungsprüfung fällig werden (docs/08).
