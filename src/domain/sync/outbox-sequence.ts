import type { Prisma } from '@prisma/client';

/**
 * Allocates the next per-organization outbox sequence number — the cursor a
 * device syncs against (docs/05 "Sync Changes", docs/06 step 6).
 *
 * Why not a Postgres SEQUENCE / `@default(autoincrement())`:
 *
 *   A sequence hands out its number at INSERT time, not at COMMIT time. Two
 *   transactions can take 41 and 42 and commit in the opposite order. A
 *   client that polls in between sees 42, stores cursor = 42, and event 41
 *   becomes visible one millisecond later — behind the cursor, never
 *   delivered. For a stream whose events are "step released" and "step
 *   completed", a silently dropped event means a tablet that never unlocks
 *   the next step, or one that shows a step as still running forever.
 *
 * The counter row gives the missing guarantee: `UPDATE ... SET last_sequence
 * = last_sequence + 1` takes a row lock that is held until commit, so a
 * second writer cannot even obtain its number until the first has committed.
 * Sequence order therefore equals commit order, and the stream is gap-free.
 *
 * The price is that outbox writes within one organization serialize. That is
 * acceptable at shop-floor write rates (a handful of domain transitions per
 * second at most) and it is the only property that makes the cursor
 * trustworthy. If it ever becomes a bottleneck, the fix is to shard the
 * counter per production order — NOT to go back to a plain sequence.
 */
export async function nextOutboxSequence(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<bigint> {
  const rows = await tx.$queryRaw<{ last_sequence: bigint }[]>`
    INSERT INTO sync_sequences (organization_id, last_sequence, updated_at)
         VALUES (${organizationId}::uuid, 1, now())
    ON CONFLICT (organization_id)
    DO UPDATE SET last_sequence = sync_sequences.last_sequence + 1, updated_at = now()
      RETURNING last_sequence
  `;
  const row = rows[0];
  if (!row) {
    // Would mean the RLS policy rejected the row, i.e. the caller opened the
    // transaction for a different organization than it is writing for.
    throw new Error(`nextOutboxSequence: no sequence row for organization ${organizationId}`);
  }
  return row.last_sequence;
}
