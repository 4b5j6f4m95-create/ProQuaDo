# 7. Wireflows für Produktion, Projektleitung, QM und Administration

**Dokumentversion:** 1.0
**Status:** Foundation
**Gültig ab:** 2026-08-08

---

## Designprinzipien

- **Tablet-First** für Produktion: große Touch-Ziele (min. 44×44px), hohe Kontraste, Handschuhbetrieb
- **Wahrheitstreue:** UI zeigt niemals einen lokalen Zwischenstand als serverseitig freigegeben
- **Kein verstecktes Kritisches:** Sperren zeigen immer Ursache + nächste Handlung
- **WCAG 2.2 AA:** Tastaturbedienung, Screenreader-Labels, keine reine Farbcodierung

---

## A. Produktionsmitarbeiter-Flow (Tablet)

### A1. Login → Meine Aufträge

```
┌────────────────────────────────────┐
│  ProQuaDo                    👤 MK │
├────────────────────────────────────┤
│  Meine Aufträge          🟢 Online │
├────────────────────────────────────┤
│ ┌──────────────────────────────┐  │
│ │ AUF-2026-0142                 │  │
│ │ Gehäuse Baugruppe A            │  │
│ │ Schritt 7 von 18 · READY       │  │
│ │ [Öffnen →]                     │  │
│ └──────────────────────────────┘  │
│ ┌──────────────────────────────┐  │
│ │ AUF-2026-0139                 │  │
│ │ Schritt 3 · BLOCKED (NCR)      │  │
│ │ [Details →]                    │  │
│ └──────────────────────────────┘  │
└────────────────────────────────────┘
```

Nur relevante, berechtigte, zugewiesene Aufträge sichtbar. Status-Chips: READY (grün), IN_PROGRESS (blau), BLOCKED (rot), COMPLETED_PENDING_SYNC (gelb/orange).

### A2. Arbeitsschritt-Ansicht

```
┌────────────────────────────────────┐
│ ← AUF-2026-0142        🟢 Online   │
├────────────────────────────────────┤
│ Schritt 7 von 18                   │
│ Status: IN_PROGRESS                │
│                                     │
│ Gehäusedeckel montieren            │
│ Zeichnung P-102 · Rev. 04 ✓        │
│                                     │
│ ┌─────────┐ ┌─────────┐ ┌────────┐│
│ │Zeichnung│ │ Foto     │ │Messwert││
│ │ öffnen  │ │ aufnehmen│ │eingeben││
│ └─────────┘ └─────────┘ └────────┘│
│                                     │
│ Checkliste (3/5)                   │
│ ☑ Sichtprüfung Gehäuse             │
│ ☑ Schrauben angezogen (4x)         │
│ ☑ Dichtung eingelegt               │
│ ☐ Foto Typenschild                 │
│ ☐ Messwert Spaltmaß                │
│                                     │
│ [Abweichung melden]                │
│                                     │
│ ┌────────────────────────────────┐│
│ │  Abschließen (2 fehlend)        ││
│ │  [deaktiviert]                  ││
│ └────────────────────────────────┘│
└────────────────────────────────────┘
```

**Regel:** Abschlussbutton wird erst aktiv nach lokaler Vollständigkeit (nicht nach Serverprüfung – diese folgt erst beim Klick).

### A3. Foto aufnehmen

```
┌────────────────────────────────────┐
│ ← Foto: Typenschild                │
├────────────────────────────────────┤
│  ┌──────────────────────────────┐ │
│  │                                │ │
│  │      [Kamera-Vorschau]        │ │
│  │                                │ │
│  └──────────────────────────────┘ │
│         ⭕ Auslöser                │
│                                     │
│  Kategorie: [Typenschild ▾]       │
│  Beschreibung: [___________]      │
│                                     │
│  Aufgenommene Fotos: 1/1 min.     │
│  [✓ Foto 1] [+ Weiteres Foto]     │
└────────────────────────────────────┘
```

### A4. Messwert eingeben

