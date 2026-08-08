/**
 * At-rest encryption for the local database — docs/06 "Lokale Speicherung":
 * every category except the sync cursor is AES-256 with a device key.
 *
 * What this protects against, honestly stated: a tablet that is picked up,
 * whose browser profile directory is copied, or whose IndexedDB is read by
 * another origin through a browser flaw. What it does not protect against is
 * an attacker who has the unlocked device and the running session — no
 * browser-resident key can, and pretending otherwise would be worse than
 * saying so. The complementary control for that case is device revocation
 * (docs/06 "Remote-Widerruf"), which is server-side and does work.
 *
 * The key is generated once per device, marked non-extractable, and stored
 * as a CryptoKey object in IndexedDB. Non-extractable means the browser will
 * hand the key to `crypto.subtle` but never to JavaScript, so a script that
 * reads the whole database still cannot exfiltrate the key itself.
 */

const KEY_STORE = 'device-key';
const KEY_ID = 'aes-256-gcm';
const IV_BYTES = 12;

export interface EncryptedPayload {
  iv: number[];
  data: number[];
}

function subtle(): SubtleCrypto {
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    throw new Error(
      'WebCrypto ist nicht verfügbar — die Offline-Ablage kann nicht verschlüsselt werden.',
    );
  }
  return globalThis.crypto.subtle;
}

export async function generateDeviceKey(): Promise<CryptoKey> {
  return subtle().generateKey({ name: 'AES-GCM', length: 256 }, /* extractable */ false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncryptedPayload> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(ciphertext)) };
}

export async function decryptJson<T>(key: CryptoKey, payload: EncryptedPayload): Promise<T> {
  const plaintext = await subtle().decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(payload.iv) },
    key,
    new Uint8Array(payload.data),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export const DEVICE_KEY_STORE = KEY_STORE;
export const DEVICE_KEY_ID = KEY_ID;

/** SHA-256 over bytes, hex-encoded — the client's half of every integrity
 *  check in this system. Always a claim the server re-computes, never a
 *  substitute for the server doing so. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = bytes instanceof Uint8Array ? toArrayBuffer(bytes) : bytes;
  const digest = await subtle().digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}
