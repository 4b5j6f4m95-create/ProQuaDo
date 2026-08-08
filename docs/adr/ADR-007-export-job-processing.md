# ADR-007: Verarbeitung von Export- und Akten-Jobs

**Status:** Akzeptiert
**Datum:** 2026-08-08

## Kontext

Die digitale Produktionsakte (Masterprompt Kap. 10) wird als PDF sowie als ZIP mit Originalnachweisen und Manifest erzeugt. [docs/10_MVP_PLAN.md](../10_MVP_PLAN.md) führt die Erzeugung unter Phase 6 mit dem Klammerzusatz „Queue/Worker" und nennt in der ADR-Kandidatenliste **BullMQ (Redis-basiert)** als Empfehlung.

Diese Empfehlung war nie entschieden — bis Phase 6 existierte kein ADR-007-Dokument. Phase 6 erzwingt die Entscheidung, weil die Aktenerzeugung der erste rechenintensive, potenziell langlaufende Vorgang im System ist.

Die Frage lautet nicht „Queue oder nicht", sondern „Queue **jetzt** oder später": ein Export, der einen HTTP-Request minutenlang offen hält, ist in Produktion nicht tragbar, aber die Akte **eines** Auftrags ist ein begrenzter Vorgang (zweistellige Zahl von Schritten, Fotos bereits im Objektspeicher).

## Entscheidung

Für das MVP wird **synchron erzeugt, aber als Job protokolliert**:

- Jeder Export legt zuerst einen `dossier_exports`-Datensatz an (Status `PENDING`), der Erstellungszeit, Anforderer, Datenstand und Template-Version festhält — die von Masterprompt Kap. 10 geforderte Auditierbarkeit hängt an diesem Datensatz, nicht am Übertragungsweg.
- Die Erzeugung läuft anschließend im selben Request; der Datensatz wird auf `COMPLETED` oder `FAILED` gesetzt.
- **Keine** neue Infrastrukturkomponente: kein Redis, kein Worker-Prozess, keine Änderung an `docker-compose.yml`.

Der Job-Datensatz existiert genau deshalb, damit der Wechsel auf asynchrone Verarbeitung **kein Datenmodell-Umbau** ist: ein Worker, der `PENDING`-Zeilen abholt, ersetzt einen Funktionsaufruf, während API, UI und Berechtigungen unverändert bleiben.

Harte Grenze als Schutz gegen den Fall, für den die Queue gedacht war: Überschreitet eine Akte die konfigurierte Größen-/Nachweisgrenze, wird der Export mit `FAILED` und begründetem Hinweis abgelehnt, statt den Request unbegrenzt laufen zu lassen.

## Konsequenzen

**Positiv:**

- Die lokale Umgebung bleibt bei vier Containern; ein Entwickler braucht für Phase 6 nichts Neues zu starten.
- Ein Export ist sofort da, ohne Polling-UI und ohne Job-Statusseite — bei MVP-Aktengrößen die einfachere und schnellere Nutzererfahrung.
- Die Auditanforderung („jeder Export ist auditierbar und erhält Erstellungszeit, Datenstand und Template-Version") ist bereits vollständig erfüllt.
- Masterprompt Kap. 0 verlangt für offene Punkte einen konservativen Standard; keine zusätzliche verteilte Komponente ist der konservative Standard.

**Negativ:**

- Ein Export hält einen Request-Worker. Bei vielen gleichzeitigen Exporten oder sehr großen Akten ist das der Punkt, an dem umgestellt werden muss — nicht früher, aber auch nicht später.
- Rate Limits für Exporte (docs/05: 5 req/hour/user) sind damit kein Komfortmerkmal, sondern ein Schutzmechanismus.
- Ein Serverneustart mitten im Export lässt einen `PENDING`-Datensatz zurück. Er ist sichtbar und wiederholbar, aber niemand räumt ihn automatisch auf.

**Alternativen erwogen:**

- **BullMQ + Redis jetzt** (Empfehlung aus docs/10): verworfen für das MVP. Es fügt eine Infrastrukturkomponente, einen zweiten Prozess und einen Zustandsraum (Job verloren, Worker tot, Retry-Sturm) für ein Problem hinzu, das bei einem Auftrag je Export noch nicht existiert. Die Empfehlung bleibt für den Zeitpunkt gültig, an dem sie gebraucht wird — siehe „Negativ".
- **Erzeugung ohne Job-Datensatz:** verworfen. Der Datensatz ist der Ort, an dem Datenstand und Template-Version stehen; ohne ihn wäre ein Export nicht reproduzierbar begründbar.
