# MASTERPROMPT – Produktions-, Qualitäts- und Dokumentationssoftware

**Dokumenttyp:** Verbindliche Produktspezifikation, Architekturauftrag und Implementierungsleitfaden  
**Sprache der Anwendung:** Deutsch, internationalisierbar  
**Zielplattform:** Tablet-first Web/PWA und Desktop-Administration  
**Technologischer Ausgangspunkt:** Next.js, React, TypeScript, PostgreSQL, Prisma  
**Qualitätsbezug:** ISO 9001:2015 einschließlich Amendment 1:2024, ohne Zertifizierungsbehauptung  
**Priorität:** Rückverfolgbarkeit, Datenintegrität, einfache Bedienung und serverseitig kontrollierter Prozessfortschritt

---

## 0. Rolle und Arbeitsauftrag an den Coding-Agenten

Du agierst als leitender Softwarearchitekt, Product Engineer, UX-Designer, Security Engineer und QA-Verantwortlicher. Entwickle eine produktionsreife Software zur Planung, Ausführung, Prüfung und lückenlosen Dokumentation von Fertigungsaufträgen. Die Lösung unterstützt ein Qualitätsmanagementsystem, ersetzt aber weder fachliche QM-Verantwortung noch eine Zertifizierung.

Arbeite nicht sofort mit unkoordiniertem Feature-Code. Beginne mit einer Bestandsaufnahme des vorhandenen Repositories. Lege danach nachvollziehbare Architekturentscheidungen, Domänenmodell, Zustandsautomaten, Berechtigungsmatrix, Schnittstellenvertrag, UX-Flows, Migrationsstrategie und einen umsetzbaren Entwicklungsplan vor. Implementiere anschließend inkrementell in vertikalen, testbaren Funktionsschnitten.

Falls Anforderungen miteinander kollidieren, gilt folgende Rangfolge:

1. Datenintegrität, Arbeitssicherheit und unverfälschte Historie
2. Serverautorität für Prozessfortschritt und Freigaben
3. Gesetzliche, vertragliche sowie Datenschutzanforderungen
4. Rückverfolgbarkeit und Auditierbarkeit
5. Verbindliche Geschäftsregeln dieses Dokuments
6. Bedienbarkeit und Performance
7. Technische Bequemlichkeit

Treffe keine stillen fachlichen Annahmen. Dokumentiere offene Punkte als ADR oder Entscheidungsliste und wähle für die Implementierung eine konservative, konfigurierbare Voreinstellung. Keine Funktion darf Daten oder Nachweise erfinden. Keine UI darf einen lokalen Zwischenstand als serverseitig freigegeben darstellen.

### Verpflichtende Lieferreihenfolge

Vor der eigentlichen Implementierung sind zu erstellen und zur Prüfung bereitzustellen:

1. Systemkontext und Architekturübersicht
2. Domänenmodell und Datenbank-ER-Modell
3. Statusautomaten für Auftrag, Arbeitsschritt, Dokument, NCR und Synchronisation
4. Rollen-, Rechte- und Freigabematrix
5. API- und Event-Verträge einschließlich Idempotenz
6. Offline-, Konflikt- und Wiederanlaufkonzept
7. Wireflows für Produktion, Projektleitung, QM und Administration
8. Bedrohungsmodell und Datenschutzkonzept
9. Testpyramide und Abnahmekriterien
10. priorisierter MVP- und Migrationsplan

Erst danach beginnt die Umsetzung. Nach jeder Phase: Migrationen ausführen, Typprüfung, Linting, automatisierte Tests, sicherheitsrelevante Negativtests und dokumentierte manuelle Abnahme durchführen.

---

## 1. Vision und Systemgrenzen

Die Anwendung bildet den vollständigen Weg von Projekt und freigegebenen technischen Unterlagen über Fertigungsplanung und operative Arbeitsschritte bis zur Endprüfung, Produktfreigabe und digitalen Produktionsakte ab.

Ziele:

- jederzeit den gültigen Arbeitsstand und die freigegebene Revision sichtbar machen;
- Produktionsmitarbeitern eine extrem einfache, touch-optimierte Oberfläche geben;
- Nachweise wie Fotos, Checklisten, Messwerte und Bestätigungen direkt am Schritt erfassen;
- ungeplante Abweichungen, Nacharbeit und Nachprüfung transparent abbilden;
- jede relevante Änderung und Entscheidung unveränderbar nachvollziehbar machen;
- die Historie eines Produkts über Auftrag, Charge oder Seriennummer vollständig auffindbar machen;
- offline Datenerfassung ermöglichen, ohne die Qualitätsautorität des Servers zu umgehen;
- Kennzahlen und exportierbare Produktionsakten aus den Primärdaten erzeugen.

Nichtziele des ersten Releases:

- vollständiges ERP, MES, PLM oder CAD-System ersetzen;
- Normtexte reproduzieren oder Rechts-/Zertifizierungsberatung leisten;
- kryptografisch qualifizierte elektronische Signaturen ohne gesonderte Prüfung behaupten;
- vollständig autonome Produktionsentscheidungen durch KI;
- endgültige Prozessfreigaben durch ein Offline-Gerät.

### Mandanten- und Organisationsfähigkeit

Das Datenmodell soll Organisationen, Standorte, Abteilungen und Arbeitsbereiche sauber trennen. Wenn zunächst nur ein Unternehmen betrieben wird, darf die Architektur dennoch keine spätere Mandantentrennung verhindern. Jede geschäftliche Entität trägt eine `organization_id`; sensible Abfragen müssen diese serverseitig erzwingen.

---

## 2. Verbindliche Geschäftsgrundsätze

1. Der Server ist die einzige Qualitäts- und Workflow-Autorität.
2. Ein Client darf niemals selbst einen endgültigen Abschluss oder die Freigabe eines Folgeschritts erzeugen.
3. Offline darf nur ein Schritt bearbeitet werden, der vor dem Verbindungsverlust gültig serverseitig freigegeben und auf das Gerät synchronisiert wurde.
4. Ein offline fertiggestellter Schritt erhält ausschließlich `COMPLETED_PENDING_SYNC`; der Folgeschritt bleibt gesperrt.
5. Alte Dokument-, Plan- und Anweisungsrevisionen werden nie überschrieben.
6. Tatsächlich verwendete Revisionen werden am Ausführungsnachweis unveränderlich referenziert.
7. Kritische Geschäftsdaten werden nicht hart gelöscht; Korrekturen erfolgen über Versionierung, Storno, Archivierung oder kompensierende Ereignisse.
8. Jede Freigabe muss Identität, Berechtigung, Zeitpunkt, Objektversion und Entscheidungsgrund nachvollziehbar machen.
9. Ein Vier-Augen-Schritt darf nicht durch dieselbe Person ausgeführt und geprüft werden.
10. Außerhalb der Toleranz liegende Pflichtmessungen führen zu einem negativen Prüfergebnis und gemäß Konfiguration zu einer blockierenden Abweichung.
11. Fehlende Pflichtnachweise verhindern den serverseitigen Abschluss.
12. Überspringen ist keine lokale Statusmanipulation, sondern ein begründeter, auditierter Freigabeprozess.
13. Berichtsdaten werden aus historisierten Primärdaten erzeugt und verändern diese nicht.
14. Die Oberfläche zeigt Onlinezustand, Synchronisationsstand, lokale Warteschlange und Sperrgrund klar und wahrheitsgemäß an.

---

## 3. Nutzergruppen und Rollenmodell

RBAC wird serverseitig durchgesetzt und optional durch kontextbezogene Regeln (ABAC) ergänzt, etwa Organisation, Standort, Projektzuordnung, Abteilung, Qualifikation und Objektstatus. UI-Ausblendung allein ist keine Zugriffskontrolle.