```
┌────────────────────────────────────┐
│ ← Messwert: Spaltmaß Gehäusedeckel │
├────────────────────────────────────┤
│ Sollwert: 2.0 mm                   │
│ Toleranz: 1.8 – 2.2 mm            │
│                                     │
│ Istwert: [____2.1____] mm         │
│                                     │
│ Prüfmittel: [Messschieber #042 ▾] │
│   ✓ Kalibriert bis 2026-11-15     │
│                                     │
│ [Speichern]                        │
└────────────────────────────────────┘
```

Bei Prüfmittel abgelaufen: rotes Warnbanner "⚠ Kalibrierung abgelaufen – Messung nicht zulässig", Auswahl gesperrt.

### A5. Abschluss & Bestätigung

```
┌────────────────────────────────────┐
│ Schritt abschließen                │
├────────────────────────────────────┤
│ ✓ Checkliste vollständig           │
│ ✓ Alle Pflichtfotos vorhanden      │
│ ✓ Messwerte erfasst                │
│                                     │
│ Ich bestätige, dass ich den        │
│ Arbeitsschritt entsprechend der    │
│ angezeigten Arbeitsanweisung und   │
│ den dokumentierten Unterlagen      │
│ ausgeführt habe. Abweichungen habe │
│ ich vollständig gemeldet.          │
│                                     │
│ PIN: [• • • •]                     │
│                                     │
│ [Abbrechen]  [Bestätigen]          │
└────────────────────────────────────┘
```

### A6. Nach lokalem Abschluss (Online)

```
┌────────────────────────────────────┐
│ ✓ Schritt wird geprüft...          │
│                                     │
│ [Spinner]                          │
│                                     │
│ (kurze Serverantwort, meist <2s)   │
└────────────────────────────────────┘
       ↓ Server bestätigt
┌────────────────────────────────────┐
│ ✓ Schritt 7 abgeschlossen          │
│                                     │
│ Schritt 8 von 18 freigegeben       │
│ [Weiter →]                         │
└────────────────────────────────────┘
```

### A7. Nach lokalem Abschluss (Offline) – KRITISCH

```
┌────────────────────────────────────┐
│ 🔴 Offline                          │
│                                     │
│ ⏳ Lokal abgeschlossen –            │
│    Serverfreigabe ausstehend.       │
│                                     │
│ Ihre Daten sind sicher gespeichert │
│ und werden synchronisiert, sobald  │
│ eine Verbindung besteht.            │
│                                     │
│ [Zurück zu Meine Aufträge]         │
└────────────────────────────────────┘

──────────────────────────────────────
Nächster Schritt (Schritt 8):
┌────────────────────────────────────┐
│ 🔒 Gesperrt                         │
│                                     │
│ Für die Freigabe ist eine           │
│ Verbindung zum Server und eine      │
│ erfolgreiche Prüfung erforderlich.  │
│                                     │
│ [Nicht verfügbar]                   │
└────────────────────────────────────┘
```

**Diese Ansicht ist die visuelle Manifestation der zentralen Invariante** – sie darf unter keinen Umständen "Weiter" oder einen aktiven Button für Schritt 8 zeigen.

### A8. Sync-Konflikt (Revision geändert)

```
┌────────────────────────────────────┐
│ ⚠ Konflikt erkannt                  │
├────────────────────────────────────┤
│ Während Ihrer Offline-Arbeit an     │
│ Schritt 2 wurde die Zeichnung       │
│ P-102 von Rev. 04 auf Rev. 05       │
│ aktualisiert.                       │
│                                     │
│ Ihre Ausführung bleibt mit Rev. 04  │
│ dokumentiert. Ein Verantwortlicher  │
│ muss entscheiden, wie fortgefahren  │
│ wird.                               │
│                                     │
│ Status: Wartet auf Entscheidung     │
│ (Projektleitung/QM benachrichtigt)  │
│                                     │
│ [Details anzeigen]                  │
└────────────────────────────────────┘
```

### A9. Abweichung melden

```
┌────────────────────────────────────┐
│ ← Abweichung melden                │
├────────────────────────────────────┤
│ Fehlerart: [Maßabweichung      ▾] │
│ Beschreibung:                      │
│ [_______________________________]  │
│ [_______________________________]  │
│                                     │
│ Foto hinzufügen: [+ Foto]          │
│                                     │
│ Schweregrad: ○ Kritisch            │
│              ● Mittel               │
│              ○ Gering               │
│                                     │
│ [Abbrechen]     [Melden]           │
└────────────────────────────────────┘
```

