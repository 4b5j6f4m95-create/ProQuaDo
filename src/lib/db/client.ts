import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Seit Prisma 7 verbindet der Client nicht mehr selbst: die Rust-Engine ist
 * weg, die Verbindung kommt über einen Treiber-Adapter — hier `pg`. Die URL
 * steht deshalb nicht mehr im Schema, sondern genau an zwei Stellen: hier für
 * die Anwendung (`DATABASE_URL`, Rolle `proquado_app`, RLS gilt) und in
 * `prisma.config.ts` für Migrationen (`DIRECT_DATABASE_URL`, schemabesitzend).
 *
 * Diese Trennung ist keine Formalie, sondern ADR-006: die Anwendung darf die
 * schemabesitzende Verbindung nie in die Hand bekommen, weil RLS für sie
 * nicht gilt. Vorher hing das an zwei Feldern derselben Schemadatei, jetzt an
 * zwei getrennten Dateien mit je einem Zweck.
 */

// Standard Next.js dev-mode singleton pattern: avoids exhausting the
// PostgreSQL connection pool on every hot-reload in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL ist nicht gesetzt — der Prisma-Adapter braucht sie.');
  }

  // Die Poolgröße gehört seit Prisma 7 hierher, nicht mehr in die URL: den
  // `connection_limit`-Parameter wertete die Rust-Engine aus, der
  // Treiber-Adapter überliest ihn und nimmt die Vorgabe von `pg` (10).
  //
  // Wer die URL anpasst und sich über ausbleibende Wirkung wundert: hier ist
  // die Stelle.
  //
  // Hier stand, die Verbindungszahl sei die härteste Grenze des Sync und 10
  // statt 25 hebe den p95 bei 200 Geräten von 3,0 auf 3,2–3,7 s. Das ist
  // verschränkt nachgemessen und trifft nicht zu: zwischen 10 und 25 ist kein
  // Unterschied messbar, oberhalb von 25 auch nicht. Begrenzend sind die 22,6
  // Datenbanktransaktionen, die ein Sync-Stapel auslöst. Die Messreihe steht
  // in notes.md unter „welcher Hebel wirklich wirkt"; 25 bleibt, weil die
  // Zahl unauffällig ist und nicht, weil sie etwas bewirkt.
  const poolMax = Number(process.env.DATABASE_POOL_MAX ?? 25);

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, max: poolMax }),
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
