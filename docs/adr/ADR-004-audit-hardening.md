# ADR-004: Audit-Härtung

**Status:** Akzeptiert
**Datum:** 2026-08-08

## Kontext

Der Audit Trail muss append-only sein; Anwendungskonten dürfen keine Update-/Delete-Rechte auf Audit-Datensätze besitzen (Masterprompt Kap. 10).

## Entscheidung

Für das MVP setzen wir zwei Verteidigungsebenen um:

1. **Datenbankrechte:** Der von der Anwendung genutzte PostgreSQL-Rollen-User erhält auf `audit_events` ausschließlich `INSERT` und `SELECT` – kein `UPDATE`, kein `DELETE`. Dies wird per Migration (`REVOKE UPDATE, DELETE ON audit_events FROM app_role;`) erzwungen, nicht nur per Anwendungskonvention.
2. **Row-Level Security Policy:** Zusätzlich `CREATE POLICY audit_no_update ON audit_events FOR UPDATE USING (false);` und äquivalent für DELETE, als Defense-in-Depth falls Rollen-Grants versehentlich erweitert werden.

**Hash-Verkettung (Merkle-artige Integritätskette) wird NICHT für das MVP umgesetzt**, sondern als Phase-2-Erweiterung vorgemerkt: Jeder Audit-Event könnte einen Hash über `(previous_hash, event_payload)` speichern, um nachträgliche Zeilenmanipulation durch einen Datenbank-Admin nachweisbar zu machen. Für MVP reicht DB-Rechte + RLS, da dies bereits Anwendungsebene-Angriffe vollständig verhindert; das verbleibende Restrisiko (böswilliger DB-Admin) wird organisatorisch (Zugriffskontrolle auf Produktions-DB) statt kryptographisch adressiert.

## Konsequenzen

**Positiv:**
- Kein Anwendungsbug kann Audit-Einträge nachträglich verändern
- Geringe Implementierungskomplexität für MVP

**Negativ:**
- Kein kryptographischer Nachweis gegen privilegierten DB-Zugriff (Restrisiko dokumentiert, nicht eliminiert)
- Externe Versiegelung (periodisches Hash-Publishing) noch nicht umgesetzt

**Alternativen erwogen:**
- Sofortige Hash-Verkettung: verworfen für MVP, Komplexität ohne unmittelbaren Bedarf; wird bei Kundenanforderung oder vor Zertifizierungsvorbereitung nachgezogen
- Externes Audit-Log-System (z.B. AWS CloudTrail-Pattern, separates Log-Only-DB): als Phase-2-Option vorgemerkt
