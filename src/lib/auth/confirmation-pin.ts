import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Confirmation PIN handling for step-up confirmation of critical actions
 * (docs/04 "Re-Authentifizierung für kritische Aktionen", ADR-005: PIN +
 * Audit-Trail for the MVP, no qualified electronic signature).
 *
 * The PIN is never stored, never logged, never written to an audit event —
 * only this scrypt hash lives in `users.confirmation_pin_hash`, and the
 * plaintext exists solely for the duration of one verify() call. PINs are
 * short by nature, so the KDF cost matters more here than for passwords:
 * scrypt makes offline guessing of a 4–6 digit PIN expensive rather than
 * instantaneous.
 *
 * COST PARAMETER — this comment used to claim N=2^15. It is not: the calls
 * below pass no options, so Node's defaults apply (N=2^14, r=8, p=1). One
 * derivation measures ~21 ms on a 2026 laptop. Raising it is a decision
 * nobody has taken, and it is NOT a one-line change: the stored format
 * `scrypt$salt$hash` carries no cost parameters, so every existing hash
 * would become unverifiable the moment N changes. Whoever raises it has to
 * add the parameters to the stored string first and verify against the value
 * found there — otherwise every user in the plant loses their PIN on deploy.
 */

const SCRYPT_KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 12;

export async function hashConfirmationPin(pin: string): Promise<string> {
  assertPinFormat(pin);
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(pin, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyConfirmationPin(
  pin: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) return false;
  const [algorithm, saltPart, hashPart] = storedHash.split('$');
  if (algorithm !== 'scrypt' || !saltPart || !hashPart) return false;

  const expected = Buffer.from(hashPart, 'base64');
  const derived = await scrypt(pin, Buffer.from(saltPart, 'base64'), expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function assertPinFormat(pin: string): void {
  if (!/^\d+$/.test(pin) || pin.length < MIN_PIN_LENGTH || pin.length > MAX_PIN_LENGTH) {
    throw new Error(`Confirmation PIN must be ${MIN_PIN_LENGTH}–${MAX_PIN_LENGTH} digits`);
  }
}