### Administrator

- Organisation, Standorte, Benutzer, Rollen und Systemeinstellungen verwalten
- Stammdaten und Integrationen konfigurieren
- alle Projekte im zulässigen Mandanten sehen
- Audit-Protokolle lesen, jedoch nicht verändern
- keine fachliche Freigabe allein aufgrund der Admin-Rolle erhalten

### Qualitätsmanager

- Prüfpläne, Qualitätsregeln und Abweichungskategorien verwalten
- NCR bewerten, Sperren setzen und aufheben
- Nacharbeit, Nachprüfung und CAPA-Prozesse steuern
- Prüfmittel und Kalibrierstatus verwalten
- Qualitätsberichte und Audit-Trail einsehen
- fachlich vorgesehene Revisionen/Freigaben erteilen

### Projektleiter / Arbeitsvorbereitung

- Projekte, Produkte, Baugruppen und Fertigungspläne erstellen
- Dokumente hochladen, revisionieren und im vorgesehenen Workflow freigeben
- Arbeitsschritte, Abhängigkeiten und Pflichtnachweise definieren
- Foto-, Signatur-, Messwert-, Checklisten- und Vier-Augen-Pflichten konfigurieren
- Änderungsfolgen für laufende Aufträge bewerten
- begründete Ausnahmen entscheiden, soweit dafür berechtigt

### Produktionsleiter

- Produktionsaufträge anlegen, terminieren und zuweisen
- Kapazitäten, Status, Engpässe und Sperren überwachen
- operative Koordination vornehmen
- keine QM-Sperre ohne passende Qualitätsberechtigung umgehen

### Produktionsmitarbeiter

- zugewiesene und berechtigte Aufträge sehen
- serverseitig freigegebene Schritte starten und bearbeiten
- Anweisungen und Zeichnungen ansehen
- Checklisten, Fotos, Messwerte, Kommentare und Bestätigungen erfassen
- Abweichungen melden und lokalen Abschluss vorbereiten
- keine Revision, Pflichtregel, Freigabe oder historische Evidenz verändern

### Prüfer

- zugewiesene Prüfungen durchführen
- Ergebnisse, Messmittel, Nachweise und Signatur erfassen
- im Rahmen seiner Qualifikation freigeben oder zurückweisen
- niemals eigene Ausführung als unabhängiger zweiter Prüfer bestätigen

### Auditor / Read-only

- freigegebene Projekte, Produktionsakten, Berichte und Audit-Ereignisse lesen/exportieren
- keine operativen Daten verändern
- Zugriff nach Zweck, Zeitraum und Mandant begrenzen

### Berechtigungsanforderungen

- Berechtigungen granular als Aktionen modellieren, z. B. `document.release`, `work_step.execute`, `ncr.disposition`, `production_hold.release`.
- Rollen sind Bündel von Berechtigungen, keine fest im Code verteilten Fallunterscheidungen.
- Kritische Aktionen verlangen Re-Authentifizierung oder PIN/Bestätigung.
- Qualifikationen besitzen Gültigkeitszeiträume; abgelaufene Qualifikationen verhindern Start oder Freigabe betroffener Schritte.
- Rechteänderungen wirken serverseitig sofort. Bereits offline erfasste Arbeit bleibt als historische Tatsache erhalten, darf bei entzogenem Recht aber nicht automatisch freigegeben werden.
- Stellvertretungen sind zeitlich begrenzt, begründet und auditierbar.

---

## 4. Kernprozess und Projektstruktur

Der Standardprozess lautet:

`Projekt → Produkt/Baugruppe → Fertigungsplan-Revision → Produktionsauftrag → freigegebene Arbeitsschritte → Prüfungen/NCR/Nacharbeit → Endprüfung → Produktfreigabe → digitale Produktionsakte`

### Projekt

Mindestens zu speichern:

- Projektnummer, Name, Beschreibung, Kunde und Bestellnummer
- Projektleiter, Produktionsleiter und Team
- Plantermine, Priorität, Status und Standort
- Produkte, Baugruppen, Lose, Seriennummern und Teilaufträge
- Dokumente, Freigaben, Änderungen, Risiken und Qualitätsabweichungen

### Produktionsauftrag

Jeder Auftrag besitzt eindeutige Nummern und optional Fertigungs-, Chargen-, Bauteil- und Seriennummern. Ein QR-/Barcode führt über einen nicht erratbaren bzw. autorisierten Resolver zur passenden Auftragssicht. Ein Scan zeigt Produkt, Auftrag, aktuellen freigegebenen Schritt, gültige Unterlagen, Historie und offene Anforderungen.

Status mindestens: `DRAFT`, `PLANNED`, `RELEASED`, `IN_PROGRESS`, `ON_HOLD`, `QUALITY_BLOCKED`, `COMPLETED`, `CANCELLED`, `ARCHIVED`.

### Fertigungsplan

Ein Plan ist revisioniert und wird vor Verwendung fachlich freigegeben. Eine Revision ist nach Freigabe unveränderlich. Neue Änderungen erzeugen eine neue Revision mit Änderungsgrund, Autor, Prüfer, Freigeber und Auswirkungsanalyse.

Ein Arbeitsschritt definiert mindestens:

- stabile fachliche ID, Nummer, Reihenfolge, Titel und Beschreibung
- Abteilung, erforderliche Rolle/Qualifikation, Arbeitsplatz und Maschine
- Sollzeit, Sicherheits- und Arbeitsanweisung
- Vorgänger/Abhängigkeiten und Parallelisierungsregeln
- konkrete Dokumentrevisionen, Seiten, Baugruppen und Marker
- Checklisten, Prüfmerkmale und Akzeptanzkriterien
- Foto-, Signatur-, Kommentar-, Messwert- und Vier-Augen-Pflichten
- minimale/maximale Fotoanzahl und erlaubte Aufnahmequelle
- benötigte Prüfmittel und Kalibrieranforderungen
- Regeln für Sperre, NCR, Nacharbeit, Überspringen und Eskalation

Beim Erzeugen eines Produktionsauftrags wird die freigegebene Planrevision als ausführbare Instanz materialisiert oder unveränderlich referenziert. Spätere Planänderungen dürfen laufende Instanzen nicht still umdeuten.

---

## 5. Workflow Engine und Zustandsautomaten

Die Workflow Engine läuft serverseitig. Statuswechsel erfolgen nur über Domänenkommandos mit Vorbedingungen, atomarer Transaktion, optimistischer Versionskontrolle und Audit-Ereignis. Direkte Statusupdates über generische CRUD-Endpunkte sind verboten.

### Arbeitsschrittstatus

- `LOCKED`: noch nicht freigegeben oder Abhängigkeit unerfüllt
- `READY`: durch Server gültig freigegeben
- `IN_PROGRESS`: begonnen
- `PAUSED`: bewusst unterbrochen
- `COMPLETED_PENDING_SYNC`: lokal fertiggestellt, nicht serverbestätigt
- `WAITING_FOR_SERVER`: Synchronisation oder Entscheidung erforderlich
- `VALIDATING`: Server validiert Abschluss
- `AWAITING_SECOND_APPROVAL`: Vier-Augen-Prüfung offen
- `COMPLETED`: endgültig serverseitig bestätigt
- `COMPLETION_REJECTED`: Abschluss mit konkreten Gründen abgelehnt
- `BLOCKED`: durch Abweichung, Sperre, Revision oder andere Regel blockiert
- `SKIP_REQUEST_PENDING_SYNC`: lokaler Überspringantrag
- `SKIP_REQUESTED`: serverseitig eingegangen, Entscheidung offen
- `SKIPPED`: serverseitig genehmigt und historisiert
- `REWORK_REQUIRED`: Nacharbeit erforderlich
- `SUPERSEDED`: durch kontrollierte Neuplanung ersetzt

