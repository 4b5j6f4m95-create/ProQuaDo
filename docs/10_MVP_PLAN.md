# 10. Priorisierter MVP- und Migrationsplan

**Dokumentversion:** 1.0
**Status:** Foundation
**Gültig ab:** 2026-08-08

---

## MVP-Umfang (verbindlich aus Masterprompt Kap. 19)

Das MVP muss einen echten, geschlossenen Produktionsfluss sicher abbilden. Reihenfolge = Abhängigkeitsreihenfolge, nicht Priorität einzeln verschiebbar:

| # | Feature | Abhängig von |
|---|---|---|
| 1 | Organisation, Benutzer, Rollen, Mitarbeiterqualifikation | – |
| 2 | Projekte, Produkte, Produktionsaufträge | 1 |
| 3 | Dokumentupload, Revision, Prüfung, Freigabe | 1, 2 |
| 4 | Fertigungsplan mit linearen Schritten, Pflichtanforderungen | 2, 3 |
| 5 | Serverseitige Freigabe und Ausführung eines Schritts | 4 |
| 6 | Tablet-Oberfläche: Checkliste, Foto, Messwert, Bestätigung | 5 |
| 7 | Offline-Bearbeitung freigegebener Schritte mit Outbox | 5, 6 |
| 8 | Serverseitiger Abschluss, gesperrter Folgeschritt bis Bestätigung | 7 |
| 9 | Einfache NCR (blockierend/nicht blockierend) | 5 |
| 10 | Nacharbeit und Nachprüfung | 9 |
| 11 | Vier-Augen-Prüfung | 5 |
| 12 | Append-only Audit Trail | 1 (durchgängig ab Phase 1) |
| 13 | Seriennummernsuche, einfache digitale Produktionsakte (PDF) | 8, 9, 12 |
| 14 | Basisdashboard, In-App-Benachrichtigungen | 2, 8 |
| 15 | Backup, Monitoring, zentrale Sicherheitsmaßnahmen | durchgängig |

**Bewusst außerhalb MVP, aber architektonisch vorbereitet:**
- Komplexe parallele Graphen (DAG-Unterstützung im Datenmodell vorhanden, UI/Engine erst Phase 2)
- Umfassende CAPA (Referenzfelder vorhanden, Workflow erst Phase 2)
- Fortgeschrittene BI (Kennzahlen-Rohdaten vorhanden, Advanced Analytics später)
- Mehrere ERP-Systeme (Adapter-Pattern vorbereitet, Implementierung später)
- Qualifizierte elektronische Signatur (Signature-Feld vorhanden, kryptographische Qualifikation später)
- Native Apps (PWA zuerst, React Native/Capacitor evaluieren falls nötig)
- Vollautomatische CAD-Verarbeitung (Datei-Referenz zunächst, kein Parsing)

---

## Entwicklungsphasen (Detailplan)

### Phase 0 – Discovery und fachliche Validierung
**Dauer:** 2–3 Wochen | **Ziel:** Fachliche Annahmen validieren, bevor Code entsteht

| Aktivität | Output |
|---|---|
| Stakeholder-Interviews (Produktion, QM, PL, Admin) | Interview-Protokolle |
| Reale Hallenbedingungen erheben (Konnektivität, Geräte, Handschuhbetrieb) | Umgebungsbericht |
| Beispielpläne, Formulare, NCRs, Akten analysieren | Referenzdokumente-Sammlung |
| Begriffe/Verantwortlichkeiten als Glossar festlegen | Erweitertes Glossar (Basis: Kap. 23 Masterprompt) |
| Regulatorische/vertragliche/Aufbewahrungsanforderungen bestätigen | Compliance-Checkliste |
| Risiken, Annahmen, Nichtziele dokumentieren | Risikoregister (Basis: 01_SYSTEM_CONTEXT.md) |

**Gate:** Ohne validiertes Glossar und bestätigte Aufbewahrungsfristen kein Start von Phase 1 (Audit-Design hängt davon ab).

---

### Phase 1 – Fundament
**Dauer:** 3–4 Wochen | **MVP-Features:** 1, 12 (Basis), 15 (Basis)

