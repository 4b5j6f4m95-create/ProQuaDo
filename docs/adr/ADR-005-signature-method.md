# ADR-005: Signaturverfahren für Ausführungsbestätigungen

**Status:** Akzeptiert
**Datum:** 2026-08-09 (nachträglich dokumentiert; die Entscheidung wurde in Phase 3 getroffen und umgesetzt)

## Kontext

Ein abgeschlossener Arbeitsschritt muss einer Person zurechenbar sein. Masterprompt Kap. 8 verlangt für kritische Aktionen eine Re-Authentifizierung, [docs/04](../04_ROLES_PERMISSIONS_MATRIX.md) nennt sie unter „Re-Authentifizierung für kritische Aktionen", und [docs/10](../10_MVP_PLAN.md) führt das Signaturverfahren in der ADR-Kandidatenliste — ohne dass je ein Dokument entstanden wäre.

Die Entscheidung war praktisch dennoch getroffen: Phase 3 hat sie implementiert, und Code-Kommentare verweisen seither auf „ADR-005", das es nicht gab (`buildSignatureDigest` in `complete-work-step.ts`, `confirmation-pin.ts`). Dieses Dokument schreibt nieder, was gilt — es ändert nichts.

Die Frage ist nicht, ob bestätigt wird, sondern **womit**. Drei Verfahren standen zur Wahl:

1. **Qualifizierte elektronische Signatur (QES)** nach eIDAS — rechtlich einer handschriftlichen Unterschrift gleichgestellt.
2. **Fortgeschrittene Signatur** mit organisationseigenen Schlüsseln je Benutzer.
3. **Bestätigungs-PIN** als Step-up-Authentifizierung, protokolliert im Audit-Trail.

## Entscheidung

