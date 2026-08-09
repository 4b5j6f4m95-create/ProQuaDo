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

---

## Nachtrag (2026-08-09): Sitzungsdauer 8 Stunden

**Anlass.** Die Implementierung hatte die oben genannten 15 Minuten auf die **Sitzung** angewandt (`session.maxAge`), obwohl die Entscheidung das **Access Token** betrifft. Das sind zwei verschiedene Dinge, und der Unterschied wurde erst sichtbar, als der Offline-Durchlauf in Phase 7 zum ersten Mal vollständig durchgespielt wurde: ein Tablet, das eine Schicht ohne Verbindung arbeitet, kehrt mit abgelaufener Sitzung zurück und kann das Erfasste erst nach einer neuen Anmeldung abliefern.

**Entscheidung.** `session.maxAge` steht auf **8 Stunden** — eine Schicht. Die Aussage zu Access Tokens oben bleibt unberührt.

**Warum das vertretbar ist.** Nicht, weil das Risiko klein wäre, sondern weil das Sitzungsalter hier wenig kauft: jede Handlung mit Folgen — Schrittabschluss, Vier-Augen-Entscheidung, Konfliktentscheidung, Produktfreigabe — verlangt unabhängig vom Alter der Sitzung eine PIN-Rückbestätigung (docs/04 „Re-Authentifizierung für kritische Aktionen", [ADR-005](ADR-005-signature-method.md)). Wer ein unbeaufsichtigtes Tablet vorfindet, kann damit lesen, aber nichts bestätigen, was jemandem zugerechnet würde.

Hinzu kommt, dass es seit Phase 7 überhaupt eine Abmeldung gibt: ein geteiltes Gerät kann absichtlich weitergegeben werden, statt darauf zu warten, dass eine Sitzung von selbst verfällt.

**Was das kostet, ausdrücklich benannt.** Ein liegengelassenes, angemeldetes Tablet gibt acht Stunden lang Lesezugriff auf die Aufträge seines Benutzers. Dagegen hilft diese Entscheidung nicht — dagegen helfen die Fernsperre (docs/06), die Gerätebindung und die betriebliche Regel, sich abzumelden. Wer das Risiko anders bewertet, senkt den Wert hier; der Preis ist die Reibung, die oben beschrieben ist.

**Nicht mitentschieden:** die Bildschirmsperre des Geräts selbst. Sie ist in der Praxis die wirksamere Maßnahme gegen ein unbeaufsichtigtes Tablet und gehört in die Gerätekonfiguration, nicht in diese Anwendung.