### Zentrale Domänenoperationen

Implementiere klar abgegrenzte Services, mindestens:

```ts
canStartWorkStep(context): Decision
startWorkStep(command): Result
prepareLocalCompletion(command): LocalResult
validateAndCompleteWorkStep(command): ServerResult
canReleaseNextWorkStep(context): Decision
releaseEligibleSuccessors(command): Result
requestSkip(command): Result
decideSkip(command): Result
raiseNonConformance(command): Result
applyProductionHold(command): Result
resolveRevisionConflict(command): Result
```

`Decision` enthält nicht nur Boolean, sondern maschinenlesbare Reason Codes und verständliche deutsche Meldungen. Nur `validateAndCompleteWorkStep()` darf endgültig `COMPLETED` setzen. Nur serverseitige Workflow-Funktionen dürfen Folgeschritte freigeben.

### Validierung beim Abschluss

Der Server prüft atomar mindestens:

- Organisation, Auftrag und Schritt existieren und sind nicht archiviert
- Clientkommando ist idempotent und noch nicht verarbeitet
- Actor ist authentifiziert, berechtigt, zugewiesen und ausreichend qualifiziert
- der Schritt war serverseitig freigegeben und der Release Token gültig
- erwartete Entitätsversion stimmt oder Konflikt wurde bewusst behandelt
- Auftrag/Projekt besitzen keine aktive Produktions- oder Qualitätssperre
- Vorgänger und Abhängigkeiten sind gültig abgeschlossen
- Pflichtcheckliste ist vollständig
- erforderliche Fotos sind vollständig hochgeladen, integer und zugeordnet
- Signatur/Bestätigung und ggf. Kommentar sind vorhanden
- Pflichtmesswerte sind vorhanden, parsebar, plausibel und innerhalb Toleranz
- verwendete Prüfmittel waren zum Messzeitpunkt zulässig und kalibriert
- Vier-Augen-Regel ist erfüllt und Personen sind verschieden
- keine blockierende NCR ist offen
- Plan-, Anforderungs- und Dokumentrevision entsprechen dem Ausführungskontext
- keine relevante Änderung trat seit letzter Freigabe ein
- fachliche Freigaberegeln und kundenspezifische Anforderungen sind erfüllt

Bei Erfolg setzt eine Datenbanktransaktion den Schritt auf `COMPLETED`, schreibt Audit und Outbox Event und ermittelt freigabefähige Nachfolger. Bei Fehler bleibt der Folgeschritt gesperrt; die Antwort enthält stabile Fehlercodes, betroffene Objekte und nächste Handlung.

### Parallelität und Abhängigkeiten

Der Plan unterstützt gerichtete azyklische Abhängigkeiten, sofern fachlich gewünscht. Ein Nachfolger wird erst `READY`, wenn alle konfigurierten Vorgängerbedingungen erfüllt sind. Parallele Zweige dürfen unabhängig laufen; ein Join wartet auf alle notwendigen Zweige. Zyklische Pläne werden vor Freigabe abgelehnt.

### Überspringen

Offline kann nur `SKIP_REQUEST_PENDING_SYNC` mit Mitarbeiter, Signatur, Foto, Begründung und Zeitstempel angelegt werden. Nach Synchronisation wird daraus `SKIP_REQUESTED`. Genehmigung verlangt konfigurierte Rolle und ggf. Vier-Augen-Prinzip. Erst der Server darf `SKIPPED` setzen und Nachfolger prüfen. Ablehnung bleibt begründet erhalten.

---

## 6. Offline-First mit serverkontrolliertem Fortschritt

### Unverhandelbares Prinzip

**Offline erfassen: ja. Offline einen bereits freigegebenen Schritt bearbeiten: ja. Offline lokal fertigstellen: ja. Offline den nächsten Schritt freischalten oder starten: nein.**

Die lokale Anwendung ist für Bedienung, sichere Persistenz, Datenerfassung und Synchronisationsvorbereitung verantwortlich. Der Server ist für endgültige Statusänderungen, Berechtigungen, Revisionen, Sperren, NCR-Entscheidungen, Abhängigkeiten und Prozessfreigabe verantwortlich.

### Offline erlaubte Funktionen

Für zuvor synchronisierte, serverseitig freigegebene Schritte:

- Zeichnungen und Arbeitsanweisungen ansehen
- Checklisten bearbeiten
- Fotos aufnehmen
- Messwerte, Kommentare und Abweichungen erfassen
- Mitarbeiterbestätigung und Signatur erfassen
- Arbeit pausieren und lokal fertigstellen

Nicht erlaubt:

- nicht freigegebenen Schritt starten
- `COMPLETED` lokal erzeugen
- Folgeschritt lokal entsperren
- Dokumentrevision oder Pflichtregel lokal verändern
- serverseitige Sperre umgehen
- Überspringen endgültig genehmigen

### Release Token

Jeder freigegebene Schritt erhält einen signierten oder serverseitig eindeutig validierbaren Release-Nachweis mit:

- `work_step_id`, `production_order_id`, `organization_id`
- Releasezeitpunkt und ausstellende Systeminstanz
- Planrevision, Requirements-Version und Dokumentset-Hash
- Gültigkeitsstatus, serverseitige Nonce/Token-ID und optional Ablauf
- Entitätsversion

Der Token ist kein Freibrief für Folgeschritte. Er beweist ausschließlich, dass dieser konkrete Schritt vor Offlinegang freigegeben war. `canStartWorkStep()` verlangt `server_released === true`, gültigen Token und passende lokale Identität.

### Lokale Speicherung

Verwende eine verschlüsselte lokale Datenbank bzw. abgesicherte Plattform-Speichermechanismen. Trenne:

- replizierte Referenzdaten und freigegebene Dokumente
- lokale Entwürfe
- unveränderliche lokale Events/Outbox-Kommandos
- Binärdateien mit Hash, Uploadstatus und Wiederaufnahmeinformationen
- Sync-Cursor und serverbestätigte Versionen

Jede lokale Mutation erhält UUID, Geräte-ID, Actor, Clientzeit, monotone Sequenz, Basisversion und Payload-Schema-Version. Serverzeit ist nach Synchronisation maßgeblich; Clientzeit bleibt als Erfassungszeit erhalten.

### Synchronisationsprotokoll

1. Verbindung erkennen, aber nicht allein darauf vertrauen; authentifizierten Server-Healthcheck durchführen.
2. Zugang erneuern und Gerätestatus prüfen.
3. Outbox in stabiler Reihenfolge mit Idempotency Key senden.
4. Große Fotos resumierbar und per Checksumme hochladen.
5. Server validiert Kommandos und antwortet pro Eintrag deterministisch.
6. Serverevents seit letztem Cursor abrufen.
7. Lokale Projektion transaktional aktualisieren.
8. Bestätigte Outbox-Einträge erst nach persistierter Serverquittung als erledigt markieren.
9. Freigaben und Sperren sofort in der UI aktualisieren.

Wiederholtes Senden darf keine doppelten Fotos, Messwerte, NCRs, Abschlüsse oder Audit-Einträge erzeugen. Teilfehler werden pro Kommando sichtbar; erfolgreiche Einträge dürfen nicht unnötig zurückgerollt werden.

### Offline-Abschluss

Nach lokaler Vollständigkeitsprüfung:

`IN_PROGRESS → COMPLETED_PENDING_SYNC → WAITING_FOR_SERVER`

UI-Text: **„Lokal abgeschlossen – Serverfreigabe ausstehend.“** Der Nachfolger zeigt: **„Gesperrt. Für die Freigabe ist eine Verbindung zum Server und eine erfolgreiche Prüfung erforderlich.“**

