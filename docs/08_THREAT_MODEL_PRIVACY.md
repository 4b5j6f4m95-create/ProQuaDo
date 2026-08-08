# 8. Bedrohungsmodell und Datenschutzkonzept

**Dokumentversion:** 1.0
**Status:** Foundation
**Gültig ab:** 2026-08-08

---

## Teil A: Bedrohungsmodell (STRIDE-basiert)

### Asset-Übersicht

| Asset | Kritikalität | Warum |
|---|---|---|
| Audit Trail | Kritisch | Rechtliche/vertragliche Nachweispflicht, Manipulation = Vertrauensverlust |
| Dokumentrevisionen (Zeichnungen) | Kritisch | Falsche Version = fehlerhafte Produktion |
| Messwerte & Toleranzentscheidungen | Kritisch | Direkte Produktqualität/Sicherheit |
| Release Tokens | Hoch | Umgehung = unautorisierter Prozessfortschritt |
| Benutzeranmeldedaten/Sessions | Hoch | Zugriff auf gesamtes System |
| Personenbezogene Daten (Mitarbeiter) | Hoch | DSGVO-Pflicht |
| Produktionsakten (Export) | Mittel | Kundennachweis, Reputationsrisiko bei Leck |
| NCR-Daten | Mittel | Wettbewerbssensibel, aber weniger kritisch als Audit |

### STRIDE-Analyse

#### Spoofing (Identitätsfälschung)

| Bedrohung | Vektor | Mitigation |
|---|---|---|
| Gefälschte Benutzeridentität | Gestohlene Session/Token | OIDC/OAuth2, kurze Access Tokens, Device Binding, MFA für privilegierte Rollen |
| Gefälschter Release Token | Client generiert eigenen Token | HMAC-Signatur mit serverseitigem Secret, Server-Revocation-Check bei Online-Validierung |
| Vorgetäuschte Geräte-Identität | Device-ID Spoofing | Device Registration + Zertifikat-Pinning (Phase 2) |

#### Tampering (Manipulation)

| Bedrohung | Vektor | Mitigation |
|---|---|---|
| Manipulierter Completion-Status | Client sendet "COMPLETED" direkt | Client-Typ kennt diesen Zustand nicht; Server validiert unabhängig alle Bedingungen erneut |
| Foto-Nachbearbeitung nach Erfassung | Client verändert Bilddatei vor Upload | SHA-256 Hash-Verifikation bei Upload-Abschluss |
| Messwert-Manipulation | Client sendet falschen Wert | Serverseitige Neuvalidierung gegen Toleranzgrenzen (Snapshot zum Ausführungszeitpunkt) |
| Audit-Log-Manipulation | Direkter DB-Zugriff oder App-Bug | DB-Policy verbietet UPDATE/DELETE für App-Rolle; optional Hash-Verkettung |
| Dokumentrevision nachträglich verändert | Storage-Zugriff | Objektspeicher immutable/versioniert, Hash in DB verankert |

#### Repudiation (Abstreitbarkeit)

| Bedrohung | Vektor | Mitigation |
|---|---|---|
| Mitarbeiter bestreitet Ausführung | Fehlende Zuordnung | Jede Aktion mit Actor-ID, Zeitstempel, Signatur/PIN im Audit |
| Freigabe wird abgestritten | Fehlende Nachvollziehbarkeit | `document_approvals`/`second_approvals` mit Identität + Zeitpunkt + Grund |

#### Information Disclosure (Offenlegung)

| Bedrohung | Vektor | Mitigation |
|---|---|---|
| Mandantenübergreifender Datenzugriff | IDOR bei fehlender org_id-Prüfung | Jede Query erzwingt `organization_id` Filter; Middleware-Layer prüft konsistent |
| Erraten von Objekt-IDs | Sequentielle IDs | UUID v4 für alle Primary Keys |
| Zugriff über QR-Code-Resolver | Nicht autorisierter Scan | Resolver prüft Berechtigung, nicht nur Existenz; 403 statt Datenleck |
| Sensible Daten in Logs | Debug-Logging von Payloads | Strukturiertes Logging mit Redaction-Filter für PII/Secrets |
| Foto-Metadaten (GPS) | Unbeabsichtigte Standortpreisgabe | Nur bei legitimem Zweck + Konfiguration verarbeitet, sonst gestrippt |

