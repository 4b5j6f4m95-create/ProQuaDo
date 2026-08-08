# Entwicklungsnotizen

Praktische Hinweise für die lokale Arbeit an ProQuaDo, ergänzend zu `docs/` (Architektur) und den ADRs. Diese Datei ist ein lebendes Arbeitsdokument, kein verbindliches Spezifikationsdokument.

---

## Stand

- **Phase 1 (Fundament)**: abgeschlossen — Auth (OIDC/Keycloak), RBAC/ABAC, Mandantentrennung via RLS, Audit-Trail, CI-Pipeline.
- **Phase 2 (Dokumente und Planung)**: abgeschlossen — Projekte, Dokument-Freigabeworkflow, Fertigungsplan mit Zyklenerkennung, Objektspeicher (S3/MinIO), funktionale UI.
- **Nächster Schritt**: Phase 3 (Online-Ausführung) gemäß [docs/10_MVP_PLAN.md](docs/10_MVP_PLAN.md) — Tablet-UI, serverseitige Schrittfreigabe, Checklisten/Fotos/Messwerte, Abschlussvalidierung.

Alle 10 Architekturdokumente in `docs/` sind vor der Implementierung entstanden und sollten bei Unklarheiten zuerst konsultiert werden.

---

## Lokale Umgebung starten

```bash
docker compose up -d postgres minio minio-init keycloak
pnpm install
pnpm exec prisma migrate deploy
pnpm exec tsx prisma/seed.ts
pnpm run dev
```

**Ports:** Postgres `5433`, MinIO `9010`/`9011` (Console), Keycloak `8081`, App `3000` (Standard) — siehe unten zu Portkonflikten.

**Demo-User** (Keycloak-Passwort für alle: `devpassword`), verknüpft über den `pending:<email>`-Mechanismus beim ersten Login (siehe `src/lib/auth/resolve-login.ts`):

| User | Rolle |
|---|---|
| `admin.test@proquado.local` | ADMIN |
| `worker.test@proquado.local` | WORKER |
| `pl.test@proquado.local` | PROJECT_LEAD |
| `qm.test@proquado.local` | QUALITY_MANAGER |

Seed legt zusätzlich ein Demo-Projekt (`PROJ-2026-0001`) mit Site, Customer und Product an.

---

## Bekannte Stolpersteine (lokal aufgetreten, für die Zukunft dokumentiert)

### Portkonflikte mit anderen Projekten
Auf dieser Maschine liefen parallel andere Next.js-Projekte auf Port 3000/3001. `.env.example` und die Keycloak-Realm-Config (`infra/keycloak/proquado-realm.json`) gehen von Port **3000** aus. Falls belegt: `.claude/launch.json` auf einen freien Port ändern (aktuell `3002` konfiguriert) **und** die lokale `.env` (`AUTH_URL`) entsprechend anpassen. Die Keycloak-Realm-Config akzeptiert bereits beide Redirect-URIs (3000 und 3002).

### `pino-pretty` + Next.js Dev-Server
`pino`s Standard-Transport (`transport: { target: 'pino-pretty' }`) nutzt Worker Threads, die Next.js' Server-Bundling nicht auflösen kann (`Cannot find module .next/server/vendor-chunks/lib/worker.js`, crasht jeden Request). Fix in `src/lib/logger/index.ts`: `pino-pretty` als synchroner Destination-Stream statt als Transport. Nicht zurückändern.

### CSP blockiert Dev-Tooling und OAuth-Redirect
Eine strikte `Content-Security-Policy` (`script-src 'self'`, `form-action 'self'`) verhindert sowohl Next.js' HMR (inline Scripts) als auch den Redirect zu Keycloak (`form-action` erlaubt nur die eigene Origin). Fix in `next.config.mjs`: CSP wird nur in Production gesetzt, `form-action` schließt dort die OIDC-Issuer-Origin explizit ein.

### Prisma-Client-Regenerierung erfordert Server-Neustart
Nach `prisma generate` (z. B. nach Schema-Änderungen) muss der laufende `next dev`-Prozess neu gestartet werden — Hot Reload lädt den neu generierten Client nicht automatisch nach.

### Browser-Tool: Klick-Koordinaten können bei mehrzeiligen Überschriften driften
Bei der UI-Verifikation über das Browser-Automatisierungstool führte ein zweizeilig umbrechender Seitentitel zu einer Koordinatenverschiebung, wodurch ein `left_click` auf eine stale `ref`-Position daneben traf (kein Klick, kein Request). Workaround: bei Formularen mit variabler Kopfzeilenhöhe den Submit direkt per `button.click()` über `javascript_tool` auslösen statt über Koordinaten-Klicks.

### Relationsnamen bei bidirektionalen Prisma-Beziehungen
Ein echter Bug wurde beim Browser-Test gefunden: `PlanStep.predecessors`/`.dependents` waren so benannt, dass sie das Gegenteil dessen enthielten, was der Name suggeriert (Prisma-Rückrelationen benennen sich nach der Relation, nicht nach der eigenen Rolle). Umbenannt zu `predecessorLinks`/`successorLinks` mit erklärendem Kommentar direkt im Schema. **Lehre:** Bei selbstreferenzierenden n:m-artigen Relationen über ein Join-Modell (hier `PlanStepDependency`) immer explizit prüfen, welche Richtung eine Rückrelations-Array tatsächlich liefert — nicht vom Feldnamen ausgehen.

---

## Architekturentscheidungen mit Nachwirkung

- **`production_plan.release` ist Standard-Berechtigung von PROJECT_LEAD**, nicht nur konfigurierbar (`*` in der Matrix). Ohne diese Korrektur konnte niemand einen Plan freigeben — siehe `src/domain/identity/system-roles.ts` Kommentar für die Begründung (Masterprompt Kap. 3 weist Planerstellung/-freigabe der Projektleitung zu, anders als bei Dokumenten, wo QM die eindeutige Instanz ist).
- **Domain-Services prüfen ihre eigene Berechtigung** (`assertPermission` als erster Schritt in jeder Service-Funktion), nicht nur die aufrufende API-Route. Das macht sie gegen zukünftige Aufrufer (Tests, Skripte, andere Services) selbstverteidigend.
- **Malware-Scan ist ein Stub** (`src/lib/storage/malware-scan.ts`) — meldet immer `CLEAN`. Vor jedem Piloten/Produktivbetrieb durch echten Scanner ersetzen (siehe Kommentar dort und `docs/20` Phase 7).

---

## Test-Kommandos

```bash
pnpm run test:unit          # schnell, keine Infrastruktur nötig
pnpm run test:integration   # startet echte Postgres+MinIO-Container (Testcontainers)
pnpm run build               # Production Build als Kompilier-/Bundling-Check
```

Alle Integrationstests laufen gegen **echte** Infrastruktur, nicht gegen Mocks — siehe `docs/09_TEST_PYRAMID.md`.