Nach Verbindung:

`WAITING_FOR_SERVER → VALIDATING → COMPLETED`

oder:

`WAITING_FOR_SERVER → VALIDATING → COMPLETION_REJECTED/BLOCKED`

Nur nach `COMPLETED` und positiver Nachfolgerprüfung sendet der Server `NEXT_STEP_RELEASED`.

### Konflikte

Keine automatische Last-write-wins-Strategie für Qualitätsdaten. Der Server liefert Typ, Vergleichsversionen, Auswirkung und zulässige Entscheidungen. Konflikttypen mindestens:

- `REVISION_CONFLICT`
- `PERMISSION_REVOKED`
- `ORDER_ON_HOLD`
- `REQUIREMENT_CHANGED`
- `ENTITY_VERSION_CONFLICT`
- `DUPLICATE_COMMAND`
- `BLOCKING_NCR`
- `MISSING_OR_CORRUPT_EVIDENCE`

Wenn während Offline-Arbeit Revision 04 durch 05 ersetzt wurde, bleibt historisch **„ausgeführt nach Revision 04“** erhalten. Projektleitung/QM entscheidet auditierbar: weiterhin gültig, Zusatzprüfung, Nacharbeit, Wiederholung oder Produktsperre. Die Historie darf nicht auf Revision 05 umgeschrieben werden.

### Geräteverlust und Speichergrenzen

- lokale Daten verschlüsseln und an angemeldeten Benutzer/Gerät binden;
- Remote-Widerruf bei nächster Verbindung unterstützen;
- sensible Cache-Daten nach definierter Aufbewahrung kontrolliert entfernen;
- Benutzer vor knappem Speicher warnen, ohne unbestätigte Daten zu löschen;
- Export über private Freigaben verhindern;
- Backpressure und Upload-Warteschlange sichtbar machen.

---

## 7. Dokumenten-, Zeichnungs- und Revisionsmanagement

Unterstützte Typen mindestens PDF, PNG, JPG/JPEG, Office-Dokumente und CAD-Dateien als sicherer Download/Referenz. Dateien werden objektbasiert gespeichert; Metadaten und Versionen liegen relational vor.

### Dokumentidentität und Revision

Ein Dokument besitzt eine stabile Identität; jede Revision ist ein unveränderliches Kindobjekt. Gespeichert werden:

- Dokumentnummer, Titel, Kategorie und Fachbereich
- Revision, Status, Ersteller, Uploadzeit und SHA-256-Hash
- MIME-Typ, Größe, Speicher-Key und Malware-Scanstatus
- Änderungsbeschreibung und Grund
- Vorgängerrevision
- Prüfer, Freigeber und Freigabezeit
- Gültig-ab/Gültig-bis und betroffene Produkte/Pläne

Status: `DRAFT`, `IN_REVIEW`, `APPROVED`, `RELEASED`, `SUPERSEDED`, `WITHDRAWN`, `ARCHIVED`.

Nur freigegebene Revisionen dürfen für neue Ausführungen verbindlich sein. Einmal referenzierte Revisionen bleiben lesbar, auch wenn sie ersetzt wurden. Zugriff folgt Berechtigungen und Aufbewahrung.

### Viewer und Markierungen

PDFs und technische Zeichnungen werden in der Anwendung mit Zoom, Verschieben, Rotation, Seitenwechsel und Vollbild angezeigt. Revision und Freigabestatus sind permanent sichtbar. Arbeitsschritte können auf Dokument, Revision, Seite, Koordinate/Region, Baugruppe und Marker verweisen. Kommentare und Marker sind selbst versioniert/auditiert und dürfen die Originaldatei nicht verändern.

### Änderungsmanagement

Nach Planfreigabe erzeugt jede Änderung eine neue Revision. Die Auswirkungsanalyse listet laufende Aufträge und bereits ausgeführte/offene Schritte. Verantwortliche entscheiden pro Betroffenheit:

- keine Aktion erforderlich
- Kenntnisnahme erforderlich
- Zusatzprüfung erforderlich
- Nacharbeit/Wiederholung erforderlich
- Auftrag oder Produkt sperren

Entscheidung, Begründung, betroffene Seriennummern, Personen und Zeitpunkt werden protokolliert. Kritische neue Revisionen verhindern neue Freigaben, bis die Auswirkung entschieden ist.

---

## 8. Nachweise, Prüfungen und Messmittel

### Fotos

Der Projektleiter entscheidet pro Schritt `photo_required`. Konfigurierbar sind Mindest-/Maximalzahl, Kategorien (Gesamtansicht, Detail, Typenschild), Kamera-Pflicht, Galerie-Upload, Beschreibung und Reihenfolge. Jedes Foto erhält Auftrag, Schritt, Actor, Erfassungs- und Uploadzeit, Gerätebezug, Dateihash, Kategorie und Ausführungskontext.

Nach serverbestätigtem Abschluss werden Fotos weder unbemerkt ersetzt noch gelöscht. Eine Korrektur erzeugt neue Evidenz mit Grund und Beziehung zum Vorgänger. Originaldatei bleibt gemäß Aufbewahrung erhalten. Metadaten wie GPS werden nur bei legitimem Zweck und konfigurierter Zustimmung verarbeitet.

### Mitarbeiterbestätigung

Mindestens Login plus Mitarbeiterkennung und PIN/digitale Bestätigung. Der gespeicherte Bestätigungstext wird versioniert. Standardtext sinngemäß:

> Ich bestätige, dass ich den Arbeitsschritt entsprechend der angezeigten Arbeitsanweisung und den dokumentierten Unterlagen ausgeführt habe. Abweichungen habe ich vollständig gemeldet.

Die Bestätigung speichert Actor-ID, Anzeigename zum Zeitpunkt, Schritt, Zeitpunkt, verwendete Revisionen, Evidenzreferenzen und Textversion. Sie ist nicht mit einer qualifizierten elektronischen Signatur gleichzusetzen, solange dies nicht separat umgesetzt und geprüft wurde.

### Prüfmerkmale

Unterstütze Sicht-, Maß-, Funktions-, Dichtheits-, Elektro-, Druck-, Vollständigkeits- und freie Prüfungen. Eingabetypen: OK/NOK, Zahl, Text, Auswahl, Datei, Foto und Signatur. Numerische Merkmale speichern Sollwert, untere/obere Grenze, Einheit, Dezimalpräzision, Istwert und Auswertungsregel. Berechnung erfolgt serverseitig erneut; Clientfeedback ist nur vorläufig.

### Prüfmittel

Stammdaten: Nummer, Bezeichnung, Hersteller, Modell, Seriennummer, Standort, Messbereich, Status, letzte/nächste Kalibrierung und Kalibrierzertifikat. Bei konfigurierter Pflicht verhindert ein zum Ausführungszeitpunkt gesperrtes oder überfälliges Prüfmittel die Freigabe. Eine spätere Erkenntnis über fehlerhafte Kalibrierung muss eine Auswirkungsanalyse auf betroffene Messungen ermöglichen.

### Vier-Augen-Prinzip

Kritische Schritte verlangen einen zweiten, unabhängigen Actor. Der Server erzwingt `executor_user_id != reviewer_user_id`, passende Prüferqualifikation und zeitlich gültige Berechtigung. Ablehnung erzeugt Begründung und ggf. Nacharbeit; die ursprüngliche Ausführung bleibt erhalten.

---

## 9. Qualitätsabweichungen, Sperren, Nacharbeit und CAPA

Eine NCR kann aus einem Schritt, einer Prüfung, einem Dokumentkonflikt oder unabhängig entstehen. Nummern werden serverseitig eindeutig vergeben.