#### Denial of Service

| Bedrohung | Vektor | Mitigation |
|---|---|---|
| Massenhafte Sync-Requests | Kompromittiertes/fehlerhaftes Gerät | Rate Limiting pro Device/User (siehe 05_API_CONTRACTS.md) |
| Große Datei-Uploads | Ressourcenerschöpfung | Größenlimits, Streaming-Upload direkt zu S3 |
| Malformed Payloads | Absichtlich/versehentlich fehlerhafte Requests | Schema-Validierung vor Verarbeitung (Zod/JSON Schema) |

#### Elevation of Privilege

| Bedrohung | Vektor | Mitigation |
|---|---|---|
| Worker führt QM-Aktion aus | Fehlende serverseitige RBAC-Prüfung | Jede Domänenoperation prüft Berechtigung serverseitig, nicht nur UI-Ausblendung |
| Admin erteilt sich fachliche Freigabe | Rollenkombination | Admin-Rolle hat explizit KEINE automatische fachliche Freigabeberechtigung (siehe 04) |
| Vier-Augen-Umgehung | Gleicher Account für Ausführung+Prüfung | DB-Constraint `executor_id != reviewer_id` |
| Abgelaufene Qualifikation genutzt | Fehlende Zeitprüfung | Serverseitige Prüfung `expires_at > now()` bei jeder qualifikationspflichtigen Aktion |

---

### Kritische Angriffsszenarien (Detailliert)

#### Szenario 1: IDOR – Mandantengrenze umgehen

```
Angreifer (Org A) versucht: GET /api/v1/work-steps/{id-von-org-B}

Erwartetes Verhalten:
1. Middleware extrahiert organization_id aus Session/JWT
2. Repository-Query IMMER mit WHERE organization_id = :sessionOrgId
3. Wenn Objekt nicht gefunden (weil falsche Org): 404, NICHT 403
   (403 würde verraten, dass die ID existiert)
4. Kein Fehlerdetail, das auf Existenz hinweist
```

```typescript
// Sicheres Pattern
async function getWorkStep(id: string, sessionOrgId: string) {
  const step = await db.workStepInstance.findFirst({
    where: { id, organizationId: sessionOrgId }  // NIEMALS ohne orgId-Filter
  });
  if (!step) throw new NotFoundError();  // 404, kein Unterschied zu "existiert nicht"
  return step;
}
```

#### Szenario 2: Release Token Replay/Fälschung

```
Angreifer versucht: Release Token von Schritt N für Schritt N+1 zu nutzen

Verteidigung:
1. Token enthält workStepInstanceId spezifisch für Schritt N
2. canStartWorkStep(N+1) prüft: token.workStepInstanceId === N+1.id
3. Mismatch → INVALID_RELEASE_TOKEN, 403
4. Selbst bei Signatur-Gültigkeit: Token ist an genau eine Instanz gebunden
```

#### Szenario 3: SSRF über Dokument-Upload

```
Angreifer versucht: URL-Feld in Upload-Metadaten mit internem Endpoint

Verteidigung:
1. Upload erfolgt über signierte S3-URLs, nicht durch Server-Fetch externer URLs
2. Keine Server-seitige Funktion lädt Dateien von client-gelieferten URLs herunter
3. CAD/Office-Dateien mit externen Verweisen (OLE, Makros) werden beim Malware-Scan geprüft/blockiert
```

#### Szenario 4: SQL Injection

```
Mitigation: Ausschließlich Prisma ORM mit parametrisierten Queries.
Keine String-Konkatenation für SQL. Raw SQL nur mit Prisma.$queryRaw
und Template-Literal-Parametrisierung, nie mit String-Interpolation.
```

---

## Bedrohungsmodell nach Datenfluss

