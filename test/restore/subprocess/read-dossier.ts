/**
 * Liest die Produktionsakte eines Auftrags und gibt sie als JSON aus — einmal
 * gegen die Quelle, einmal gegen die zurückgesicherte Umgebung.
 *
 * Die Akte ist der richtige Prüfgegenstand für eine Restore-Probe, weil sie
 * nie gespeichert, sondern bei jedem Aufruf neu aus den Primärdaten
 * abgeleitet wird (Masterprompt Kap. 10). Stimmt sie nach dem Restore
 * überein, stimmen die Daten darunter — Auftrag, Schritte, Bestätigungen,
 * Messwerte, Nachweise, Abweichungen, Freigabe und Beteiligte in einem.
 *
 * Aufruf: `tsx read-dossier.ts <orderId> <actorUserId> <organizationId>`
 */

import { assembleProductionDossier } from '@/domain/dossier/assemble-dossier';

async function main(): Promise<void> {
  const [orderId, userId, organizationId] = process.argv.slice(2);
  if (!orderId || !userId || !organizationId) {
    throw new Error('Aufruf: read-dossier.ts <orderId> <actorUserId> <organizationId>');
  }

  const dossier = await assembleProductionDossier({ userId, organizationId }, orderId);

  const { prisma } = await import('@/lib/db/client');
  await prisma.$disconnect();

  // Zwei Felder **müssen** sich unterscheiden: `dataAsOf` und `generatedAt`
  // halten fest, wann gelesen wurde — zwei Aufrufe im Abstand einer Sekunde
  // unterscheiden sich darin auch ohne Restore. Genau diese beiden fliegen
  // raus und sonst keines; jede weitere Ausnahme wäre eine Abweichung, die
  // die Probe nicht mehr sieht.
  const volatile = new Set(['dataAsOf', 'generatedAt']);
  process.stdout.write(
    JSON.stringify(dossier, (key, value: unknown) => (volatile.has(key) ? undefined : value)),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
