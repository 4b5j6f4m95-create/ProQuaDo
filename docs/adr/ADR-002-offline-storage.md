# ADR-002: Offline-Speicher-Technologie

**Status:** Akzeptiert
**Datum:** 2026-08-08

## Kontext

Der Masterprompt verlangt eine verschlüsselte lokale Datenbank für Offline-Projektion, Outbox-Kommandos und Binärdateien (Fotos). Zielplattform ist "Tablet-first Web/PWA" (Kap. 0), das MVP fokussiert auf Web zuerst (native Apps sind Nichtziel des ersten Releases, Kap. 1).

## Entscheidung

Für das MVP verwenden wir **IndexedDB via Dexie.js** als lokale Datenbank im Browser/PWA-Kontext:

- Dexie.js bietet TypeScript-Typsicherheit, Transaktionen und einen ergonomischen Query-Layer über IndexedDB
- Verschlüsselung: `dexie-encrypted` oder äquivalent, Schlüssel abgeleitet aus Web Crypto API + Session-gebundenem Secret
- Binärdateien (Fotos): Origin Private File System (OPFS) wo verfügbar, sonst IndexedDB Blob-Storage
- Outbox-Tabelle: append-only lokale Tabelle mit `sequenceNumber`, nie in-place verändert

**Re-Evaluierung vorgesehen:** Falls Performance-Tests in Phase 5 zeigen, dass IndexedDB bei großen Fotomengen (>500 pro Gerät) nicht ausreicht, wird SQLite via WASM (`sql.js` oder `wa-sqlite`) evaluiert. Dies ist explizit als offener Punkt in 10_MVP_PLAN.md vermerkt und wird vor Abschluss von Phase 5 entschieden, nicht vor Phase 1.

## Konsequenzen

**Positiv:**
- Keine native App-Entwicklung nötig, PWA-Ansatz konsistent mit Web-first-Strategie
- Dexie.js ist reif, gut getestet, TypeScript-nativ
- Web Crypto API deckt Verschlüsselungsanforderungen ab

**Negativ:**
- IndexedDB-Performance bei sehr großen Binärdateimengen ungewiss – erfordert Lasttest in Phase 5
- Browser-Speicherlimits variieren (Safari restriktiver als Chrome) – erfordert Backpressure-UI (siehe 06_OFFLINE_SYNC_CONFLICT.md)

**Alternativen erwogen:**
- SQLite/WASM sofort: verworfen für MVP wegen höherer Komplexität ohne nachgewiesenen Bedarf
- Native App (React Native/Capacitor) mit echtem SQLite: verworfen als Nichtziel des ersten Releases