```
┌─────────┐  HTTPS/TLS1.3  ┌─────────┐   Prisma/param.   ┌──────────┐
│ Client  │───────────────>│  API    │───────────────────>│PostgreSQL│
│(Tablet) │<───────────────│  Layer  │<───────────────────│          │
└─────────┘                └────┬────┘                    └──────────┘
     │                          │
     │ signed URL               │ least-privilege
     ▼                          ▼
┌─────────┐                ┌─────────┐
│   S3    │                │  Queue  │
│(Storage)│                │(Worker) │
└─────────┘                └─────────┘

Trust Boundaries:
═══ Client ↔ API: nicht vertrauenswürdig, alles validieren
═══ API ↔ DB: vertrauenswürdig, aber least-privilege DB-User
═══ API ↔ S3: signierte, kurzlebige URLs, kein permanenter Zugriff
═══ Worker ↔ DB: gleiche Vertrauensstufe wie API, idempotent
```

---

## Sicherheitskontrollen (Zusammenfassung)

| Kategorie | Kontrolle |
|---|---|
| Authentifizierung | OIDC/OAuth2, MFA für privilegierte Rollen |
| Session | Kurze Access Tokens (15min), Refresh Token Rotation, serverseitiger Widerruf |
| Transport | TLS 1.3 überall, HSTS |
| Ruhende Daten | AES-256 (DB Encryption at Rest, S3 SSE) |
| Secrets | Managed Secret Store (Vault/AWS Secrets Manager), keine Secrets im Code/Repo |
| CSRF | SameSite Cookies + CSRF Token für State-Changing Requests |
| XSS | Content Security Policy, kontextgerechtes Encoding, React's Default-Escaping |
| SSRF | Keine server-seitigen Fetches von client-gelieferten URLs |
| SQL Injection | Prisma ORM, parametrisierte Queries |
| IDOR | organization_id-Filter auf jeder Query, konsistent über Repository-Layer |
| Unsicherer Upload | Signierte URLs, MIME-Type-Whitelist, Malware-Scan, Größenlimits |
| Security Header | CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy |
| Abhängigkeiten | Automatisierte Dependency-Scans (Dependabot/Snyk), SAST in CI |
| Secret Scanning | Pre-commit Hooks + CI-Scan (gitleaks) |
| Penetrationstest | Jährlich vor Major-Release, vor Piloten |

---

## Teil B: Datenschutzkonzept (DSGVO)

### Zweckbindung und Datenminimierung

| Datenkategorie | Zweck | Minimierung |
|---|---|---|
| Mitarbeiter-Ausführungsdaten | Qualitätsnachweis, Rückverfolgbarkeit | Nur relevante Felder (kein Vollprofil) |
| Fotos von Arbeitsschritten | Nachweisführung Produktqualität | Keine unbeabsichtigte Personen-/Umgebungserfassung (Anweisung an Mitarbeiter, Kamerawinkel) |
| GPS-Metadaten | Nur wenn fachlich zwingend (z.B. Vor-Ort-Montage) | Standardmäßig deaktiviert, opt-in mit Konfiguration |
| Login-/Sicherheitsereignisse | Sicherheit, Missbrauchserkennung | Aufbewahrung befristet (z.B. 90 Tage für reine Security-Logs, länger für Audit) |

### Rechtsgrundlage

- Primär: Erfüllung arbeitsvertraglicher Pflichten (Art. 6 Abs. 1 lit. b DSGVO) und berechtigtes Interesse an Qualitätssicherung (Art. 6 Abs. 1 lit. f)
- Dokumentation der Rechtsgrundlage erfolgt **außerhalb der Software** durch den Auftraggeber (Betriebsvereinbarung, Datenschutzerklärung)
- Software liefert technische Grundlage (Zweckbindung, Zugriffskontrolle), ersetzt keine rechtliche Beratung

### Rollenbasierte Sichtbarkeit

| Datentyp | Sichtbar für |
|---|---|
| Mitarbeiter-Ausführungsdaten (wer hat was wann gemacht) | QM, Projektleiter, Produktionsleiter (im Kontext), Admin (eingeschränkt), Auditor (zweckgebunden) |
| Vollständige Mitarbeiterhistorie (Leistungsprofil) | NICHT als Standard-Feature; wenn benötigt, nur mit expliziter betrieblicher Regelung |
| Audit-Trail mit Actor-Details | QM, Admin (read-only), Auditor (zweckgebunden) |

**Explizit vermieden:** Kein automatisiertes Mitarbeiter-Ranking, Scoring oder Leistungsüberwachungs-Dashboard im Standardumfang – dies würde eine gesonderte Datenschutz-Folgenabschätzung und ggf. Mitbestimmung erfordern.

