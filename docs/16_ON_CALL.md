# 16. Eskalation und Bereitschaft

**Dokumentversion:** 1.0
**Status:** Betriebsorganisation (Vorlage — enthält Entscheidungen, die nicht im Code stehen)
**Gültig ab:** 2026-08-10

Wer bei welchem Ausfall was tut, in welcher Frist, und wer entscheidet.

**Abgrenzung:** [docs/14](14_RUNBOOK.md) sagt, **wie** eine Störung behoben wird. Hier steht, **wer sie wann bearbeitet und wann eskaliert wird**.

**Dieses Dokument kann nicht fertig sein.** Wer Bereitschaft hat, über welchen Kanal er erreicht wird, ab wann geweckt wird und wer einen Rückfall entscheiden darf, steht nicht im Code und kann hier nicht erraten werden. Alles Offene ist mit **[FESTZULEGEN]** markiert. Der technische Teil — welcher Ausfall was für die Halle bedeutet — ist dagegen aus dem System abgeleitet und belastbar.

---

## 1. Der Maßstab: was die Halle noch kann

Die Schwere eines Ausfalls bemisst sich hier **nicht** an der Zahl der betroffenen Komponenten, sondern daran, ob in der Fertigung weitergearbeitet werden kann. Das ist bei diesem System eine andere Rechnung als üblich, weil der Offline-Betrieb kein Notbehelf ist, sondern Entwurf: **ein vorbereitetes Tablet arbeitet ohne Server weiter**, und die erfasste Arbeit liegt verschlüsselt und dauerhaft auf dem Gerät, bis synchronisiert werden kann.

| Ausfall                              | Halle kann …                                                                 | Schwere |
| ------------------------------------- | ------------------------------------------------------------------------------ | ------- |
| **Datenbank weg**                     | vorbereitete Tablets: weiterarbeiten. Alles Serverseitige steht: keine neuen Zuweisungen, keine Freigaben, keine Akte | **1** |
| **Alle Anwendungsinstanzen weg**      | wie oben                                                                        | **1**   |
| **Objektspeicher weg**                | arbeiten, aber **keine Fotos und Dokumente** — Schritte mit Fotopflicht bleiben offen; kein Export | **2** |
| **clamd weg**                         | arbeiten, aber **kein Nachweis-Upload** wird angenommen (`degraded`, `uploadsBlocked`) | **2** |
| **Identitätsanbieter weg**            | mit laufender Sitzung weiterarbeiten (**8 Stunden, eine Schicht**), aber **niemand kann sich neu anmelden** | **2**, ab Schichtwechsel **1** |
| **Einzelne Instanz weg**              | alles, der Proxy leitet um                                                      | **3**   |
| **Sync langsam, „too many clients"**  | arbeiten; Übertragungen stauen sich, gehen aber nicht verloren                   | **3**   |
| **Webhook-Zustellung steht**          | alles. Ein Fremdsystem bekommt nichts, gestapelt als `PENDING`                   | **4**   |

**Zwei Punkte, die man nicht übersieht, wenn man diese Tabelle kennt:**

- **Der Identitätsanbieter ist der unterschätzte Einzelpunkt.** Sein Ausfall wirkt harmlos, solange alle angemeldet sind — und wird zum Stillstand, sobald die Schicht wechselt. Die Sitzungsdauer von acht Stunden ist damit auch die Frist, in der er wieder stehen muss.
- **Ein Serverausfall ist kein Datenverlust.** Was auf den Tablets liegt, bleibt dort. Der Druck bei Schwere 1 kommt aus dem, was *nicht* mehr entschieden werden kann — Freigaben, Zuweisungen, Abweichungen —, nicht aus drohendem Verlust.

---

## 2. Fristen

Aus den nichtfunktionalen Anforderungen (docs/01): **Verfügbarkeit 99,5 %**, **RPO ≤ 1 h**, **RTO ≤ 4 h**.