---

## B. Projektleiter / Arbeitsvorbereitung-Flow

### B1. Dashboard

```
┌───────────────────────────────────────────────────┐
│ ProQuaDo · Projektleitung          👤 PL   🟢      │
├───────────────────────────────────────────────────┤
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │
│ │Aktive  │ │Verspätet│ │Offene  │ │Gesperrt │      │
│ │Aufträge│ │Aufträge │ │NCRs    │ │Aufträge │      │
│ │  24    │ │   3     │ │  7     │ │   2     │      │
│ └────────┘ └────────┘ └────────┘ └────────┘      │
│                                                     │
│ Offene Entscheidungen                              │
│ ┌─────────────────────────────────────────────┐  │
│ │ ⚠ REVISION_CONFLICT · AUF-2026-0142 · Sch.2  │  │
│ │   [Entscheiden →]                            │  │
│ ├─────────────────────────────────────────────┤  │
│ │ ⚠ SKIP_REQUESTED · AUF-2026-0139 · Sch.5     │  │
│ │   [Entscheiden →]                            │  │
│ └─────────────────────────────────────────────┘  │
│                                                     │
│ Auftragsübersicht                                  │
│ ┌─────────────────────────────────────────────┐  │
│ │Auftrag  │Produkt  │Fortschr.│Status  │Verantw.│  │
│ │0142     │Gehäuse A│39%      │RUNNING │M.Klein │  │
│ │0139     │Halter B │12%      │BLOCKED │J.Fuchs │  │
│ └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

**Regel:** Fortschritt "39%" zählt keine `COMPLETED_PENDING_SYNC`-Schritte als final abgeschlossen (separater visueller Marker, z.B. gestrichelter Balken-Anteil).

### B2. Dokument-Upload & Freigabe-Workflow

```
┌───────────────────────────────────────────────────┐
│ Dokument: P-102 Gehäusedeckel                      │
├───────────────────────────────────────────────────┤
│ Aktuelle Revision: 04 (RELEASED)                   │
│ Historie: 01 → 02 → 03 → 04                        │
│                                                     │
│ [Neue Revision hochladen]                          │
│                                                     │
│ Neue Revision 05 (DRAFT)                           │
│ Änderungsgrund: [_____________________]            │
│                                                     │
│ [Zur Prüfung einreichen]                           │
│                                                     │
│ ─── nach Einreichung ───                           │
│                                                     │
│ Status: IN_REVIEW                                  │
│ Prüfer: QM (J. Weber)                              │
│                                                     │
│ ─── nach Freigabe ───                              │
│                                                     │
│ ⚠ AUSWIRKUNGSANALYSE ERFORDERLICH                  │
│ 3 laufende Aufträge nutzen Rev. 04:                │
│ - AUF-2026-0142 (Schritt 2 in Bearbeitung)         │
│ - AUF-2026-0145 (noch nicht gestartet)             │
│ - AUF-2026-0098 (bereits abgeschlossen)            │
│                                                     │
│ Pro Auftrag entscheiden:                           │
│ ○ Keine Aktion  ○ Kenntnisnahme  ○ Zusatzprüfung   │
│ ○ Nacharbeit    ○ Sperren                          │
│                                                     │
│ [Entscheidungen speichern & Revision freigeben]    │
└───────────────────────────────────────────────────┘
```

### B3. Fertigungsplan-Editor

```
┌───────────────────────────────────────────────────┐
│ Fertigungsplan: Gehäuse Baugruppe A · Rev. 03      │
├───────────────────────────────────────────────────┤
│ Status: DRAFT                                      │
│                                                     │
│ Schritte (Drag & Drop, Abhängigkeiten)             │
│ ┌─────────────────────────────────────────────┐  │
│ │ 1. Materialbereitstellung                    │  │
│ │ 2. Gehäuse fräsen  ← hängt von 1 ab           │  │
│ │ 3. Gehäusedeckel montieren ← hängt von 2 ab   │  │
│ │    📷 Foto Pflicht (min 2, max 5)             │  │
│ │    📏 Messwert: Spaltmaß                      │  │
│ │    👥 Vier-Augen: Nein                        │  │
│ │ 4. Endprüfung ← hängt von 3 ab                │  │
│ │    👥 Vier-Augen: Ja (Prüfer)                 │  │
│ └─────────────────────────────────────────────┘  │
│                                                     │
│ [+ Schritt hinzufügen]                             │
│                                                     │
│ [Graph validieren] → "Keine Zyklen erkannt ✓"      │
│                                                     │
│ [Zur Prüfung einreichen]                           │
└───────────────────────────────────────────────────┘
```

### B4. Konflikt-Center (Revision Conflict Entscheidung)

```
┌───────────────────────────────────────────────────┐
│ Konflikt: REVISION_CONFLICT                        │
├───────────────────────────────────────────────────┤
│ Auftrag: AUF-2026-0142                             │
│ Schritt: 2 – Gehäuse fräsen                        │
│ Ausgeführt mit: P-102 Rev. 04 (2026-08-05, 14:32)  │
│ Aktuell gültig: P-102 Rev. 05 (seit 2026-08-06)    │
│                                                     │
│ Unterschied Rev.04→05:                             │
│ "Bohrungsdurchmesser von 8mm auf 8.2mm angepasst"  │
│                                                     │
│ Entscheidung:                                      │
│ ○ Weiterhin gültig – keine Auswirkung              │
│ ○ Zusatzprüfung erforderlich                       │
│ ○ Nacharbeit erforderlich                          │
│ ○ Wiederholung erforderlich                        │
│ ○ Produktsperre                                    │
│                                                     │
│ Begründung: [_______________________________]      │
│                                                     │
│ [Entscheidung bestätigen] (PIN erforderlich)       │
└───────────────────────────────────────────────────┘
```

---

## C. QM-Flow

### C1. NCR-Übersicht

```
┌───────────────────────────────────────────────────┐
│ Qualitätsmanagement · NCRs                         │
├───────────────────────────────────────────────────┤
│ Filter: [Alle ▾] [Blockierend ▾] [Offen ▾]        │
│                                                     │
│ ┌─────────────────────────────────────────────┐  │
│ │NCR-0089 · BLOCKING · AUF-2026-0139           │  │
│ │Maßabweichung Bohrung · Priorität: Hoch        │  │
│ │Status: ASSESSMENT_REQUIRED                    │  │
│ │[Bewerten →]                                    │  │
│ ├─────────────────────────────────────────────┤  │
│ │NCR-0090 · NON_BLOCKING · AUF-2026-0140       │  │
│ │Kosmetischer Kratzer · Priorität: Niedrig      │  │
│ │Status: OPEN                                    │  │
│ │[Bewerten →]                                    │  │
│ └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