Felder mindestens:

- Projekt, Auftrag, Produkt/Bauteil, Los/Seriennummer und Arbeitsschritt
- Beschreibung, Fehlerart, Entdeckungsort, Priorität/Schweregrad
- Fotos und weitere Nachweise
- Melder, Zeitpunkt, Verantwortlicher und Frist
- Sofortmaßnahme, Eindämmung, Ursache und Bewertung
- Korrektur, Nacharbeit, Nachprüfung und Wirksamkeitsprüfung
- Disposition und Freigabe
- Blockierungswirkung und betroffene Einheiten

Status: `DRAFT`, `OPEN`, `ASSESSMENT_REQUIRED`, `CONTAINMENT`, `REWORK`, `REINSPECTION`, `AWAITING_DISPOSITION`, `CLOSED`, `CANCELLED`.

Der Server klassifiziert anhand konfigurierter Regeln und berechtigter Entscheidung als `NON_BLOCKING` oder `BLOCKING`. Eine offline erfasste NCR wird vor Folgeschritt synchronisiert. Bis zur Serverentscheidung gilt bei potenziell kritischen Kategorien die konservative Sperrregel.

Nacharbeit wird als eigener, mit Ursprung und NCR verknüpfter Schritt ausgeführt:

`Fehlerhafter Schritt → NCR → Nacharbeit → Nachprüfung → Freigabe → regulärer Nachfolger`

Der ursprüngliche Schritt wird niemals aus der Historie entfernt oder rückwirkend als fehlerfrei umgeschrieben.

Produktionssperren besitzen Scope (Projekt, Auftrag, Los, Seriennummer, Schritt), Grund, Aussteller, Zeitpunkt, Status und Freigabebedingung. Aufhebung verlangt passende Rolle, Begründung und optional Vier-Augen-Freigabe.

CAPA kann in einer späteren Phase ergänzt werden; Domänenreferenzen für Ursache, Maßnahme, Verantwortlichen, Frist und Wirksamkeitsprüfung sind vorzusehen.

---

## 10. Audit Trail und Rückverfolgbarkeit

Das Audit-Protokoll ist append-only. Anwendungskonten besitzen keine Update-/Delete-Rechte auf Audit-Datensätze. Schutz wird durch Datenbankrechte, eingeschränkte Services und optional Hash-Verkettung/periodische externe Versiegelung verstärkt.

Jedes relevante Ereignis speichert:

- global eindeutige Ereignis-ID und Korrelations-ID
- Organisation und Actor; ggf. vertretener Benutzer
- Aktion/Ereignistyp und Objektart/-ID
- Serverzeit sowie erhaltene Client-Erfassungszeit
- vorherige und neue fachliche Werte oder einen datensparsamen Diff
- Grund, Quelle, Geräte-ID, IP/Session soweit zulässig
- Entitätsversion, Request-/Idempotency-ID
- Ergebnis einschließlich Ablehnungsgrund

Zu protokollieren sind mindestens Login-relevante Sicherheitsereignisse, Projekt-/Auftragsänderungen, Dokumentupload und -freigabe, Planrevisionen, Schrittstart/-abschluss/-ablehnung, Fotos, Messwerte, Signaturen, Prüfungen, NCR, Nacharbeit, Sperren, Freigaben, Rollenänderungen, Exporte und administrative Konfiguration.

Geheimnisse, Passwörter, PINs, Tokens und unnötige personenbezogene Vollinhalte gehören nie ins Audit-Log. Lesende Zugriffe auf besonders sensible Akten können separat protokolliert werden.

### Digitale Produktionsakte

Für Auftrag, Los oder Seriennummer wird eine reproduzierbare, versionierte Akte erzeugt:

1. Deckblatt und eindeutige Identifikation
2. Projekt-, Kunden-, Auftrags- und Produktdaten
3. verwendete Fertigungsplanrevision
4. verwendete Dokumente und Revisionen
5. ausgeführte, übersprungene und nachgearbeitete Schritte
6. Mitarbeiterbestätigungen und unabhängige Prüfungen
7. Fotos, Checklisten, Messwerte und Prüfmittel
8. NCRs, Entscheidungen, Sperren und Nacharbeiten
9. Endprüfung und Produktfreigabe
10. relevanter Audit-Auszug und Erzeugungsmetadaten

Export als PDF sowie ZIP mit Originalnachweisen und Manifest. Das Manifest enthält Dateihashes, IDs und Revisionen. Jeder Export ist auditierbar und erhält Erstellungszeit, Datenstand und Template-Version.

---

## 11. ISO-9001-orientierte Unterstützung

Die Software unterstützt Prozesse eines Qualitätsmanagementsystems mit Fokus auf:

- Lenkung dokumentierter Information
- Verantwortlichkeiten, Kompetenz und Bewusstsein
- betriebliche Planung und Produktionslenkung
- Identifikation und Rückverfolgbarkeit
- Erhaltung und kontrollierte Änderungen
- Freigabe von Produkten und Dienstleistungen
- Umgang mit nichtkonformen Ergebnissen
- Überwachung, Messung und Prüfmittel
- interne Audits, Korrekturmaßnahmen und Verbesserung
- Risiken, Chancen und Kontextaspekte einschließlich relevanter Klimaaspekte

Implementiere eine konfigurierbare Matrix:

`Softwarefunktion → Unternehmens-QM-Prozess → Normreferenz → Nachweis/Report → Verantwortliche Rolle`

Normreferenzen sind Metadaten und keine hart codierte Geschäftslogik. Dadurch können spätere Normausgaben konfiguriert werden. Kopiere keine geschützten Normtexte. Verwende keine Aussage wie „Software ist ISO-9001-zertifiziert“. Formuliere ausschließlich, dass Funktionen die Umsetzung und Nachweisführung eines QMS unterstützen.

---

## 12. Informationsarchitektur und UX

### Produktionsoberfläche – Tablet First

Nach Login zeigt „Meine Aufträge“ nur relevante, berechtigte Aufgaben. Nach Auswahl steht der aktuelle Schritt im Mittelpunkt:

- „Schritt 7 von 18“ und klarer Status
- Titel und kurze Arbeitsanweisung
- permanent sichtbare Dokumentrevision
- große Aktionen: Zeichnung öffnen, Foto aufnehmen, Messwert eingeben, Abweichung melden
- Checkliste und Nachweisfortschritt
- großer Abschlussbutton, erst nach lokaler Vollständigkeit aktiv
- sichtbarer Online-/Offline- und Synchronisationsstatus

Große Touch-Ziele, hohe Kontraste, verständliche Icons mit Text, minimale Texteingabe, kameranahe Bedienung, Handschuhbetrieb und responsive Layouts. Keine versteckten kritischen Informationen. Sperren benötigen Ursache und nächste Handlung, nicht nur einen deaktivierten Button.

### Projektleiter- und QM-Oberfläche

- eigene Projekte und Produktionsfortschritt
- offene Entscheidungen, Freigaben, Konflikte und Revisionseinflüsse
- fehlende Nachweise und überfällige Schritte
- blockierende NCRs, Nacharbeiten und Produktionssperren
- Dokument- und Planeditor mit explizitem Freigabeworkflow
- Audit- und Aktenansicht

### Dashboard

Karten für aktive/verspätete Aufträge, offene Prüfungen/NCRs, gesperrte Aufträge, Nacharbeiten und heutige Fertigstellungen. Tabellen zeigen Auftrag, Produkt, Fortschritt, aktuellen Schritt, Verantwortlichen und Qualitätsstatus. Fortschritt darf gesperrte oder lokal nur vorgemerkte Abschlüsse nicht als endgültig zählen.

### Suche und Filter

