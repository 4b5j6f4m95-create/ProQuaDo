import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signing outbound webhooks so a receiver can tell our deliveries from
 * anything else that finds its endpoint.
 *
 * Unlike `signature_data` on a step confirmation (ADR-005), this one really
 * is a signature in the sense that matters: it is computed over a **shared
 * secret** the receiver also holds, so verifying it proves the payload came
 * from someone holding that secret and arrived unmodified. It says nothing
 * about who authorised the underlying business decision — that is what the
 * audit trail is for.
 *
 * The timestamp is inside the signed material, not merely beside it. A
 * signature over the body alone can be replayed forever; with the timestamp
 * signed, a receiver that rejects old ones has a defence, and one that does
 * not at least has the information.
 */

export const SIGNATURE_HEADER = 'x-proquado-signature';
export const TIMESTAMP_HEADER = 'x-proquado-timestamp';
export const EVENT_HEADER = 'x-proquado-event';
export const DELIVERY_HEADER = 'x-proquado-delivery';

/** `v1=<hex>` so the scheme can change without the receiver guessing. */
export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `v1=${mac}`;
}

/**
 * Verifies a signature the way a receiver would. Exported because the only
 * honest way to document "this is how you check it" is code the test suite
 * runs — a receiving system is written by somebody who is not in this
 * repository, and prose is a poor specification for a MAC.
 */
export function verifyWebhookSignature(
  secret: string,
  timestamp: string,
  body: string,
  presented: string,
): boolean {
  const expected = Buffer.from(signWebhookPayload(secret, timestamp, body));
  const actual = Buffer.from(presented);
  // Length compared separately: timingSafeEqual throws on a mismatch.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