| Schwere | Reaktion (Bearbeitung beginnt) | Ziel für Behebung             |
| ------- | ------------------------------ | ------------------------------- |
| 1       | **[FESTZULEGEN]**, Vorschlag: 15 min | innerhalb RTO, also ≤ 4 h  |
| 2       | **[FESTZULEGEN]**, Vorschlag: 1 h    | vor Beginn der nächsten Schicht |
| 3       | nächster Arbeitstag            | im laufenden Sprint             |
| 4       | nächster Arbeitstag            | ohne feste Frist                |

Die Vorschläge sind aus RTO und Schichtlänge abgeleitet, nicht ausgehandelt. **Sie ersetzen keine Vereinbarung** — insbesondere hängt Schwere 1 daran, ob überhaupt außerhalb der Geschäftszeiten gearbeitet wird.

**[FESTZULEGEN]: Wird rund um die Uhr Bereitschaft gestellt?** Die Antwort folgt aus dem Schichtmodell. Wird nur einschichtig gefertigt, ist eine 24/7-Bereitschaft schwer zu begründen; bei Nacht- oder Wochenendschicht ist sie zwingend, weil ein Ausfall dann sonst bis zum Morgen steht.

---

## 3. Woher der Alarm kommt

Technische Quellen stehen in [docs/14 §2](14_RUNBOOK.md). Das Wichtigste in einem Satz, weil es der häufigste Einrichtungsfehler ist:

> **Nicht auf den HTTP-Status von `/api/health/ready` alarmieren.** Bei totem Virenscanner antwortet er mit **200** und `status: "degraded"`. Alarmiert wird auf `checks.database`, `checks.malwareScanner` und `scannerKind`.

Die zweite Quelle ist die Halle. **[FESTZULEGEN]: über welchen Weg meldet eine Schicht eine Störung** — und wer entscheidet dort, dass es eine ist. Ohne diesen Weg wird die erste echte Störung über fünf verschiedene Kanäle gleichzeitig gemeldet.

---

## 4. Eskalationsstufen

| Stufe | Wer                                              | Wann                                                        |
| ----- | ------------------------------------------------ | ------------------------------------------------------------- |
| 1     | Bereitschaft Betrieb — **[FESTZULEGEN]**         | jeder Alarm                                                   |
| 2     | Anwendungsverantwortliche — **[FESTZULEGEN]**    | Schwere 1 nach **[FESTZULEGEN]** min ohne Fortschritt         |
| 3     | Produktionsleitung + Leitung IT — **[FESTZULEGEN]** | Schwere 1 länger als eine halbe Schicht, oder Datenverlust im Raum |

**Bei Verdacht auf Datenverlust oder unbefugten Zugriff wird sofort auf Stufe 3 eskaliert**, ohne Zwischenstufe und ohne eigene Untersuchung vorher. Der Audit-Trail ist die Grundlage jeder späteren Aufarbeitung; wer vorher „aufräumt", zerstört sie.

**[FESTZULEGEN]: Kontaktkanal je Stufe** — und ein zweiter Weg für den Fall, dass der erste am selben Ausfall hängt.

---

## 5. Entscheidungsrechte im Störfall

| Entscheidung                                | Wer darf                                            |
| ------------------------------------------- | ----------------------------------------------------- |
| Neustart einer Instanz                      | Bereitschaft                                          |
| Gerät fernsperren                           | Bereitschaft (Rolle ADMIN)                            |
| Rückfall auf die vorige Version             | **[FESTZULEGEN]** — Vorschlag: Stufe 2                |
| Wiederherstellung aus Backup                | **[FESTZULEGEN]** — Vorschlag: Stufe 3, nie allein    |
| Fertigung anhalten                          | **Produktionsleitung**, nicht die IT                  |

Die letzte Zeile ist die wichtigste: **ob weitergefertigt wird, entscheidet die Fertigung.** Die IT liefert die Lage — was geht noch, was nicht, wie lange —, nicht das Urteil.

---

## 6. Was die Bereitschaft nie tut

Vollständige Begründungen in [docs/14 §4](14_RUNBOOK.md). Im Störfall zählt die Kurzform, weil genau dann der Griff danach am nächsten liegt:

- **Keine Zeile in `audit_events` ändern oder löschen.** Auch nicht „nur die eine kaputte".
- **Keine PIN-Sperre aufheben.** Sie löst sich nach höchstens 15 Minuten selbst; es gibt keinen Weg dafür, und das ist Absicht.
- **Kein `MALWARE_SCANNER=stub`**, um Uploads wieder zum Laufen zu bringen. Lieber keine Uploads als ungeprüfte.
- **Konflikte nicht per SQL wegräumen.** Jeder ist offline erfasste Arbeit, die jemand beurteilen muss.
- **Keine Grenze anheben, um ein Symptom loszuwerden** — Geräte, Exporte, Rate Limits.

Wenn eine dieser Regeln im Störfall unbequem wird, ist das der Moment, auf Stufe 2 zu eskalieren, nicht der Moment, sie zu brechen.

---

## 7. Was die Halle erfährt

**[FESTZULEGEN]: Wer informiert die Schicht, worüber, und wie oft.**

Der Inhalt lässt sich dagegen vorgeben, weil er aus §1 folgt. Eine brauchbare Meldung nennt drei Dinge:

1. **Was noch geht.** „Ihr könnt weiterarbeiten, die Tablets halten die Daten" ist bei Schwere 1 die wichtigste Auskunft — und sie stimmt.
2. **Was nicht geht.** Konkret: keine Fotos, keine Freigaben, keine neuen Aufträge.
3. **Wann es die nächste Meldung gibt.** Nicht, wann es behoben ist.

Was **nicht** gesagt wird: „gleich wieder da". Wer in der Halle darauf plant und dann drei Stunden wartet, umgeht das System beim nächsten Mal — und ein umgangenes System ist teurer als ein ausgefallenes.

---

## 8. Nach dem Störfall

**[FESTZULEGEN]: Wer schreibt die Nachbetrachtung, in welcher Frist.**

Der Ertrag gehört zurück in die Dokumente, sonst war es Aufwand ohne Ertrag:

- **Neues Störungsbild** ⇒ nach [docs/14 §3](14_RUNBOOK.md), mit Symptom, Ursache und dem, was tatsächlich geholfen hat.
- **Eine Anweisung war falsch** ⇒ korrigieren, dort wo sie steht. Beide Betriebsdokumente sind mit ⚠️/✅ gekennzeichnet, gerade damit das auffällt.
- **Fehlender oder unbrauchbarer Alarm** ⇒ nach [docs/14 §2](14_RUNBOOK.md). Ein Ausfall, den niemand gemeldet bekam, ist zuerst ein Alarmierungsfehler.
- **Missverständnis in der Halle** ⇒ nach [docs/15 §9](15_TRAINING.md). Die fünf dort sind aus der Konstruktion abgeleitet, nicht aus Erfahrung — die erste echte Störung ist die Gelegenheit, das zu ändern.

---

## 9. Die offenen Punkte in einer Liste

Alles, was hier **[FESTZULEGEN]** heißt, an einer Stelle — als Vorlage für das Gespräch, in dem es entschieden wird:

- [ ] Bereitschaft: ja/nein außerhalb der Geschäftszeiten, abgeleitet aus dem Schichtmodell
- [ ] Namen und Kontaktkanäle je Eskalationsstufe, mit Zweitweg
- [ ] Reaktionsfristen für Schwere 1 und 2 (Vorschläge in §2)
- [ ] Frist bis zur Eskalation auf Stufe 2
- [ ] Meldeweg aus der Halle, und wer dort entscheidet, dass etwas eine Störung ist
- [ ] Wer einen Rückfall auf die vorige Version entscheiden darf
- [ ] Wer eine Wiederherstellung aus Backup entscheiden darf
- [ ] Wer die Schicht informiert, in welchem Takt
- [ ] Wer die Nachbetrachtung schreibt, in welcher Frist

**Bis diese Punkte entschieden sind, ist dieses Dokument eine Vorlage und kein Verfahren.** Der technische Teil (§1, §3, §6) gilt unabhängig davon.
