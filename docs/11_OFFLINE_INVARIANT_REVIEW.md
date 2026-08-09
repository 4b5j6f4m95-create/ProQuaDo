# Manuelle Sicherheitsüberprüfung der Offline-Invariante

**Gegenstand:** die zentrale Invariante aus [06_OFFLINE_SYNC_CONFLICT.md](06_OFFLINE_SYNC_CONFLICT.md):

> Ein Folgeschritt darf erst begonnen werden, nachdem der Server den aktuellen Abschluss validiert, endgültig bestätigt und den Folgeschritt ausdrücklich freigegeben hat.

**Anlass:** [10_MVP_PLAN.md](10_MVP_PLAN.md) macht diese Überprüfung zur Bedingung für den Abschluss von Phase 5 und verlangt sie ausdrücklich **zusätzlich** zur automatisierten Angriffssuite (`test/integration/phase7-offline-invariant-attacks.integration.test.ts`). Eine Suite probiert nur, was jemand bedacht hat; dieser Bericht ist der Versuch, dahinter zu schauen.

**Methode:** vollständige Lektüre jedes Pfades, der einen Arbeitsschritt nach `COMPLETED` bringen oder einen Schritt freigeben kann, jedes Endpunkts, der eine Geräteidentität entgegennimmt, und jeder Stelle, an der eine Clientangabe zu einer Serverentscheidung wird. Kein Werkzeugeinsatz, keine Stichprobe.

**Datum:** 2026-08-09 · **Stand:** Commit vor „Phase 7: Gerätekontext verifizieren".

---

## 1. Ergebnis vorweg

**Die Invariante selbst hält.** Sie hält aus einem strukturellen Grund und nicht aus Sorgfalt: es gibt genau vier Stellen im gesamten Code, die `status: 'COMPLETED'` auf eine Arbeitsschrittinstanz schreiben oder eine Freigabe erzeugen, und keine davon ist von einem Gerät aus erreichbar.

| Pfad                                                        | Auslöser                                              | Clientnah? |
| ----------------------------------------------------------- | ----------------------------------------------------- | ---------- |
| `finalizeStepCompletion` (`complete-work-step.ts`)          | serverseitige Validierung der Abschlussmeldung        | nein       |
| `decideSecondApproval` (`second-approval.ts`)               | Vier-Augen-Zustimmung einer zweiten Person            | nein       |
| `releaseWorkStepInstance` über `releaseProductionOrder`     | Auftragsfreigabe durch PM                             | nein       |
| `releaseWorkStepInstance` über `ncr-workflow` / `decide-conflict` | Disposition bzw. protokollierte Konfliktentscheidung | nein       |

Dazu kommt die Vokabularsperre: `SYNC_COMMAND_TYPES` enthält kein Kommando, mit dem ein Gerät einen Status überhaupt **aussprechen** könnte, und `ClientWorkStepStatus` enthält `COMPLETED` nicht, sodass ein clientseitiger Ausdruck, der ihn zuweist, nicht kompiliert. Beides ist geprüft und trägt.

**Gefunden wurden fünf Mängel — keiner bricht die Invariante, aber drei brechen Kontrollen, die die Invariante flankieren.** Alle fünf sind behoben; die Belege stehen in Abschnitt 4.

Der gemeinsame Nenner der drei ernsten Befunde ist bemerkenswert und der eigentliche Ertrag dieser Überprüfung: **die Angriffssuite prüft ausschließlich den Sync-Pfad, und die Lücke lag darin, dass der gewöhnliche Pfad dieselbe Geräteidentität entgegennahm, ohne sie je zu prüfen.** Ein Angreifer, der `/api/v1/sync/commands` gar nicht benutzt, war nie Gegenstand eines Tests.

---

## 2. Was geprüft wurde und trägt

Der Vollständigkeit halber, weil ein Prüfbericht ohne die bestandenen Punkte nur eine Mängelliste ist.

### 2.1 Das Kommandovokabular

`src/domain/sync/sync-command-types.ts` kennt sechs Kommandos. Keines trägt ein Statusfeld, keines heißt `complete_*` oder `release_*`. `executeCommand` schlägt den Typ in `COMMAND_PAYLOAD_SCHEMAS` nach und wirft bei einem unbekannten Namen eine `ValidationError` — ein erfundener Kommandotyp stirbt an der Vokabelgrenze, nicht an einer Berechtigungsprüfung, die man umgehen könnte.

