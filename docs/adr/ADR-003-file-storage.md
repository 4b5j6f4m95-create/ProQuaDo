# ADR-003: Dateispeicher

**Status:** Akzeptiert
**Datum:** 2026-08-08

## Kontext

Dokumente, Fotos und Exporte müssen objektbasiert gespeichert werden, mit signierten kurzlebigen Upload-URLs, Versionierung und Verschlüsselung ruhender Daten (Masterprompt Kap. 7, 14, 16).

## Entscheidung

Wir verwenden einen **S3-kompatiblen Objektspeicher** über eine Adapter-Abstraktion:

- Produktion: AWS S3 (oder äquivalenter S3-kompatibler Dienst in EU-Region, siehe 08_THREAT_MODEL_PRIVACY.md Datenresidenz)
- Lokale Entwicklung: MinIO via Docker Compose (S3-API-kompatibel, kein AWS-Account nötig)
- Zugriff ausschließlich über kurzlebige signierte URLs (Presigned URLs, 15 Minuten Gültigkeit)
- Server lädt niemals Dateien clientseitig vorgegebener URLs herunter (SSRF-Vermeidung, siehe 08_THREAT_MODEL_PRIVACY.md)
- Objektversionierung aktiviert (S3 Versioning) für Revisionssicherheit
- Server-Side Encryption (SSE-S3 oder SSE-KMS) für ruhende Daten

Die Anwendung kapselt Storage-Zugriffe hinter einem Port/Adapter-Interface (`ObjectStorageService`), sodass ein Anbieterwechsel (z.B. Azure Blob, GCS) ohne Domänenlogik-Änderung möglich ist.

## Konsequenzen

**Positiv:**
- Etablierte, skalierbare Lösung für Binärdaten
- MinIO ermöglicht identisches API-Verhalten lokal wie in Produktion
- Presigned URLs vermeiden Server als Datei-Proxy (Performance + Sicherheit)

**Negativ:**
- Zusätzliche Infrastrukturkomponente
- Malware-Scanning muss als separater Schritt integriert werden (S3 selbst scannt nicht)

**Alternativen erwogen:**
- Dateisystem-Speicher auf Server: verworfen, nicht horizontal skalierbar, kein natives Versioning
- Datenbank-BLOBs: verworfen, PostgreSQL nicht für große Binärdaten optimiert