### C2. NCR-Bewertung & Disposition

```
┌───────────────────────────────────────────────────┐
│ NCR-0089: Maßabweichung Bohrung                    │
├───────────────────────────────────────────────────┤
│ Auftrag: AUF-2026-0139 · Schritt 5                 │
│ Gemeldet von: J. Fuchs · 2026-08-08 09:15          │
│ Messwert: 8.4mm (Toleranz 8.0-8.2mm)               │
│ Foto: [Anzeigen]                                   │
│                                                     │
│ Klassifikation: ⚫ BLOCKING (automatisch, Kategorie│
│                   "Maßabweichung kritisch")        │
│                                                     │
│ Sofortmaßnahme:                                    │
│ [_______________________________]                  │
│                                                     │
│ Ursachenanalyse:                                   │
│ [_______________________________]                  │
│                                                     │
│ Disposition:                                       │
│ ○ Nacharbeit erforderlich                          │
│ ○ Konzession (mit Begründung)                      │
│ ○ Ausschuss                                        │
│                                                     │
│ [Nacharbeit erstellen] [Speichern]                 │
└───────────────────────────────────────────────────┘
```

### C3. Prüfmittelverwaltung

```
┌───────────────────────────────────────────────────┐
│ Prüfmittel                                         │
├───────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────┐  │
│ │Nr.   │Bezeichnung    │Kalibrierung │Status    │  │
│ │#042  │Messschieber   │bis 15.11.26 │✓ Aktiv   │  │
│ │#019  │Drehmomentschl.│bis 02.08.26 │⚠ 6 Tage   │  │
│ │#007  │Prüflehre      │abgelaufen   │🔴 Gesperrt│  │
│ └─────────────────────────────────────────────┘  │
│                                                     │
│ [Kalibrierung erfassen]                            │
└───────────────────────────────────────────────────┘
```