Zusatzfelder in einer gültigen Nutzlast sind wirkungslos: die Zod-Schemata sind Objektschemata ohne `passthrough`, geschmuggelte Schlüssel werden verworfen, bevor irgendein Dienst sie sieht.

### 2.2 Die Freigabe

`releaseWorkStepInstance` ist die einzige Funktion, die `status: 'READY'` setzt und ein Token prägt. Sie ist nicht exportiert an die API-Schicht, sondern nur an vier Domänendienste. `reissueReleaseTokenForDevice` — der einzige clientaufrufbare Weg, an ein Token zu kommen — **verweigert**, wenn der Schritt nicht bereits `READY` mit gültiger `work_step_releases`-Zeile ist. Ein `LOCKED`-Schritt hat kein Token und kann keines bekommen.

Das Offline-Bundle prägt Tokens ausschließlich für Schritte in `READY`. Ein Gerät kann also über beliebig lange Offline-Zeit nie mehr Beweise besitzen, als der Server bereits freigegeben hatte.

### 2.3 Die Tokenbindung

Die Nutzlast enthält `workStepInstanceId`; `assertStartPreconditions` vergleicht sie mit der Instanz, die gestartet werden soll. Ein auf den Nachfolger umgebogenes Token scheitert. Bemerkenswert: es scheitert **vor** der Tokenprüfung, an `WORK_STEP_NOT_READY` — die Statusprüfung steht davor. Die Ablehnung hängt also nicht daran, dass die Kryptografie funktioniert. Das ist die richtige Reihenfolge und in der Suite festgehalten.

`hashTokenSignature` speichert nur den SHA-256 der Signatur. Eine gestohlene Datenbankzeile lässt sich nicht in ein benutzbares Token zurückrechnen. Ein neu ausgeliefertes Token ersetzt den Hash und entwertet damit das vorherige — genau ein Gerät hält je Schritt ein gültiges Token.

`verifyReleaseToken` vergleicht Signaturen mit `timingSafeEqual` und prüft die Länge separat (`timingSafeEqual` wirft bei ungleicher Länge). Ein fehlendes `RELEASE_TOKEN_SECRET` führt zu einem harten Fehler, nicht zu einer Signatur mit leerem Schlüssel.

### 2.4 Die Reihenfolge im Batch

`processSyncCommands` sortiert nach `sequenceNumber` und führt sequenziell aus, jedes Kommando in eigener Transaktion. Ein umsortierter Batch ändert nichts: der Nachfolger ist `LOCKED`, bis der Server den Vorgänger validiert hat, und diese Prüfung liegt in `assertStartPreconditions`, nicht in der Batchlogik.

### 2.5 Die Ablehnung ohne Datenverlust

Der in den Entwicklungsnotizen dokumentierte Fehler „abgelehnte Vorgänge dürfen nicht in derselben Transaktion geworfen werden" ist an allen geprüften Stellen konsequent umgesetzt: `validateSubmissionWithin` liefert `result: 'REJECTED'` als Rückgabewert, `completePhotoUpload` schreibt den Fehlzustand über `markUploadFailed` in einer eigenen Transaktion und wirft erst danach.

### 2.6 Die Mandantengrenze

`withOrgContext` setzt `app.current_org_id` per `set_config(..., true)` — transaktionslokal, also kann kein Verbindungs-Pooling den Kontext einer fremden Anfrage erben. Die Organisations-ID stammt ausschließlich aus der Sitzung (`requireAuthContext`), nie aus Body oder Query.

---

## 3. Befunde

### B-1 · Die Fernsperre galt nicht für den regulären Pfad · **mittel**

`assertDeviceActive` lief in `/sync/health`, `/sync/changes`, `/sync/bundle`, `/sync/commands` und `POST /work-steps/{id}/release-token`. In den gewöhnlichen Endpunkten — Schritt starten, Checkliste beantworten, Messwert erfassen, Foto hochladen, Abschluss melden — wurde `deviceId` als `z.string().max(255).optional()` entgegengenommen und **nie nachgeschlagen**.