Globale Suche nach Projekt, Auftrag, Kunde, Serien-/Chargen-/Bauteilnummer, Dokument/Zeichnung, Mitarbeiter und NCR. Kernerlebnis: Seriennummer eingeben oder scannen und komplette autorisierte Produktionshistorie sehen. Filter nach Zeitraum, Standort, Abteilung, Status, Produkt, Mitarbeiter, Fehlerart und Kunde.

### Barrierefreiheit und Internationalisierung

Ziel WCAG 2.2 AA für relevante Weboberflächen. Tastaturbedienung für Desktop, Screenreader-Bezeichnungen, keine reine Farbcodierung, skalierbare Texte. Texte, Einheiten, Datums-/Zahlenformate und Zeitzonen sind internationalisierbar. Datenbankzeiten in UTC, Anzeige in Benutzer-/Standortzeitzone.

---

## 13. Benachrichtigungen und Reporting

In-App-Benachrichtigungen für neue Zuweisung, freigegebenen Schritt, erforderliche Prüfung, NCR, Nacharbeit, Dokumentänderung, Produktionsstopp, Freigabe, Konflikt und Überfälligkeit. E-Mail später konfigurierbar. Benachrichtigungen sind Hinweise; sicherheitskritische Zustände werden stets aus aktueller Serverquelle geprüft.

Kennzahlen mindestens:

- First Pass Yield
- Nacharbeits- und Fehlerquote
- Fehler nach Produkt, Schritt, Abteilung und Kategorie
- Durchlauf- und Bearbeitungszeiten
- Plan-/Ist-Zeit
- offene und überfällige NCRs
- Prüfmittel mit bevorstehender/abgelaufener Kalibrierung
- Termintreue und gesperrte Zeit
- Vollständigkeit von Nachweisen

Kennzahlen müssen Definition, Zeitraum, Filter, Datenstand und Umgang mit stornierten/übersprungenen Schritten offenlegen. Berechnungen werden getestet und dürfen nicht aus UI-Zwischenzuständen abgeleitet werden.

---

## 14. Zielarchitektur

### Komponenten

- Next.js mit React und TypeScript für Web/PWA
- serverseitige API und Domänenservices; bei wachsender Last modular extrahierbar
- PostgreSQL als autoritative relationale Datenbank
- Prisma für Schema/Migrationen und typisierte Zugriffe, ergänzt um gezielte SQL-Constraints
- S3-kompatibler Objektspeicher für Dokumente, Bilder und Exporte
- Queue/Worker für Dateiverarbeitung, PDF-Erzeugung, Benachrichtigung und Integrationen
- lokale Clientdatenbank für Offline-Projektion und Outbox
- Observability mit strukturierten Logs, Metriken und Traces

Beginne als sauber modularisierter Monolith, sofern das Repository keinen anderen begründeten Ansatz verlangt. Domänenmodule mindestens: Identity & Access, Organization, Projects, Documents, Production Planning, Production Execution, Quality, Equipment, Sync, Audit, Reporting und Integrations.

### Schichtenregeln

- UI kennt View Models und Commands, nicht Datenbanktabellen.
- API validiert Syntax, Authentifizierung, Autorisierung und Mandant.
- Domänenschicht besitzt Statusregeln und Invarianten.
- Repositories kapseln Persistenz.
- Integrationen werden über Ports/Adapter angebunden.
- Audit und Outbox werden in derselben Transaktion wie fachliche Änderungen geschrieben.
- Hintergrundjobs sind idempotent und wiederholbar.

### API-Grundsätze

- versionierte HTTP/JSON-API oder gleichwertiger klarer Vertrag;
- keine generischen Mutationen für kritische Zustände;
- Idempotency Key für alle mobilen Schreiboperationen;
- ETag/Versionsnummer für konkurrierende Bearbeitung;
- RFC-7807-ähnliche Fehler mit Code, Meldung, Objekt und Korrelation;
- Cursor-Pagination, serverseitige Filter und stabile Sortierung;
- Upload über kurzlebige signierte URLs, Abschluss per Hashbestätigung;
- Rate Limits, Größenlimits und MIME-/Malwareprüfung;
- OpenAPI oder gleichwertige maschinenlesbare Dokumentation.

Beispielendpunkte:

```text
POST /api/v1/work-steps/{id}/start
POST /api/v1/work-steps/{id}/completion-submissions
POST /api/v1/work-steps/{id}/skip-requests
POST /api/v1/completion-submissions/{id}/validate
POST /api/v1/non-conformances
POST /api/v1/production-holds
POST /api/v1/documents/{id}/revisions
POST /api/v1/document-revisions/{id}/release
GET  /api/v1/sync/changes?cursor=...
POST /api/v1/sync/commands
```

### Konsistenz und Events

PostgreSQL-Transaktionen schützen kritische Invarianten. Nutze Transactional Outbox für zuverlässige Events. Eventnamen in Vergangenheitsform, versionierte Schemas und Korrelations-/Ursachen-ID. Externe Consumer dürfen keine interne Tabelle voraussetzen.

---

## 15. Datenmodell – fachlicher Mindestumfang

Alle Tabellen besitzen UUID, `organization_id` soweit fachlich, Erstell-/Änderungszeit, Version und angemessene Foreign Keys/Indizes. Geld, Messwerte und Zeitdauern erhalten geeignete präzise Typen; keine Floats für toleranzkritische Werte.

### Identität und Organisation

- `organizations`, `sites`, `departments`, `work_centers`
- `users`, `employees`, `sessions`, `devices`
- `roles`, `permissions`, `user_roles`, `role_permissions`
- `qualifications`, `employee_qualifications`, `delegations`

### Projekt und Produkt

- `customers`, `projects`, `project_members`
- `products`, `assemblies`, `parts`, `product_structures`
- `production_orders`, `production_units`, `serial_numbers`, `batches`
- `order_assignments`, `order_holds`

### Dokumente und Planung

- `documents`, `document_revisions`, `document_approvals`
- `document_links`, `drawing_markers`, `document_acknowledgements`
- `production_plans`, `production_plan_revisions`
- `plan_steps`, `plan_step_dependencies`, `plan_step_requirements`
- `step_document_bindings`, `checklist_templates`, `checklist_items`
- `inspection_characteristics`, `photo_requirements`

### Ausführung

- `work_step_instances`, `work_step_releases`, `work_step_assignments`
- `step_executions`, `completion_submissions`, `step_confirmations`
- `checklist_responses`, `measurement_results`, `comments`
- `evidence_files`, `photo_evidence`, `second_approvals`
- `skip_requests`, `revision_conflicts`, `conflict_decisions`

### Qualität

- `non_conformances`, `ncr_evidence`, `ncr_dispositions`
- `rework_steps`, `reinspections`, `quality_holds`
- `capa_records`, `corrective_actions`, `effectiveness_checks`
- `measuring_equipment`, `calibrations`, `equipment_usage`

### Betrieb und Nachweis

- `audit_events` (append-only)
- `outbox_events`, `inbox_messages`, `sync_commands`, `sync_cursors`
- `notifications`, `report_jobs`, `production_dossiers`, `export_manifests`
- `integration_endpoints`, `integration_runs`, `webhook_deliveries`
- `iso_process_mappings`

### Wesentliche Constraints

- Dokumentnummer plus Revision eindeutig je Organisation.
- Auftrags-, NCR-, Serien- und Chargennummer gemäß Fachscope eindeutig.
- maximal eine aktive Freigabe je Schrittinstanz und Version.
- Freigabe verweist zwingend auf Planrevision und Requirements-Version.
- zweiter Prüfer ungleich Ausführender via Domain Rule und DB-Constraint, soweit modellierbar.
- Audit-Daten nicht aktualisier-/löschbar für App-Rolle.
- Messwert speichert Einheit und Grenzwerte zum Ausführungszeitpunkt als Snapshot.
- Completion Submission referenziert unveränderlich alle verwendeten Dokumentrevisionen.
- Idempotency Key eindeutig pro Organisation/Gerät/Operation.
- Soft Delete nur bei zulässigen Stammdaten; historisch referenzierte Daten werden archiviert.