---

## D. Administrator-Flow

### D1. Benutzerverwaltung

```
┌───────────────────────────────────────────────────┐
│ Administration · Benutzer                          │
├───────────────────────────────────────────────────┤
│ [+ Benutzer einladen]                              │
│                                                     │
│ ┌─────────────────────────────────────────────┐  │
│ │Name        │Rolle(n)         │Status │Qualif.│  │
│ │M. Klein    │Worker            │Aktiv  │2 gült.│  │
│ │J. Weber    │Quality Manager   │Aktiv  │-      │  │
│ │P. Lang     │Project Lead      │Aktiv  │-      │  │
│ └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
```

### D2. Audit-Log-Ansicht (Read-Only)

```
┌───────────────────────────────────────────────────┐
│ Audit Trail                                         │
├───────────────────────────────────────────────────┤
│ Filter: [Zeitraum] [Objekttyp] [Actor]             │
│                                                     │
│ ┌─────────────────────────────────────────────┐  │
│ │2026-08-08 10:15 · work_step.completed         │  │
│ │Actor: M. Klein · Objekt: WS-2026-0142-007     │  │
│ │[Details]                                       │  │
│ ├─────────────────────────────────────────────┤  │
│ │2026-08-08 09:15 · non_conformance.raised      │  │
│ │Actor: J. Fuchs · Objekt: NCR-0089             │  │
│ │[Details]                                       │  │
│ └─────────────────────────────────────────────┘  │
│                                                     │
│ (Keine Bearbeitungsmöglichkeit – append-only)      │
└───────────────────────────────────────────────────┘
```

---

## E. Suche und Seriennummern-Historie (Kernerlebnis)

```
┌───────────────────────────────────────────────────┐
│  🔍 [SN-2026-00142_______________]  [Suchen]       │
├───────────────────────────────────────────────────┤
│ Produkt: Gehäuse Baugruppe A                        │
│ Auftrag: AUF-2026-0142                             │
│ Kunde: Musterfirma GmbH                            │
│                                                     │
│ Fertigungsplan: Rev. 03 (verwendet)                │
│ Zeichnung: P-102 Rev. 04 (verwendet)                │
│                                                     │
│ Ausführungshistorie:                               │
│ ┌─────────────────────────────────────────────┐  │
│ │✓ Schritt 1 · M. Klein · 05.08. 08:00          │  │
│ │✓ Schritt 2 · M. Klein · 05.08. 09:15 ⚠Konflikt│  │
│ │✓ Schritt 3 · M. Klein · 05.08. 10:30          │  │
│ │⏳ Schritt 7 · IN_PROGRESS                       │  │
│ └─────────────────────────────────────────────┘  │
│                                                     │
│ NCRs: 1 (NCR-0089, geschlossen)                    │
│                                                     │
│ [Produktionsakte exportieren (PDF/ZIP)]            │
└───────────────────────────────────────────────────┘
```

---

## F. Barrierefreiheit-Checkliste (WCAG 2.2 AA)

| Anforderung | Umsetzung |
|---|---|
| Tastaturbedienung | Alle interaktiven Elemente per Tab erreichbar, sichtbarer Fokusring |
| Screenreader-Labels | `aria-label` für Icon-Buttons, Statuswechsel via `aria-live` |
| Keine reine Farbcodierung | Status immer mit Text + Icon (nicht nur rot/grün) |
| Skalierbare Texte | rem-basierte Einheiten, kein Text in Bildern |
| Kontrastverhältnis | min. 4.5:1 für Text, 3:1 für UI-Komponenten |
| Touch-Ziele | min. 44×44px, ausreichend Abstand |
| Formularfehler | Inline-Fehlermeldung mit Bezug zum Feld, nicht nur Farbe |

---

## Nächste Schritte

→ **08_THREAT_MODEL_PRIVACY.md**: Bedrohungsmodell und Datenschutzkonzept
