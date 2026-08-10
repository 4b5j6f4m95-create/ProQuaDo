import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 nimmt Verbindungs-URLs nicht mehr im Schema entgegen: die
 * Anwendung baut ihren Client über einen Treiber-Adapter (siehe
 * src/lib/db/client.ts), und *Migrate* holt sich seine Verbindung hier.
 *
 * Die Trennung, die ADR-006 verlangt, bleibt dabei erhalten und wird sogar
 * deutlicher: Migrationen laufen über `DIRECT_DATABASE_URL`, also die
 * schemabesitzende Rolle, die RLS umgeht. Die Anwendung selbst sieht diese
 * URL nie — sie verbindet als `proquado_app`, für die jede RLS-Policy gilt.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_DATABASE_URL,
  },
});