### Aufbewahrung und Löschung

| Datentyp | Aufbewahrungsfrist (Standard) | Löschmechanismus |
|---|---|---|
| Audit Events | 7 Jahre (konfigurierbar je Compliance-Anforderung) | Keine Löschung, nur Archivierung nach Frist |
| Produktionsakten | Vertrags-/gesetzlich vorgegeben (z.B. 10 Jahre) | Archivierung, kein Hard Delete |
| Fotos/Evidenz | An Produktionsakte gekoppelt | Gekoppelt an Akte-Retention |
| Session-/Security-Logs | 90 Tage | Automatisierte Bereinigung |
| Lokale Geräte-Caches | Konfigurierbar (Standard 30 Tage) | Automatisch nach Sync-Bestätigung |
| Gekündigte Mitarbeiter (Stammdaten) | Nach gesetzlicher Frist anonymisieren | `employees.user_id` → anonymisiert, historische Audit-Einträge bleiben mit Pseudonym |

**Prinzip:** Kritische Geschäftsdaten werden **nicht hart gelöscht** (siehe Geschäftsgrundsatz 7). Löschanfragen (Art. 17 DSGVO) werden über **Pseudonymisierung/Anonymisierung** umgesetzt, nicht über Entfernung der Nachweiskette.

```typescript
// Beispiel: Mitarbeiter-Anonymisierung statt Löschung
async function anonymizeEmployee(employeeId: string, reason: string) {
  await db.$transaction(async (tx) => {
    // 1. Personal-Stammdaten pseudonymisieren
    await tx.users.update({
      where: { id: employeeId },
      data: {
        email: `anonymized-${uuid()}@deleted.local`,
        displayName: `Ehemaliger Mitarbeiter ${shortHash(employeeId)}`,
        isActive: false
      }
    });
    // 2. Audit-Trail BLEIBT bestehen (append-only), referenziert
    //    weiterhin die User-ID, aber Anzeige nutzt jetzt pseudonymisierten Namen
    // 3. Audit-Event über die Anonymisierung selbst wird geschrieben
    await writeAuditEvent(tx, {
      eventType: 'user.anonymized',
      resourceId: employeeId,
      reason
    });
  });
}
```

### Auskunfts- und Exportprozess

```
GET /api/v1/privacy/data-export/{userId}
→ Erzeugt strukturierten Export aller personenbezogenen Daten
  eines Nutzers (Ausführungen, Bestätigungen, Fotos mit Personenbezug)
→ Asynchroner Report Job, Benachrichtigung bei Fertigstellung
→ Zugriff nur durch Admin/DPO-Rolle mit Begründung (auditiert)
```

### Kontrollierte Berichtigung

Keine direkte Überschreibung historischer Daten. Berichtigungen erfolgen als **Nachtrag** mit Verweis auf Original:

```
correction_records:
  - original_record_id
  - correction_reason
  - corrected_by
  - corrected_at
  - new_value (nur Anzeige-Override, Original bleibt im Audit)
```

### Auftragsverarbeitung & Datenresidenz

- Betrieb dokumentiert Auftragsverarbeitungsvertrag (AVV) mit Hosting-Anbieter außerhalb der Software
- Datenresidenz: EU-Rechenzentren empfohlen (z.B. AWS eu-central-1)
- Unterauftragnehmer (S3-Provider, E-Mail-Versand) werden in einer Anbieterliste dokumentiert (außerhalb Software-Scope, aber Software muss Konfiguration dafür bereitstellen)

### Datenschutz-Folgenabschätzung (DSFA) – Trigger

Eine DSFA wird empfohlen, wenn:
- GPS-Tracking von Mitarbeitern aktiviert wird
- Biometrische Signaturverfahren eingeführt werden (Phase 2+)
- Automatisierte Leistungsbewertung auf Basis der Ausführungsdaten erfolgt (nicht im Standardumfang)

**Software-seitige Vorbereitung:** Feature-Flags für GPS/Biometrie sind standardmäßig deaktiviert und erfordern explizite Aktivierung + Dokumentation der Rechtsgrundlage durch den Betreiber.

---

## Nächste Schritte

→ **09_TEST_PYRAMID.md**: Testpyramide und Abnahmekriterien