Folge: ein als verloren gemeldetes und gesperrtes Tablet, dessen Sitzung noch gültig ist, konnte über die reguläre API unbegrenzt weiterarbeiten. [06](06_OFFLINE_SYNC_CONFLICT.md) „Geräteverlust und Sicherheit" beschreibt die Sperre als die Maßnahme gegen genau diesen Fall; sie deckte den kleineren Teil der Angriffsfläche ab.

Dass es niemandem auffiel, hat einen Grund: die Sperre wurde als Sync-Eigenschaft entworfen und getestet, und im Sync-Pfad funktioniert sie einwandfrei.

### B-2 · Gerätebezogene Rate Limits waren keine · **mittel**

`PHOTO_UPLOAD` (20/min je Gerät) wird gegen `body.deviceId` bzw. den Header `x-device-id` gezählt — beides bis zu diesem Review unvalidierte, frei wählbare Zeichenketten. Ein Aufrufer, der je Anfrage einen neuen Zufallswert sendet, trifft nie einen belegten Zähler.

Ein Limit, dessen Schlüssel der Begrenzte selbst wählt, ist kein Limit. Dasselbe galt abgeschwächt für `SYNC_COMMANDS`: dort ist die `deviceId` zwar eine echte UUID, aber `POST /api/v1/devices` hatte keine Obergrenze — ein Client registriert N Geräte und kauft sich N × 10 Batches pro Minute, bei bis zu 500 vollständigen serverseitigen Neuvalidierungen je Batch.

### B-3 · Die Geräteangabe im Audit-Trail war eine Clientbehauptung · **mittel**

`audit_events.device_id`, `photo_evidence.device_id`, `step_confirmations.device_id` und `completion_submissions.device_id` sind `String?` **ohne Fremdschlüssel**. Der ungeprüfte Wert aus B-1 landete dort wörtlich.

„Von welchem Gerät wurde dieser Schritt bestätigt" ist eine Auditfrage. Ihre Antwort darf kein Freitext sein, den der Befragte selbst eingetragen hat.

### B-4 · Die Konfliktentscheidung umging den Zustandsautomaten · **klein**

`reopenStepForWork` in `decide-conflict.ts` schrieb `IN_PROGRESS` direkt, gegen eine handgepflegte Liste erlaubter Ausgangszustände, ohne `isValidWorkStepTransition` zu fragen. Die Liste enthielt `VALIDATING`, wofür es in `VALID_TRANSITIONS` keine Kante nach `IN_PROGRESS` gibt.

Praktisch nicht erreichbar (die Validierung läuft in derselben Transaktion, die `VALIDATING` setzt, der Zustand ruht also nie), aber „nicht erreichbar" ist nicht „abgesichert": `work-step-status.ts` soll die einzige Instanz für erlaubte Übergänge sein, und hier gab es einen zweiten Schreibweg an ihr vorbei.

### B-5 · Die Wiederholung gab an der Sperrprüfung vorbei frei · **klein**

`repeatStep` legt nach der Entscheidung „Wiederholung erforderlich" einen neuen Versuch an und rief `releaseWorkStepInstance` unmittelbar auf. `releaseEligibleSuccessors` verweigert an derselben Stelle mit ausdrücklicher Begründung die Freigabe, solange eine blockierende Abweichung offen ist — „damit ein Nachfolger nicht einmal als READY erscheint".

Die Invariante blieb heil, weil `startWorkStep` weiterhin über `assertNotBlockedForStep` abweist. Aber das Tablet zeigte einen startbaren Schritt, dessen Start jedes Mal scheiterte. [07](07_WIREFLOWS_UX.md) verlangt für Sperren „Ursache und nächste Handlung, nicht nur einen deaktivierten Button" — ein Button, der lügt, ist schlechter als ein gesperrter.

### Beobachtungen ohne Handlungsbedarf