---

## 16. Sicherheit, Datenschutz und Betrieb

### Sicherheit

- etablierter OIDC/OAuth2-Provider oder sichere Auth-Lösung;
- MFA für privilegierte Rollen, sichere Passwort-/PIN-Hashes und Sessionrotation;
- kurze Access Tokens, serverseitiger Widerruf und Gerätezulassung;
- TLS überall, Verschlüsselung ruhender Daten und verwaltete Secrets;
- Least Privilege für DB, Storage, Queue und Mitarbeiterrollen;
- Schutz vor CSRF, XSS, SSRF, SQL Injection, IDOR und unsicherem Dateiupload;
- autorisierte Objektabfragen mit Mandantenprüfung auf jeder Route;
- Content Security Policy, sichere Cookies und Security Header;
- Malware-Scan, MIME-Sniffing-Abwehr, Dateigrößen-/Typgrenzen;
- Abhängigkeitsscans, SAST, Secret Scan und regelmäßige Restore-Tests.

### Datenschutz / DSGVO

- Zweckbindung und Datenminimierung;
- dokumentierte Rechtsgrundlage und transparente Mitarbeiterinformation außerhalb der Software;
- rollenbasierte Sichtbarkeit personenbezogener Leistungsdaten;
- konfigurierbare Aufbewahrungs- und Löschkonzepte unter Wahrung gesetzlicher Nachweise;
- Auskunfts-/Exportprozesse und kontrollierte Berichtigung durch Nachtrag;
- keine unnötige Standort-, Biometrie- oder Geräteerfassung;
- Auftragsverarbeitung, Datenresidenz und Unterauftragnehmer dokumentieren;
- Datenschutz-Folgenabschätzung prüfen, insbesondere bei Mitarbeiterüberwachung.

### Backup und Wiederherstellung

Definiere RPO/RTO mit dem Auftraggeber. Verschlüsselte, versionierte Backups; Point-in-Time-Recovery für PostgreSQL; Objektversionierung; regelmäßige automatisierte Restore-Proben. Audit und Dateien müssen konsistent rekonstruierbar sein. Dokumentiere Disaster-Recovery-Runbook und Verantwortlichkeiten.

### Observability

Strukturierte, datensparsame Logs mit Korrelations-ID; Metriken für API-Latenz, Fehler, Queue, Sync-Rückstand, Uploadfehler, DB, Speicher und Freigabeablehnungen. Alarmierung ohne sensible Payloads. Health-/Readiness-Endpunkte unterscheiden Prozessverfügbarkeit und Abhängigkeiten.

---

## 17. Integrationen

ERP-Schnittstellen später über stabile Adapter:

- Projekte, Kunden, Artikel, Stücklisten und Aufträge importieren
- Status, Zeiten, Mengen, Ausschuss und Fertigmeldungen exportieren
- Mappingtabellen und Fehlerschlange mit Wiederholung
- idempotente Verarbeitung und fachliche Quarantäne bei Mappingfehlern

QR-/Barcode unterstützt Kamera und geeignete Scanner. Webhooks sind signiert, versioniert, wiederholbar und auditierbar. Keine Integration darf direkt Workflowstatus in der Datenbank manipulieren; sie nutzt dieselben Domänenkommandos.

---

## 18. Teststrategie und Qualitätsgates

### Testpyramide

- Unit Tests für Zustandsautomaten, Toleranzen, Abhängigkeiten und Rechte
- Property-/Model-based Tests für ungültige Statusfolgen und Workflowgraphen
- Integrationstests mit realem PostgreSQL und Objektspeicher-Emulator
- Contract Tests für API, Events und ERP-Adapter
- PWA-/Sync-Tests mit Verbindungsabbruch, Wiederholung und beschädigten Uploads
- End-to-End-Tests der wichtigsten Rollen und Produktionsflüsse
- Security Tests für Mandantentrennung, IDOR, Uploads, Session und Rechteentzug
- Performance-/Lasttests für Sync nach Schichtende, große Akten und Dashboard
- Accessibility- und Browser-/Tablet-Tests
- Backup-Restore- und Migrationsproben

### Unverzichtbare Negativtests

1. Offline Schritt 5 abschließen und Schritt 6 starten: Start muss blockiert sein.
2. Gefälschten `COMPLETED`-Status senden: Server weist ab und auditiert.
3. Abschlusskommando doppelt senden: exakt ein Abschluss und Auditereignis.
4. Dokumentrevision während Offline-Arbeit ändern: Konflikt, keine stille Umschreibung.
5. Berechtigung vor Synchronisation entziehen: keine automatische Freigabe.
6. Fotoanforderung nicht erfüllen: Abschluss abgelehnt.
7. Bildupload unvollständig oder Hash falsch: Abschluss abgelehnt.
8. Messwert außerhalb Toleranz: Prüfung negativ, konfigurierte NCR/Sperre.
9. Ausführender versucht eigene Vier-Augen-Prüfung: abgelehnt.
10. offene blockierende NCR: Nachfolger bleibt gesperrt.
11. abgelaufenes Prüfmittel bei Pflichtprüfung: Freigabe abgelehnt.
12. Benutzer anderer Organisation errät Objekt-ID: 404/403 ohne Datenleck.
13. parallele Syncs ändern dieselbe Entität: kontrollierter Versionskonflikt.
14. Serverausfall nach Dateiupload, vor Quittung: Wiederholung ohne Duplikat.
15. Plan mit Zyklus freigeben: Validierungsfehler.

### Definition of Done

Ein Funktionsschnitt ist fertig, wenn:

- fachliche Akzeptanzkriterien und Fehlerfälle umgesetzt sind;
- RBAC/ABAC serverseitig geprüft ist;
- Audit und Outbox transaktional geschrieben werden;
- Migration vorwärts und Wiederherstellungsweg getestet sind;
- Unit-, Integrations- und relevante E2E-Tests grün sind;
- Typecheck, Lint, Security Scan und Accessibility Check bestehen;
- Logs/Metriken und Betriebsdokumentation vorhanden sind;
- keine kritischen TODOs oder bekannten Datenintegritätsfehler offen sind.

---

## 19. MVP-Umfang

Das MVP muss einen echten, geschlossenen Produktionsfluss sicher abbilden:

1. Organisation, Benutzer, Rollen und Mitarbeiterqualifikation
2. Projekte, Produkte und Produktionsaufträge
3. Dokumentupload, Revision, Prüfung und Freigabe
4. Fertigungsplan mit linearen Schritten und Pflichtanforderungen
5. serverseitige Freigabe und Ausführung eines Schritts
6. Tablet-Oberfläche mit Checkliste, Foto, Messwert und Bestätigung
7. Offline-Bearbeitung bereits freigegebener Schritte mit Outbox
8. serverseitiger Abschluss und gesperrter Folgeschritt bis Bestätigung
9. einfache NCR mit blockierend/nicht blockierend
10. Nacharbeit und Nachprüfung
11. Vier-Augen-Prüfung
12. append-only Audit Trail
13. Seriennummernsuche und einfache digitale Produktionsakte als PDF
14. Basisdashboard und In-App-Benachrichtigungen
15. Backup, Monitoring und zentrale Sicherheitsmaßnahmen

Für das MVP nicht erforderlich, aber architektonisch vorzubereiten: komplexe parallele Graphen, umfassende CAPA, fortgeschrittene BI, mehrere ERP-Systeme, qualifizierte elektronische Signatur, native Apps und vollautomatische CAD-Verarbeitung.

