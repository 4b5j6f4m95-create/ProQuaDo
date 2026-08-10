# 15. Schulungsunterlagen

**Dokumentversion:** 1.0
**Status:** Schulungsgrundlage (entstanden nach der Implementierung, wie docs/11–14)
**Gültig ab:** 2026-08-10

Rollenbasierte Schulung für den Piloten (docs/10, Phase 7).

**Abgrenzung:** [docs/07](07_WIREFLOWS_UX.md) beschreibt die Abläufe und Bildschirme, [docs/04](04_ROLES_PERMISSIONS_MATRIX.md) die Rechtematrix. Hier steht, **wie man das unterrichtet** — in welcher Reihenfolge, mit welcher Übung, und an welchen Stellen es erfahrungsgemäß klemmt. Bildschirmaufbauten werden nicht wiederholt, sondern verlinkt.

**Jeder beschriebene Weg existiert im Code.** Wo ein Ablauf zusätzlich durch einen automatisierten Test abgedeckt ist, steht das dabei — dann ist er nicht nur beschrieben, sondern läuft nachweislich.

---

## 1. Vor der ersten Schulung

| Voraussetzung                                                   | Sonst passiert                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| Konten angelegt und **einmal angemeldet**                        | Die Kontoverknüpfung entsteht erst beim ersten Login                  |
| Jede Person hat sich **einmal angemeldet und ihre PIN gesetzt** (unter **Mein Konto**) | Ohne PIN lässt sich kein Arbeitsschritt abschließen — und niemand kann sie stellvertretend vergeben |
| Ein Übungsauftrag je Teilnehmer, Schritt 1 auf `READY`           | Zwei Personen am selben Auftrag blockieren sich gegenseitig           |
| Tablets registriert, „Für Offline vorbereiten" einmal ausgeführt | Der Offline-Teil der Schulung fällt sonst aus                         |

**Nicht mit echten Aufträgen üben.** Ausführungsdaten hängen an einem append-only Audit-Trail — was in der Schulung erfasst wird, bleibt in der Historie stehen und lässt sich nicht wegräumen.

---

## 2. Gemeinsamer Teil (alle Rollen, ca. 20 Minuten)

**Anmelden.** Über „Mit SSO anmelden", mit den Zugangsdaten des Unternehmens.

**Die Navigation zeigt allen alles.** Übersicht, Projekte, Meine Aufträge, Abweichungen, Prüfmittel, Offline, Konflikte, Suche, Benachrichtigungen — jeder sieht jeden Eintrag. Ob dahinter etwas steht, entscheidet die Rolle: eine Seite kann leer bleiben oder eine Handlung verweigern. **Das ist kein Fehler und soll gleich zu Beginn gesagt werden**, sonst wird jeder leere Bildschirm zum Support-Fall.

**Die Bestätigungs-PIN** ist die Unterschrift. Sie wird bei allem verlangt, was zugerechnet wird: Schritt abschließen, Vier-Augen-Entscheidung, Konfliktentscheidung, Produktfreigabe. Sie ist **persönlich** und wird nicht geteilt — eine geteilte PIN macht die Zurechenbarkeit wertlos, für die das ganze System gebaut ist.

**Jeder setzt sie selbst**, unter **Mein Konto** (über den eigenen Namen rechts in der Navigation). Es gibt bewusst keinen Weg, sie für jemand anderen zu vergeben: wer sie vergibt, kennt sie. Das ist die erste Übung jeder Einheit — **vor** allem anderen, denn ohne PIN lässt sich nichts abschließen. Zwei Dinge dazu ansagen: die Demo-PIN `1234` wird abgewiesen (fortlaufende Folge), und wer seine PIN vergisst, braucht derzeit die Administration, weil das Ändern die bisherige verlangt.

**Abmelden nicht vergessen.** Rechts in der Navigation. Auf einem geteilten Tablet ist das der einzige Weg, den Benutzer zu wechseln: ohne Abmeldung meldet der Anmeldedienst stillschweigend dieselbe Person wieder an, und der Audit-Trail schreibt die Arbeit dem Vorgänger zu.

---

## 3. Produktionsmitarbeiter (WORKER) — ca. 60 Minuten