Für das MVP gilt **Verfahren 3: PIN-Bestätigung plus Audit-Trail**. Eine qualifizierte elektronische Signatur ist ausdrücklich **außerhalb des MVP-Umfangs** (docs/10 „Bewusst außerhalb MVP").

Konkret:

- Jeder Benutzer hat eine **Bestätigungs-PIN**, gespeichert ausschließlich als scrypt-Hash in `users.confirmation_pin_hash` (`src/lib/auth/confirmation-pin.ts`). Der Klartext existiert für die Dauer eines `verify()`-Aufrufs, wird nie geloggt und nie in ein Audit-Event geschrieben. scrypt mit N=2^15, weil eine vierstellige PIN einen teuren KDF nötiger hat als ein Passwort.
- Die PIN wird verlangt bei: Abschluss eines Arbeitsschritts (`submitWorkStepCompletion`), Vier-Augen-Entscheidung (`decideSecondApproval`), Konfliktentscheidung (`decideSyncConflict`) und Produktfreigabe (`decideProductRelease`, seit Phase 7). Alle vier sind Aussagen über Produktkonformität, die einer Person zugerechnet werden. Geprüft wird an genau **einer** Stelle, `src/domain/identity/confirm-with-pin.ts` — siehe den Nachtrag unten, warum das nicht nur Aufräumen war.
- Bei jedem Abschluss entsteht eine Zeile in `step_confirmations` mit dem **wörtlichen Bestätigungstext** und seiner **Version** (`STEP_CONFIRMATION_TEXT`, `STEP_CONFIRMATION_TEXT_VERSION`). Was jemand bestätigt hat, ist damit auch dann noch lesbar, wenn der Text später umformuliert wird.
- `signature_data` enthält einen SHA-256-Digest über `(userId, workStepInstanceId, textVersion, confirmedAt, method)` — `buildSignatureDigest`. Er bindet zusammen, wer wann was mit welchem Verfahren bestätigt hat.

### Was der Digest ist und was er nicht ist

Das ist der Punkt, an dem dieses ADR am ehesten missverstanden wird, deshalb ausdrücklich:

Der Digest ist **kein kryptografischer Beweis gegenüber Dritten**. Er ist über keinen geheimen Schlüssel gebildet — wer die Datenbank schreiben darf, kann ihn zu geänderten Werten neu berechnen. Er leistet zweierlei, und nur das: er macht eine **unabsichtliche** Inkonsistenz zwischen den Feldern der Zeile sichtbar, und er gibt der Akte einen kurzen, zitierbaren Bezeichner für genau diese Bestätigung (das PDF druckt seine ersten 16 Zeichen).

Die eigentliche Zurechenbarkeit trägt der **Audit-Trail**, nicht der Digest: `audit_events` ist append-only auf Datenbankebene (kein UPDATE, kein DELETE für die Anwendungsrolle, dazu eine RLS-Policy — [ADR-004](ADR-004-audit-hardening.md)). Der Digest ist ein Siegel auf einem Umschlag, kein Notar.

### Warum nicht QES

- QES ist eine **rechtliche und organisatorische** Änderung, keine technische: sie verlangt einen qualifizierten Vertrauensdiensteanbieter, Identitätsfeststellung je Mitarbeiter, Signaturkarten oder Fernsignatur und einen Vertrag. Nichts davon lässt sich durch Programmieren herstellen.
- Der Anwendungsfall verlangt sie nicht. Masterprompt Kap. 8 fordert Zurechenbarkeit und Re-Authentifizierung, nicht Rechtsverbindlichkeit gegenüber Dritten. Wer ein Bauteil montiert hat, muss innerbetrieblich nachweisbar sein — das ist eine Auditfrage, keine Vertragsfrage.
- Eine QES an der Halle würde den Ablauf verlangsamen, an dem die Akzeptanz des ganzen Systems hängt. Ein Mitarbeiter bestätigt in einer Schicht viele Schritte.

### Warum nicht eigene Benutzerschlüssel (Verfahren 2)

Verlockend, weil es rein technisch machbar wäre. Verworfen, weil ein Schlüssel, den der Server erzeugt, speichert und benutzt, keine stärkere Aussage trägt als ein Datenbankeintrag, den derselbe Server schreibt — er sieht nur so aus. Eine fortgeschrittene Signatur wird erst dann mehr als Zierde, wenn der private Schlüssel den Server **nie** sieht, also auf einem Token oder im Gerät des Mitarbeiters liegt. Das ist ein eigenes Vorhaben mit eigener Ausgabe-, Sperr- und Verlustlogik, und es ist der Schritt, den man bei Bedarf **statt** QES gehen kann.

Kryptografie, die Sicherheit vortäuscht, ist schlechter als ihr sichtbares Fehlen: sie beendet die Frage, statt sie offen zu halten.

## Konsequenzen

**Positiv:**

- Zurechenbarkeit ohne externe Infrastruktur — kein Vertrauensdiensteanbieter, keine Kartenleser, kein Rollout-Projekt vor dem Piloten.
- Die PIN funktioniert offline: sie wird gegen den Hash geprüft, den der Server hält, und die Bestätigung reist als Teil der Abschlussmeldung mit. Ein Verfahren mit externem Dienst täte das nicht — und die Halle ohne Netz ist genau der Fall, für den docs/06 existiert.
- Bestätigungstext und Textversion sind mitgespeichert, die Aussage ist also auch nach einer Textänderung rekonstruierbar.
- `signature_method` ist als Feld vorhanden und kennt bereits `DIGITAL_SIGNATURE`. Ein zweites Verfahren ist eine Ergänzung, keine Migration bestehender Daten.

**Negativ:**

- **Keine Rechtsverbindlichkeit gegenüber Dritten.** Wo ein Kunde oder eine Zertifizierung eine qualifizierte Signatur verlangt, erfüllt dieses Verfahren die Anforderung nicht. Das muss vor einem solchen Vertrag geklärt werden, nicht danach.
- Eine PIN kann weitergegeben werden. Dagegen hilft kein technisches Mittel dieser Klasse — nur Organisation, und das Vier-Augen-Prinzip dort, wo es wirklich zählt.
- Der Digest lädt zu der Fehlannahme ein, er sei eine Signatur. Deshalb steht es oben ausdrücklich, und deshalb nennt das Akten-PDF ihn „Digest" und nicht „Signatur".
- Vier- bis zwölfstellige PINs sind ein kleiner Suchraum. Abgefedert durch scrypt, durch die authentifizierte Sitzung, durch `STANDARD_API` und seit Phase 7 durch eine **Fehlversuchssperre** — siehe den Nachtrag unten. Eine PIN bleibt trotzdem das schwächste Glied dieses Verfahrens; wer mehr braucht, braucht ein anderes Verfahren, nicht mehr Stellen.

**Alternativen erwogen:** siehe oben (QES, fortgeschrittene Signatur mit Benutzerschlüsseln).

## Wann diese Entscheidung neu zu treffen ist

- Sobald ein Kunde oder eine Zertifizierung ausdrücklich eine qualifizierte Signatur verlangt.
- Sobald Bestätigungen außerhalb der Organisation vorgelegt werden sollen, wo „unser Audit-Trail sagt es" keine Antwort ist.
- Sobald die Fehlversuchssperre (Nachtrag unten) nicht mehr reicht — etwa weil PINs nachweislich weitergegeben werden. Dann hilft kein weiterer Parameter, sondern nur ein gerätegebundener Schlüssel oder eine zweite Person.

---

## Nachtrag (2026-08-09): Fehlversuchssperre

Die oben als „offensichtlichste Lücke" benannte fehlende Sperre ist umgesetzt.

**Regel.** Fünf aufeinanderfolgende Fehlversuche sperren die Bestätigung. Die Wartezeit beginnt bei einer Minute und verdoppelt sich je weiterem Fehlversuch bis zu **15 Minuten**. Ein erfolgreicher Versuch setzt den Zähler zurück — gezählt werden *aufeinanderfolgende* Fehlversuche, damit gelegentliches Vertippen über eine Schicht sich nicht zu einer Sperre summiert.

**Die Zahl, um die es geht.** Bei 5 Versuchen je 15 Minuten dauert das vollständige Durchprobieren einer vierstelligen PIN rund **drei Wochen** ununterbrochenen Ratens, im Erwartungswert die Hälfte — und jeder einzelne Versuch schreibt ein Audit-Event, jeder fünfte ein `confirmation_pin.locked`. Ein leiser Angriff ist das nicht. Die Rechnung steht als Zusicherung im Unit-Test, damit sie keine Behauptung bleibt, die niemand nachrechnet.

**Zeitbasiert und selbstlösend, mit Absicht.** Ein Mitarbeiter an der Maschine darf für eine vertippte PIN keine Administration brauchen. Eine Sperre, die jemand anderes aufheben muss, ist eine Sperre, die durch geteilte PINs umgangen wird — und damit wäre die Zurechenbarkeit verloren, also genau das, wofür die PIN da ist.

**Wer sie auslösen kann.** Nur der Kontoinhaber. Die PIN wird gegen den *authentifizierten Actor* geprüft, Fehlversuche kann also ausschließlich erzeugen, wer die Sitzung hält. Es gibt keinen Weg, eine Kollegin aus ihrer Schicht auszusperren.

**Nebenbefund, der den eigentlichen Anlass gab.** Vor dieser Änderung existierte die PIN-Prüfung in **vier** Kopien (Schrittabschluss, Vier-Augen, Konfliktentscheidung, Produktfreigabe). Eine Sperre in einer davon hätte drei offen gelassen. Es gibt jetzt genau eine Stelle, `src/domain/identity/confirm-with-pin.ts`; alle vier Dienste rufen sie auf. Eine Kontrolle, die in vier Dateien erinnert werden muss, fehlt irgendwann in einer.

**Neuer Fehlercode.** `CONFIRMATION_LOCKED` (HTTP 423), getrennt von `CONFIRMATION_FAILED`: ein Client, der „falsche PIN" nicht von „gesperrt, noch vier Minuten" unterscheiden kann, verschweigt entweder die Wartezeit oder hämmert weiter. Der Code steht nicht in der Tabelle von docs/05, die älter ist — vermerkt wie die übrigen dokumentierten Abweichungen.
