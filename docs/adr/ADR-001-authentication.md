# ADR-001: Authentifizierungsentscheidung

**Status:** Akzeptiert
**Datum:** 2026-08-08

## Kontext

Der Masterprompt (Kap. 16) verlangt einen etablierten OIDC/OAuth2-Provider oder eine sichere Auth-Lösung, MFA für privilegierte Rollen, kurze Access Tokens, serverseitigen Widerruf und Gerätezulassung. Wir wollen keine Authentifizierung selbst entwickeln (Passwort-Hashing, Session-Fixation, etc. sind gut gelöste, aber fehleranfällige Probleme).

## Entscheidung

Wir verwenden **Auth.js (NextAuth.js) v5** mit einem generischen **OIDC-Provider**, lokal für Entwicklung über **Keycloak** (Docker) bereitgestellt. In Produktion kann der gleiche generische OIDC-Adapter gegen jeden konformen Identity Provider (Keycloak, Auth0, Azure AD, Okta) konfiguriert werden – die Anwendung bindet sich nicht an einen spezifischen Anbieter.

- Access Tokens: kurzlebig (15 Minuten), JWT-basiert
- Refresh Tokens: rotierend, serverseitig widerrufbar (Session-Tabelle)
- MFA: wird auf IdP-Ebene erzwungen (Keycloak Required Actions / Conditional Access), nicht in der Anwendung dupliziert
- Device Binding: eigene `devices`-Tabelle, verknüpft mit Session, für Offline-Client-Identifikation (siehe 06_OFFLINE_SYNC_CONFLICT.md)
- Re-Authentifizierung für kritische Aktionen: kurzlebiger "step-up" Token nach PIN-Bestätigung, unabhängig von der Hauptsession (siehe 04_ROLES_PERMISSIONS_MATRIX.md)

## Konsequenzen

**Positiv:**
- Kein Eigenbau von Passwort-Hashing/Session-Handling
- Etablierte Sicherheitspraxis, regelmäßig gepatcht
- Anbieterwechsel ohne Code-Änderung möglich (nur Konfiguration)
- MFA-Policy zentral beim IdP verwaltet

**Negativ:**
- Zusätzliche Infrastrukturkomponente (IdP) in Produktion erforderlich
- Lokale Entwicklung erfordert Keycloak-Container (Docker Compose)

**Alternativen erwogen:**
- Eigenbau mit `bcrypt`/`argon2`: verworfen wegen Sicherheitsrisiko und Wartungsaufwand
- Firebase Auth / Clerk (SaaS): verworfen wegen Datenresidenz-Bedenken (DSGVO, siehe 08_THREAT_MODEL_PRIVACY.md) und Vendor-Lock-in ohne Selbsthosting-Option