Die längste Einheit, und die einzige, die am Tablet stattfindet. Abläufe: [docs/07 A1–A9](07_WIREFLOWS_UX.md#a-produktionsmitarbeiter-flow-tablet).

### Ablauf

1. **Meine Aufträge** öffnen — hier stehen nur zugewiesene Aufträge, und je Auftrag der Schritt, der dran ist.
2. Schritt öffnen, **Anweisung und verbindliche Dokumente** lesen. Die Dokumente sind Teil des Schritts, nicht Beiwerk.
3. **Starten.**
4. Nachweise erfassen: Checkliste, Foto, Messwert — je nachdem, was der Schritt verlangt. Die Liste „Offene Anforderungen" zeigt jederzeit, was noch fehlt.
5. **Abschließen** mit PIN.
6. Der Nachfolger wird **vom Server** freigegeben, nicht vom Tablet.

*Durch einen automatisierten Test abgedeckt: `work-step-completion.spec.ts`.*

### Wo es klemmt

- **„Der nächste Schritt ist gesperrt."** Richtig so. Ein Nachfolger öffnet sich erst, wenn der Server den Vorgänger geprüft **und** freigegeben hat. Auf dem Tablet auf „fertig" zu tippen genügt nicht — das ist die Kernzusicherung des Systems, kein Ladeproblem.
- **„Der Abschließen-Knopf ist grau."** Es fehlt ein Nachweis. Die Liste „Offene Anforderungen" nennt ihn. Ein **NOK in der Checkliste** blockiert den Abschluss ebenfalls: eine offene Abweichung ist kein Abschluss. Entweder Antwort korrigieren oder über **Abweichung melden** dokumentieren.
- **Messwert außerhalb der Toleranz.** Er lässt sich erfassen und der Schritt lässt sich abschließen — die Abweichung entsteht dabei **automatisch** und blockiert die Linie. Absichtlich nicht schon beim Tippen: ein korrigierter Zahlendreher darf keine Sperre auslösen. *Test: `work-step-completion.spec.ts`.*
- **Prüfmittel abgelaufen** ⇒ die Messung wird abgewiesen. Kein Bedienfehler; das Prüfmittel muss kalibriert werden.

### Offline (der Teil, der am meisten Nachfragen erzeugt)

Ablauf: **Offline** öffnen → **Für Offline vorbereiten** (mit Verbindung!) → arbeiten → **Jetzt synchronisieren**, sobald wieder Netz da ist.

- **Der grüne Punkt lügt manchmal.** „🟢 Online" meldet, ob das *Gerät* im Netz ist — nicht, ob der Server erreichbar ist. Bei einem Serverausfall steht dort weiter grün. Die Synchronisation hängt nicht daran: sie scheitert dann sichtbar und **behält die Warteschlange**.
- **Nichts geht verloren.** Erfasste Arbeit liegt verschlüsselt auf dem Gerät und übersteht Neuladen und Neustart. Sie ist erst dann beim Server, wenn die Synchronisation „übernommen" meldet.
- **Ein anderer Benutzer am selben Tablet** wird abgelehnt, solange nicht übertragene Arbeit vorliegt. Das ist Absicht: fremde Arbeit stillschweigend zu löschen wäre das Gegenteil dessen, was das System verspricht. Erst synchronisieren, dann wechseln.

*Der Offline-Rückfall ist durch `offline-shell.spec.ts` abgedeckt.*

### Übung

Einen Schritt vollständig durchführen — mit Checkliste, Messwert und PIN. Danach **bewusst** einen Messwert außerhalb der Toleranz erfassen und beobachten, dass die Abweichung erst beim Abschluss entsteht. Zum Schluss: Netz trennen, einen Schritt offline erfassen, wieder verbinden, synchronisieren.

---

## 4. Projektleitung (PROJECT_LEAD) — ca. 45 Minuten

Abläufe: [docs/07 B](07_WIREFLOWS_UX.md#b-projektleiter--arbeitsvorbereitung-flow).

### Ablauf

Projekt anlegen → Dokumente hochladen und **einreichen** → (QM genehmigt und gibt frei) → Fertigungsplan anlegen, Schritte mit Anforderungen und Abhängigkeiten → **verbindliche Dokumente an die Schritte binden** → Plan einreichen → (QM genehmigt) → Plan **freigeben**.

*Die Dokumentbindung ist durch `document-binding.spec.ts` abgedeckt, der Upload durch `document-upload.spec.ts`.*

### Wo es klemmt

- **Binden geht nur im Entwurf.** Nach dem Einreichen des Plans lässt sich nichts mehr binden oder entfernen. Das schützt die Ausführungshistorie — und heißt: erst vollständig binden, dann einreichen.
- **Zur Auswahl stehen nur freigegebene Revisionen des eigenen Projekts.** Steht dort ein Hinweis statt einer Liste, fehlt die Freigabe durch QM — nicht die Berechtigung.
- **Eine Revision je Schritt nur einmal.** Der zweite Versuch wird abgewiesen; das ist keine Fehlbedienung, sondern eine Zusicherung (der Dokumentsatz geht in den Freigabe-Token ein).
- **Plan mit Zyklus** ⇒ Validierungsfehler beim Einreichen. Abhängigkeiten prüfen.
- **Abschnitt 9 der Akte ist sichtbar, das Freigabeformular nicht.** Die Projektleitung darf die Produktfreigabe **sehen**, nicht erteilen. *Test: `product-release.spec.ts`.*

### Übung

Einen Plan mit zwei voneinander abhängigen Schritten anlegen, eine freigegebene Zeichnung an Schritt 1 binden, absichtlich dieselbe Revision ein zweites Mal binden (wird abgewiesen), Plan einreichen — und danach versuchen, die Bindung zu entfernen.

---

## 5. Qualitätsmanagement (QUALITY_MANAGER) — ca. 60 Minuten

Abläufe: [docs/07 C](07_WIREFLOWS_UX.md#c-qm-flow).

### Ablauf

Dokumente und Pläne **genehmigen** → Prüfmittel anlegen und kalibrieren → Abweichungen bewerten (Sofortmaßnahme, Nacharbeit, Nachprüfung, Disposition) → Vier-Augen-Entscheidungen → **Produktfreigabe** in Abschnitt 9 der Akte.

*Die Produktfreigabe ist durch `product-release.spec.ts` abgedeckt, der Aktenexport durch `dossier-export.spec.ts`.*

### Wo es klemmt

- **„Abgeschlossen" ist nicht „freigegeben".** Der wichtigste Satz dieser Einheit. Dass ein Auftrag fertig ist und nichts offen steht, macht die Freigabe nur **möglich** — sie entsteht nicht von selbst. Es gibt sie erst, wenn jemand sie mit Begründung und PIN erteilt.
- **Freigeben genau einmal, ablehnen beliebig oft.** „Abgelehnt → Nacharbeit → freigegeben" ist der Normalfall; die Ablehnung bleibt dauerhaft lesbar. Eine erteilte Freigabe zurückzunehmen ist ein **Rückruf**, keine Korrektur — und kein Vorgang in diesem Bildschirm.
- **Freigeben geht erst bei abgeschlossenem Auftrag ohne offene blockierende Abweichung oder Sperre.** Ablehnen dagegen jederzeit.
- **Die Begründung ist Pflicht** und wird kopiert festgehalten — mit dem Stand, der zum Entscheidungszeitpunkt galt. Eine spätere Datenänderung schreibt eine getroffene Entscheidung nicht um.
- **Vier-Augen: Ausführender ≠ Prüfer**, erzwungen von Anwendung und Datenbank. Wer den Schritt ausgeführt hat, kann ihn nicht selbst bestätigen.
- **Nacharbeit ist ein eigener Schritt**, kein Wiederöffnen. Der fehlerhafte Erstversuch bleibt sichtbar in der Historie stehen — das ist gewollt und die häufigste Rückfrage in dieser Einheit.

### Übung

Eine gemeldete Abweichung vollständig durchführen: bewerten, Nacharbeit anlegen, Nachprüfung, Disposition. Danach Abschnitt 9 einer abgeschlossenen Akte öffnen, **zuerst ablehnen** (mit Begründung und PIN), dann freigeben — und beobachten, dass beide Entscheidungen stehen bleiben.

---

## 6. Produktionsleitung (PRODUCTION_MANAGER) — ca. 30 Minuten

### Ablauf

Produktionsauftrag **anlegen** auf einem freigegebenen Plan → **einplanen** → **freigeben** → einem Mitarbeiter **zuweisen**. Erst danach steht er unter „Meine Aufträge".

Dazu: Produktionssperren setzen, Abweichungen melden, Übersicht und Berichte.

### Wo es klemmt

- **Ohne freigegebenen Plan kein Auftrag.** Ein Plan im Entwurf oder in Prüfung steht nicht zur Auswahl.
- **Ohne Zuweisung sieht der Mitarbeiter nichts.** Der häufigste „Bei mir steht nichts"-Anruf.
- **Der Aktenfortschritt zählt nur serverbestätigte Schritte.** Was auf einem Tablet lokal abgeschlossen, aber noch nicht synchronisiert ist, erscheint getrennt und geht **nicht** in die Prozentzahl ein. Das ist keine Verzögerung der Anzeige, sondern dieselbe Invariante wie überall sonst.

### Übung

Einen Auftrag von der Anlage bis zur Zuweisung führen und anschließend am Tablet des Mitarbeiters nachsehen, dass er dort erscheint.

---

## 7. Prüfer (INSPECTOR) — ca. 20 Minuten

Kurz, aber eigenständig: **nur diese Rolle darf die Nachprüfung ausführen** (`reinspection.execute`) und Vier-Augen-Entscheidungen treffen.

Die Nachprüfung erbt die Anforderungen des ursprünglichen Planschritts — dieselben Checklisten, Fotos und Messwerte wie die Erstausführung. Das ist bewusst konservativ und wirkt schwergängig; der Grund gehört in die Schulung, sonst wird es als Fehler gemeldet.

---

## 8. Administration (ADMIN) — ca. 30 Minuten

Benutzer, Rollen, Standorte, Geräte, Integrationen.

### Was hier gelernt werden muss, weil es sonst niemand tut

- **Nach jedem Release den Seed laufen lassen** (`pnpm exec prisma db seed`). Neue Berechtigungen kommen nur so in bestehende Organisationen; ohne das antwortet die Anwendung mit `PERMISSION_DENIED` für Rechte, die es im Code längst gibt. Siehe [docs/14 §1.1](14_RUNBOOK.md).
- **Verlorenes Tablet fernsperren** — sofort, nicht nach Rücksprache. Siehe [docs/14 §3.4](14_RUNBOOK.md).
- **Höchstens 10 aktive Geräte je Benutzer.** Gesperrte zählen nicht mit; die Grenze wird nicht angehoben, sondern alte Geräte werden gesperrt.
- **Die PIN-Sperre kann die Administration nicht aufheben** — und soll es nicht. Sie löst sich nach spätestens 15 Minuten selbst. Wer hier eine Ausnahme baut, bekommt geteilte PINs.

Das Betriebs-Runbook ([docs/14](14_RUNBOOK.md)) ist für diese Rolle die eigentliche Unterlage; dieser Abschnitt ist nur die Einführung dazu.

---

## 9. Die fünf Missverständnisse, die Support-Anrufe erzeugen

In jeder Einheit ansprechen, unabhängig von der Rolle:

1. **„Abgeschlossen" ist nicht „freigegeben".** Zwei verschiedene Vorgänge, zwei verschiedene Personen.
2. **Grün heißt nicht, dass der Server erreichbar ist.** Es heißt, dass das Gerät im Netz ist.
3. **Die PIN-Sperre löst sich selbst.** Niemand muss angerufen werden, niemand kann helfen — nach spätestens 15 Minuten geht es weiter.
4. **Konflikte werden entschieden, nicht weggeklickt.** Jeder Konflikt ist offline erfasste Arbeit, die jemand beurteilen muss (PL oder QM, mit PIN).
5. **Ein gesperrter Folgeschritt ist kein Fehler.** Er ist die Zusicherung, für die es dieses System gibt.

---

## 10. Was sich nicht schulen lässt, bevor der Pilot läuft

- **Wie sich das Tablet mit Handschuhen bedient.** Die Zielgrößen sind geprüft (WCAG 2.2 AA, einschließlich `target-size`), aber ein automatischer Test sagt nichts darüber, ob es sich in der Halle gut anfühlt.
- **Wie oft die Verbindung wirklich abreißt.** Davon hängt ab, wie viel Gewicht der Offline-Teil bekommen muss.
- **Welche Fehler tatsächlich passieren.** Die Liste in §9 ist aus der Konstruktion abgeleitet, nicht aus Beobachtung. Nach dem Piloten gehört sie ersetzt durch die, die wirklich angerufen haben.

**Wer schult, sollte danach ergänzen, wonach gefragt wurde.** Eine Schulungsunterlage, die nach dem ersten Durchgang unverändert bleibt, hat niemandem zugehört.