| Aufgabe | Details |
|---|---|
| Repository, CI/CD, Umgebungen | Next.js + TS strict Setup, GitHub Actions Pipeline (siehe 09) |
| Authentifizierung | OIDC/OAuth2 Integration, Session Management |
| Organisation/Mandant | `organizations`, `sites`, `departments` + Middleware-Enforcement |
| RBAC Engine | Rollen/Permissions gemäß 04_ROLES_PERMISSIONS_MATRIX.md |
| PostgreSQL/Prisma | Initiales Schema, Migrationsstrategie |
| Audit Trail Foundation | `audit_events` append-only, Transactional Outbox Pattern |
| Sichere Dateiablage | S3-Setup, signierte URLs, Malware-Scan-Integration |
| Observability | Strukturierte Logs, Basis-Metriken, Health-Endpoints |
| Testgrundlage | Jest, Testcontainers-Setup, erste Unit/Integration Tests |

**Definition of Done:** Login funktioniert, RBAC blockiert unautorisierten Zugriff (Negativtest #12 grün), Audit-Event wird bei jeder Aktion geschrieben.

---

### Phase 2 – Dokumente und Planung
**Dauer:** 4–5 Wochen | **MVP-Features:** 2, 3, 4

| Aufgabe | Details |
|---|---|
| Projekte, Produkte, Aufträge | CRUD mit Statusautomat (DRAFT→PLANNED→RELEASED etc.) |
| Dokumentidentität, Revision, Freigabe | Upload-Flow, Hash-Verifikation, Approval-Workflow |
| Viewer | PDF-Viewer mit Zoom/Pan/Rotation, Revision-Anzeige |
| Schritt-Dokumentbindung | `step_document_bindings`, Marker-Unterstützung |
| Fertigungsplan | Lineare Schritte zunächst, Anforderungsdefinition (Foto/Signatur/Vier-Augen) |
| Freigabeworkflow | DRAFT→IN_REVIEW→APPROVED→RELEASED für Plan und Dokument |

**Definition of Done:** Projektleiter kann Dokument hochladen, freigeben, Fertigungsplan mit Schritten erstellen und freigeben. Nur RELEASED Revisionen sind verbindlich referenzierbar.

---

### Phase 3 – Online-Ausführung
**Dauer:** 4–5 Wochen | **MVP-Features:** 5, 6

| Aufgabe | Details |
|---|---|
| Tablet-UI | Meine-Aufträge-Ansicht, Schritt-Detailansicht (siehe 07_WIREFLOWS_UX.md A1-A5) |
| Zuweisungen | `order_assignments`, Sichtbarkeitsfilter |
| Serverseitige Schrittfreigabe | `canStartWorkStep`, `startWorkStep`, Release Token Ausstellung |
| Checklisten, Fotos, Messwerte | Vollständige Erfassungs-UI + Backend-Persistierung |
| Bestätigung | PIN/Signatur-Erfassung |
| Abschlussvalidierung | `validateAndCompleteWorkStep` mit allen Bedingungen (online zunächst) |
| Nachfolgerfreigabe | `releaseEligibleSuccessors` |

**Definition of Done:** Vollständiger Online-Flow (Abnahmeszenario A aus Masterprompt Kap. 22) funktioniert end-to-end.

---

### Phase 4 – Qualität
**Dauer:** 4 Wochen | **MVP-Features:** 9, 10, 11

| Aufgabe | Details |
|---|---|
| Einfache NCR | Erstellung, Klassifikation blockierend/nicht-blockierend |
| Sperre | `production_holds`, Verknüpfung mit NCR |
| Nacharbeit/Nachprüfung | Rework-Step-Erstellung, verknüpft mit Ursprungsschritt |
| Prüfmittel/Kalibrierung | `measuring_equipment`, `calibrations`, Sperrlogik bei Ablauf |
| Vier-Augen-Prinzip | `second_approvals`, DB-Constraint, UI-Flow |
| Revisionsauswirkungsanalyse | Grundlage für Phase 5 Konfliktbehandlung |

**Definition of Done:** Abnahmeszenarien D (Blockierende Abweichung) und E (Vier Augen) aus Masterprompt Kap. 22 funktionieren.

---

### Phase 5 – Offline und Synchronisation
**Dauer:** 5–6 Wochen | **MVP-Features:** 7, 8

**Dies ist die architektonisch anspruchsvollste Phase** – siehe 06_OFFLINE_SYNC_CONFLICT.md für technisches Detailkonzept.

| Aufgabe | Details |
|---|---|
| Lokale Datenbank | IndexedDB (Web) Setup, Verschlüsselung |
| Outbox-Pattern (Client) | Lokale Mutation-Envelope, monotone Sequenz |
| Upload Resume | Chunk-basiertes Foto-Upload mit Wiederaufnahme |
| Release Token | Ausstellung, Signierung, Client-seitige Validierung |
| Offline-Startregel | Client-Typsystem verhindert `COMPLETED` strukturell (siehe 06) |
| Konfliktcenter | UI + Backend für alle 7 Konflikttypen |
| Sichere Wiederholung | Idempotency Keys durchgängig getestet |
| Netzwerkausfall-Tests | Systematische Chaos-Tests (siehe 09_TEST_PYRAMID.md Ebene 5) |

**Definition of Done:** Abnahmeszenarien B (Verbindungsabbruch) und C (Revisionskonflikt) aus Masterprompt Kap. 22 funktionieren. Alle 15 Negativtests grün.

**Kritisches Gate:** Diese Phase erhält vor Abschluss eine dedizierte Sicherheitsüberprüfung der Offline-Invariante (manuelle Penetration: Versuch, `COMPLETED` clientseitig zu erzwingen).

---

### Phase 6 – Akte, Reporting und Integrationen
**Dauer:** 3–4 Wochen | **MVP-Features:** 13, 14

| Aufgabe | Details |
|---|---|
| Produktionsakte | PDF-Generierung (Queue/Worker), Manifest mit Hashes |
| Export | ZIP mit Originalnachweisen |
| Suche | Seriennummer/Auftrag/Dokument-Suche |
| Dashboard | Kennzahlen-Karten, Auftragsübersicht (siehe 07_WIREFLOWS_UX.md B1) |
| Benachrichtigungen | In-App, Event-getrieben |
| ERP-/Webhook-Grundlage | Adapter-Interface (Implementierung optional für MVP) |

**Definition of Done:** Abnahmeszenario F (Audit und Akte) aus Masterprompt Kap. 22 funktioniert.

---

### Phase 7 – Pilot und Härtung
**Dauer:** 4–6 Wochen

| Aktivität | Details |
|---|---|
| Pilot an begrenzter Produktlinie | 1-2 reale Fertigungslinien, begleitetes Onboarding |
| Usability unter realen Bedingungen | Beobachtung Handschuhbetrieb, Lichtverhältnisse, Konnektivität |
| Performance-Test | Lasttest gemäß 09_TEST_PYRAMID.md Ebene 8 |
| Penetrationstest | Externe Sicherheitsprüfung vor Rollout |
| Restore-Probe | Vollständige Disaster-Recovery-Simulation |
| Datenmigration | Falls Altsystem vorhanden, Migrationsskripte + Validierung |
| Schulung | Rollenbasierte Schulungsmaterialien |
| Supportprozess | Eskalationswege, On-Call definieren |
| Kontrollierter Rollout | Feature-Flag-gesteuert, Rückfallplan dokumentiert |

**Go-Live-Kriterien:**
- Alle 15 verbindlichen Negativtests grün in Produktionsumgebung
- Penetrationstest ohne kritische/hohe Findings (oder Findings behoben)
- Restore-Probe erfolgreich innerhalb definiertem RTO
- Pilotanwender-Feedback dokumentiert und kritische Punkte behoben
- Backup-Strategie aktiv und verifiziert

---

## Gesamtzeitplan (Grobschätzung)

```
Phase 0: Discovery              ▓▓▓                     (2-3 Wochen)
Phase 1: Fundament              ▓▓▓▓                    (3-4 Wochen)
Phase 2: Dokumente & Planung        ▓▓▓▓▓                (4-5 Wochen)
Phase 3: Online-Ausführung              ▓▓▓▓▓            (4-5 Wochen)
Phase 4: Qualität                           ▓▓▓▓         (4 Wochen)
Phase 5: Offline & Sync                         ▓▓▓▓▓▓   (5-6 Wochen)
Phase 6: Akte & Reporting                             ▓▓▓▓ (3-4 Wochen)
Phase 7: Pilot & Härtung                                  ▓▓▓▓▓▓ (4-6 Wochen)

Gesamt: ~29-37 Wochen (7-9 Monate) bis produktivem Piloten
```

**Hinweis:** Phasen 3+4 könnten teilweise parallelisiert werden (unterschiedliche Domänenmodule), sofern Team-Kapazität vorhanden. Phase 5 sollte NICHT parallelisiert werden – sie baut auf stabiler Online-Ausführung (Phase 3) auf.

---

## Kritischer Pfad

```
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 5 → Phase 7
                                   ↘ Phase 4 ↗
                                   ↘ Phase 6 ↗ (kann später einlaufen)
```

Phase 5 (Offline/Sync) ist der komplexeste und risikoreichste Teil. Empfehlung: Nach Phase 3 einen Zwischen-Checkpoint mit Stakeholdern, um Offline-Anforderungen final zu bestätigen, bevor Phase 5 beginnt.

---

## Migrationsstrategie (falls Altsystem vorhanden)

```
1. Datenexport aus Altsystem (CSV/API je nach Quelle)
2. Mapping-Tabellen: Alte IDs → neue UUIDs
3. Import in Staging-Umgebung
4. Validierung: Stichprobenvergleich (Projektzahlen, Dokumentenzahl, Nutzerzahl)
5. Dry-Run in Produktionskopie
6. Cutover-Fenster planen (idealerweise Schichtende/Wochenende)
7. Parallelbetrieb-Option für kritische Aufträge (falls Zeitdruck)
8. Rollback-Plan: Altsystem bleibt read-only verfügbar für definierten Zeitraum
```

**Ohne Altsystem (Neueinführung):** Vereinfachter Prozess – nur Stammdaten (Organisation, Standorte, initiale Benutzer, erste Produkte/Pläne) müssen manuell/per Skript angelegt werden.

---

## Priorisierte Entwicklungs-Tasks für Sprint 1 (Beispiel-Kickoff)

```markdown
- [ ] Next.js Projekt-Setup mit TypeScript strict
- [ ] Prisma Schema: organizations, sites, users, roles, permissions
- [ ] OIDC-Provider Integration (z.B. Keycloak lokal via Docker)
- [ ] Middleware: organization_id Enforcement auf jeder Route
- [ ] audit_events Tabelle + writeAuditEvent() Utility
- [ ] Erstes CI-Pipeline-Grundgerüst (Lint, Typecheck, Unit Tests)
- [ ] ADR-001: Authentifizierungsentscheidung dokumentieren
- [ ] ADR-002: Offline-Speicher-Technologie dokumentieren (IndexedDB vs. SQLite/WASM)
```

---

## Offene Entscheidungen (ADR-Kandidaten)

| ADR | Thema | Empfehlung (konservativ, konfigurierbar) |
|---|---|---|
| ADR-001 | Auth-Provider | Managed OIDC (Auth0/Keycloak) statt Eigenbau |
| ADR-002 | Offline-Speicher | IndexedDB via Dexie.js (Web), Evaluierung SQLite/WASM falls Performance unzureichend |
| ADR-003 | Dateispeicher | S3-kompatibel (AWS S3 oder MinIO self-hosted) |
| ADR-004 | Audit-Härtung | Start mit DB-Policy (kein UPDATE/DELETE), Hash-Verkettung als Phase-2-Erweiterung |
| ADR-005 | Signaturverfahren | PIN + Audit-Trail für MVP, keine qualifizierte elektronische Signatur ohne gesonderte Rechtsprüfung |
| ADR-006 | Mandantenmodell | Row-Level mit `organization_id` (nicht Schema-per-Tenant) für MVP-Einfachheit |
| ADR-007 | Queue/Worker-Technologie | BullMQ (Redis-basiert) für Einfachheit, evaluiere SQS bei AWS-Deployment |

Diese ADRs werden vor oder während Phase 1 final entschieden und als eigene Dokumente unter `docs/adr/` dokumentiert.

---

## Zusammenfassung: Bereitschaft zur Implementierung

Mit Abschluss dieses Dokuments sind alle 10 verbindlichen Vorab-Lieferungen aus Masterprompt Kap. 0 erstellt:

1. ✅ [Systemkontext und Architekturübersicht](01_SYSTEM_CONTEXT.md)
2. ✅ [Domänenmodell und Datenbank-ER-Modell](02_DOMAIN_MODEL.md)
3. ✅ [Statusautomaten](03_STATE_MACHINES.md)
4. ✅ [Rollen-, Rechte- und Freigabematrix](04_ROLES_PERMISSIONS_MATRIX.md)
5. ✅ [API- und Event-Verträge](05_API_CONTRACTS.md)
6. ✅ [Offline-, Konflikt- und Wiederanlaufkonzept](06_OFFLINE_SYNC_CONFLICT.md)
7. ✅ [Wireflows für alle Rollen](07_WIREFLOWS_UX.md)
8. ✅ [Bedrohungsmodell und Datenschutzkonzept](08_THREAT_MODEL_PRIVACY.md)
9. ✅ [Testpyramide und Abnahmekriterien](09_TEST_PYRAMID.md)
10. ✅ Priorisierter MVP- und Migrationsplan (dieses Dokument)

**Nächster Schritt:** Review durch Auftraggeber/Stakeholder, dann Start Phase 0 (Discovery) bzw. bei bereits validierten Annahmen direkter Start Phase 1 (Fundament) mit den oben gelisteten Sprint-1-Tasks.
