# ADR-006: Mandantenmodell

**Status:** Akzeptiert
**Datum:** 2026-08-08

## Kontext

Der Masterprompt verlangt Mandantenfähigkeit im Datenmodell, auch wenn initial nur eine Organisation betrieben wird (Kap. 1, "Mandanten- und Organisationsfähigkeit").

## Entscheidung

Wir verwenden **Row-Level Multi-Tenancy** mit `organization_id`-Spalte auf allen mandantenrelevanten Tabellen, nicht Schema-per-Tenant oder Datenbank-per-Tenant.

- Jede Tabelle mit Geschäftsdaten trägt `organization_id UUID NOT NULL REFERENCES organizations(id)`
- **Jede** Repository-Query filtert zwingend nach `organization_id` aus dem authentifizierten Kontext – durchgesetzt über einen gemeinsamen Repository-Basis-Layer, nicht optional pro Query
- PostgreSQL Row-Level Security (RLS) wird als zusätzliche Verteidigungsebene aktiviert (`current_setting('app.current_org_id')`), sodass selbst bei einem Bug in der Anwendungsschicht kein Cross-Tenant-Leak über direkte DB-Queries möglich ist
- Kein Connection-Pooling-Konflikt: `SET LOCAL app.current_org_id` pro Transaktion, nicht pro Connection

## Konsequenzen

**Positiv:**
- Einfacher zu betreiben als Schema-per-Tenant (eine Migration, ein Connection Pool)
- Skaliert für die erwartete Anzahl Organisationen (zunächst eine, später mehrere mittelständische Fertigungsbetriebe – nicht SaaS-Skala mit tausenden Mandanten)
- RLS als Defense-in-Depth ergänzt Anwendungslogik, ersetzt sie aber nicht (siehe 08_THREAT_MODEL_PRIVACY.md, IDOR-Vermeidung)

**Negativ:**
- Erfordert Disziplin: jede neue Tabelle mit Geschäftsbezug MUSS `organization_id` erhalten (wird über Prisma-Schema-Konvention + Code-Review-Checkliste erzwungen)
- RLS erfordert sorgfältiges Transaktions-Handling (`SET LOCAL` statt `SET`, um Connection-Pool-Leaks zu vermeiden)

**Alternativen erwogen:**
- Schema-per-Tenant: verworfen, unnötige operative Komplexität (Migrationen pro Schema) für die erwartete Mandantenanzahl
- Datenbank-per-Tenant: verworfen, zu teuer/komplex für MVP-Skala, könnte bei Bedarf für Enterprise-Großkunden später als Option ergänzt werden