---

## 20. Entwicklungsphasen

### Phase 0 – Discovery und fachliche Validierung

- Stakeholder, Standorte, Auftragstypen und reale Hallenbedingungen erheben
- Beispielpläne, Formulare, NCRs, Akten und Rollen analysieren
- Begriffe und Verantwortlichkeiten als Glossar festlegen
- regulatorische, vertragliche und Aufbewahrungsanforderungen bestätigen
- Risiken, Annahmen und Nichtziele dokumentieren

### Phase 1 – Fundament

- Repository, CI/CD, Umgebungen und Coding Standards
- Authentifizierung, Organisation/Mandant und RBAC
- PostgreSQL/Prisma, Migrationen, Audit, Outbox
- sichere Dateiablage, Observability und Testgrundlage

### Phase 2 – Dokumente und Planung

- Projekte, Produkte, Aufträge
- Dokumentidentität, Revision und Freigabe
- Viewer und Schritt-Dokumentbindung
- Fertigungsplan, Anforderungen und Freigabeworkflow

### Phase 3 – Online-Ausführung

- Tablet-UI und Zuweisungen
- serverseitige Schrittfreigabe
- Checklisten, Fotos, Messwerte und Bestätigung
- Abschlussvalidierung und Nachfolgerfreigabe

### Phase 4 – Qualität

- Prüfungen und Vier-Augen-Prinzip
- NCR, Sperre, Nacharbeit und Nachprüfung
- Prüfmittel/Kalibrierung
- Revisionsauswirkungsanalyse

### Phase 5 – Offline und Synchronisation

- lokale Datenbank, Cache, Outbox und Upload Resume
- Release Token und Offline-Startregel
- Konfliktcenter und sichere Wiederholung
- systematische Netzwerkausfall- und Gerätefalltests

### Phase 6 – Akte, Reporting und Integrationen

- Produktionsakte, Manifest und Export
- Suche, Dashboard und Kennzahlen
- Benachrichtigungen
- ERP-/Webhook-Grundlage

### Phase 7 – Pilot und Härtung

- Pilot an begrenzter Produktlinie
- Usability unter realen Bedingungen
- Performance, Penetrationstest, Restore-Probe
- Datenmigration, Schulung und Supportprozess
- kontrollierter Rollout mit Rückfallplan

---

## 21. Coding- und Architekturstandards

- TypeScript strikt; keine unkontrollierten `any`.
- Domänenbegriffe konsistent und im Glossar dokumentiert.
- Kleine, testbare Module; Geschäftsregeln nicht in UI-Komponenten oder ORM-Hooks verstecken.
- Geld/Messwerte/Einheiten fachlich typisieren.
- Externe Eingaben mit Schemas validieren; Ausgaben kontextgerecht encodieren.
- Status als explizite State Machine, nicht als verstreute Boolean-Kombinationen.
- Migrationen niemals bereits veröffentlichte Historie umschreiben lassen.
- Feature Flags für riskante Rollouts; Flags sind keine Berechtigungen.
- Keine Produktionsdaten in Tests oder Logs.
- ADRs für Auth, Offline-Speicher, Dateispeicher, Audit-Härtung, Signaturen und Mandantenmodell.
- Kommentare erklären fachliches Warum, nicht offensichtlichen Code.

---

## 22. Abnahmeszenarien

### A. Regulärer Onlinefluss

Projektleiter gibt Planrevision A und Zeichnung P-102 Rev. 04 frei. Der Server gibt Schritt 1 frei. Mitarbeiter startet, erfüllt Checkliste, Foto und Messwert, bestätigt. Server validiert, schließt Schritt 1 endgültig und gibt Schritt 2 frei. Historie und Akte referenzieren exakt Rev. 04.

### B. Verbindungsabbruch

Schritt 2 war vorab freigegeben. Verbindung fällt aus. Mitarbeiter arbeitet weiter und schließt lokal ab. Status ist `COMPLETED_PENDING_SYNC`; Schritt 3 bleibt gesperrt und kann auch aus Cache/URL nicht gestartet werden. Nach Rückkehr der Verbindung synchronisiert das Gerät. Erst nach erfolgreicher Servervalidierung wird Schritt 2 `COMPLETED` und Schritt 3 `READY`.

### C. Revisionskonflikt

Während Schritt 2 offline ausgeführt wird, ersetzt P-102 Rev. 05 die Rev. 04. Synchronisation erzeugt `REVISION_CONFLICT`; Ausführung bleibt als Rev. 04 dokumentiert. Der Auftrag wird nicht fortgesetzt, bis eine berechtigte Person mit Begründung eine zulässige Folgeentscheidung getroffen hat.

### D. Blockierende Abweichung

Messwert liegt außerhalb Toleranz. System erzeugt oder verlangt NCR, serverseitig blockierend. Nacharbeit und Nachprüfung werden ausgeführt. Erst deren Freigabe löst die Sperre und ermöglicht die Prüfung des regulären Nachfolgers.

### E. Vier Augen

Mitarbeiter A führt aus. Derselbe Account kann die unabhängige Prüfung nicht bestätigen. Qualifizierter Mitarbeiter B prüft und signiert. Erst dann kann der Server abschließen.

### F. Audit und Akte

Auditor sucht eine Seriennummer und sieht mit Berechtigung lückenlos Auftrag, Plan-/Dokumentrevisionen, Schritte, Beteiligte, Zeiten, Fotos, Messwerte, NCR, Nacharbeit und Freigaben. Ein exportiertes ZIP-Manifest bestätigt die enthaltenen Dateien per Hash.

---

## 23. Fachliches Glossar

- **Fertigungsplan:** freizugebende, revisionierte Vorlage des Produktionsablaufs.
- **Arbeitsschrittinstanz:** konkrete Ausführung eines Planschritts in einem Auftrag.
- **Serverfreigabe:** autoritative Erlaubnis, einen konkreten Schritt zu starten.
- **Lokaler Abschluss:** vollständige Erfassung auf dem Gerät ohne endgültige Serverbestätigung.
- **NCR:** dokumentierte Nichtkonformität/Abweichung.
- **Nacharbeit:** kontrollierte Tätigkeit zur Behandlung einer Nichtkonformität.
- **Nachprüfung:** erneute Prüfung nach Nacharbeit oder Entscheidung.
- **Produktionsakte:** reproduzierbarer Nachweis des tatsächlichen Herstellungsverlaufs.
- **Revision:** unveränderliche, eindeutig identifizierte Version eines Dokuments oder Plans.
- **Audit Trail:** append-only Historie relevanter Handlungen und Entscheidungen.
- **Release Token:** Nachweis einer konkreten, zuvor serverseitig erteilten Schrittfreigabe.

---

## 24. Schlussanweisung

Behandle diese Spezifikation als verbindliche fachliche Grundlage. Liefere zuerst Architektur, Modelle, UX-Flows, Risiken, offene Entscheidungen und phasenweisen Plan. Weise explizit nach, wie die zentrale Offline-Regel technisch und durch Tests garantiert wird. Implementiere dann in kleinen, lauffähigen vertikalen Schnitten.

Die wichtigste Invariante des gesamten Systems lautet:

> Ein bereits serverseitig freigegebener Arbeitsschritt darf offline bearbeitet und lokal fertiggestellt werden. Ein Folgeschritt darf jedoch erst begonnen werden, nachdem der Server den aktuellen Abschluss validiert, endgültig bestätigt und den Folgeschritt ausdrücklich freigegeben hat.

Kein Client, Administrator-Shortcut, Import, Hintergrundjob oder Integrationsadapter darf diese Invariante umgehen.