- **`baseVersion` ist optional.** Ein Client, der das Feld weglässt, überspringt den `ENTITY_VERSION_CONFLICT`-Vorabtest. Kein Invariantenbruch — die Domänendienste prüfen unverändert weiter —, aber Negativtest #13 ist nur so stark wie die Ehrlichkeit des Clients. Bewusst so belassen: ein erzwungenes Feld würde ältere Clients aussperren, ohne eine Zusicherung zu gewinnen, die der Server nicht ohnehin selbst herstellt.
- **Das Offline-Bundle prägt Tokens auch für Nachprüfungsschritte**, für die der abrufende WORKER keine Ausführungsberechtigung hat. Nicht ausnutzbar (`startWorkStep` prüft `reinspection.execute`), aber weiter als nötig. Notiert, nicht geändert — die Einschränkung gehörte in dieselbe Konfigurationsfläche wie die Prüferqualifikation.

---

## 4. Korrekturen

| Befund | Korrektur                                                                                                                        | Beleg                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| B-1    | `resolveDeviceId` in `src/lib/api/device-context.ts`; in allen neun Endpunkten angewandt, die `deviceId` annehmen                 | „extends the remote lock to the ordinary API, not just /sync"               |
| B-2    | Rate Limit wird **nach** der Verifikation gezählt; `MAX_ACTIVE_DEVICES_PER_USER = 10` in `device-registry.ts`                     | „bounds how many rate-limit buckets one user can mint"                      |
| B-3    | dieselbe Verifikation — der gespeicherte Wert ist jetzt eine Server-Tatsache, nicht mehr eine Clientangabe                        | „refuses free text where a device id is expected"                            |
| B-4    | `reopenStepForWork` fragt zusätzlich `isValidWorkStepTransition`                                                                   | bestehende Konflikttests in `phase5-offline-sync`                            |
| B-5    | `repeatStep` prüft `hasOpenBlockingNonConformance` und lässt den Wiederholungsversuch andernfalls `LOCKED`                        | bestehende Konflikttests in `phase5-offline-sync`                            |

Nebenbei geschlossen, weil beim Lesen von B-2 aufgefallen: **`STANDARD_API` (100/min je Benutzer) stand seit Phase 1 in [05](05_API_CONTRACTS.md) und war an keiner einzigen Route durchgesetzt.** Jetzt zentral in `requireAuthContext` — dort, weil jeder authentifizierte Einstiegspunkt der Anwendung seinen Actor darüber auflöst und deshalb keiner vergessen werden kann. Der Client-Änderungsstrom (`pullAndApplyChanges`) hat dafür eine Seitenobergrenze je Lauf bekommen; der Cursor wird ohnehin je Seite gesichert, ein früher Abbruch ist also kein Datenverlust, sondern eine Fortsetzung beim nächsten Lauf.

---

## 5. Was diese Überprüfung nicht abdeckt

Damit der nächste Prüfer nicht dasselbe noch einmal macht und das Fehlende wieder nicht:

- **Kein externer Penetrationstest.** Das ist eine Lektüre des eigenen Codes durch jemanden, der weiß, wie er gemeint ist — die schwächste Form von Prüfung genau dort, wo eine Annahme falsch ist. [10](10_MVP_PLAN.md) verlangt für Phase 7 zusätzlich einen externen Test; dieser Bericht ersetzt ihn nicht.
- **Keine Prüfung der Kryptografie im Betrieb.** Geprüft wurde, dass `RELEASE_TOKEN_SECRET` verlangt wird — nicht, wie es in der Zielumgebung erzeugt, verteilt und gewechselt wird. Ein Rotationsverfahren gibt es nicht; heute entwertet ein Schlüsselwechsel alle ausgegebenen Tokens auf einen Schlag, was für offline arbeitende Geräte einen stillen Ausfall bedeutet.
- **Keine Prüfung des Clients als Binärartefakt.** Die Typsicherheit von `ClientWorkStepStatus` gilt für den Code, der ausgeliefert wird. Wer das ausgelieferte JavaScript verändert, umgeht sie — und muss es nicht einmal, weil der Server nichts glaubt, was der Client sagt. Genau deshalb ist die Typsicherheit die *zweite* Verteidigungslinie und nicht die erste.
- **Keine Lastbetrachtung.** `sync_sequences` serialisiert Outbox-Schreibvorgänge je Organisation. Ob das unter der Last einer realen Linie trägt, ist eine Frage für den Lasttest nach [09](09_TEST_PYRAMID.md) Ebene 8, nicht für diesen Bericht.
