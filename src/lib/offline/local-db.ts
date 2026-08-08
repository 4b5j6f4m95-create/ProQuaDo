import {
  DEVICE_KEY_ID,
  DEVICE_KEY_STORE,
  decryptJson,
  encryptJson,
  generateDeviceKey,
  type EncryptedPayload,
} from './local-crypto';
import type { LocalWorkStep } from './client-work-step-status';
import type { LocalMutation } from './mutation-envelope';

/**
 * The device's local database — ADR-002 (IndexedDB) and docs/06 "Lokale
 * Speicherung".
 *
 * Written directly against the IndexedDB API rather than through Dexie: the
 * access patterns here are get-by-key and scan-one-index, the whole surface
 * fits in this file, and an offline data layer is the last place to want a
 * dependency whose upgrade path can strand a tablet holding unsynced work.
 *
 * Every record except the sync cursor is stored encrypted (see
 * local-crypto.ts). The cursor is deliberately plaintext: it is a number
 * with no content, and keeping it readable means a device whose key is lost
 * can still be diagnosed rather than silently resyncing from zero.
 */

const DB_NAME = 'proquado-offline';
const DB_VERSION = 1;

const STORE_META = 'meta';
const STORE_STEPS = 'work-steps';
const STORE_OUTBOX = 'outbox';
const STORE_EVIDENCE = 'evidence';
const STORE_BLOBS = 'blobs';

export interface LocalEvidenceRecord {
  id: string;
  workStepInstanceId: string;
  kind: 'CHECKLIST' | 'MEASUREMENT' | 'PHOTO' | 'CONFIRMATION';
  /** Free-form per kind; the outbox command schema is the contract, not this. */
  data: Record<string, unknown>;
  capturedAt: string;
}

export interface LocalBlob {
  id: string;
  workStepInstanceId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  bytes: ArrayBuffer;
  photoRequirementId?: string;
  /** Server-side evidence id once the upload has been opened; absent while
   *  the photo exists only on the device. */
  photoEvidenceId?: string;
  uploadedChunks: number[];
}

type StoreName =
  | typeof STORE_META
  | typeof STORE_STEPS
  | typeof STORE_OUTBOX
  | typeof STORE_EVIDENCE
  | typeof STORE_BLOBS;

export interface LocalDb {
  putStep(step: LocalWorkStep): Promise<void>;
  getStep(id: string): Promise<LocalWorkStep | undefined>;
  listSteps(): Promise<LocalWorkStep[]>;

  enqueue(mutation: LocalMutation): Promise<void>;
  listOutbox(): Promise<LocalMutation[]>;
  updateOutbox(mutation: LocalMutation): Promise<void>;
  removeFromOutbox(mutationId: string): Promise<void>;

  putEvidence(record: LocalEvidenceRecord): Promise<void>;
  listEvidence(workStepInstanceId: string): Promise<LocalEvidenceRecord[]>;

  putBlob(blob: LocalBlob): Promise<void>;
  getBlob(id: string): Promise<LocalBlob | undefined>;
  listBlobs(workStepInstanceId: string): Promise<LocalBlob[]>;
  deleteBlob(id: string): Promise<void>;

  getMeta<T>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;

  /** Device revoked, or user logged out: everything encrypted goes, and the
   *  key with it (docs/06 "Remote-Widerruf ... erzwingt Re-Login oder
   *  Datenlöschung"). */
  wipe(): Promise<void>;
}

export async function openLocalDb(): Promise<LocalDb> {
  const db = await openDatabase();
  const key = await loadOrCreateDeviceKey(db);

  const readAll = async <T>(store: StoreName, index?: [string, IDBValidKey]): Promise<T[]> => {
    const rows = await requestAll<{ payload: EncryptedPayload }>(db, store, index);
    return Promise.all(rows.map((row) => decryptJson<T>(key, row.payload)));
  };

  return {
    async putStep(step) {
      await put(db, STORE_STEPS, {
        id: step.workStepInstanceId,
        productionOrderId: step.productionOrderId,
        payload: await encryptJson(key, step),
      });
    },
    async getStep(id) {
      const row = await get<{ payload: EncryptedPayload }>(db, STORE_STEPS, id);
      return row ? decryptJson<LocalWorkStep>(key, row.payload) : undefined;
    },
    listSteps() {
      return readAll<LocalWorkStep>(STORE_STEPS);
    },

    async enqueue(mutation) {
      await put(db, STORE_OUTBOX, {
        mutationId: mutation.mutationId,
        sequenceNumber: mutation.sequenceNumber,
        payload: await encryptJson(key, mutation),
      });
    },
    async listOutbox() {
      const mutations = await readAll<LocalMutation>(STORE_OUTBOX);
      // Stable order is the protocol's first property (docs/06): commands
      // are applied in the order they were created, never in parallel.
      return mutations.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    },
    async updateOutbox(mutation) {
      await put(db, STORE_OUTBOX, {
        mutationId: mutation.mutationId,
        sequenceNumber: mutation.sequenceNumber,
        payload: await encryptJson(key, mutation),
      });
    },
    removeFromOutbox(mutationId) {
      return remove(db, STORE_OUTBOX, mutationId);
    },

    async putEvidence(record) {
      await put(db, STORE_EVIDENCE, {
        id: record.id,
        workStepInstanceId: record.workStepInstanceId,
        payload: await encryptJson(key, record),
      });
    },
    listEvidence(workStepInstanceId) {
      return readAll<LocalEvidenceRecord>(STORE_EVIDENCE, [
        'workStepInstanceId',
        workStepInstanceId,
      ]);
    },

    async putBlob(blob) {
      await put(db, STORE_BLOBS, {
        id: blob.id,
        workStepInstanceId: blob.workStepInstanceId,
        payload: await encryptJson(key, {
          ...blob,
          bytes: Array.from(new Uint8Array(blob.bytes)),
        }),
      });
    },
    async getBlob(id) {
      const row = await get<{ payload: EncryptedPayload }>(db, STORE_BLOBS, id);
      if (!row) return undefined;
      return reviveBlob(await decryptJson<StoredBlob>(key, row.payload));
    },
    async listBlobs(workStepInstanceId) {
      const stored = await readAll<StoredBlob>(STORE_BLOBS, [
        'workStepInstanceId',
        workStepInstanceId,
      ]);
      return stored.map(reviveBlob);
    },
    deleteBlob(id) {
      return remove(db, STORE_BLOBS, id);
    },

    async getMeta<T>(metaKey: string) {
      const row = await get<{ value: T }>(db, STORE_META, metaKey);
      return row?.value;
    },
    async setMeta(metaKey, value) {
      await put(db, STORE_META, { key: metaKey, value });
    },

    async wipe() {
      for (const store of [STORE_STEPS, STORE_OUTBOX, STORE_EVIDENCE, STORE_BLOBS, STORE_META]) {
        await clear(db, store as StoreName);
      }
      await remove(db, DEVICE_KEY_STORE as StoreName, DEVICE_KEY_ID);
    },
  };
}

interface StoredBlob extends Omit<LocalBlob, 'bytes'> {
  bytes: number[];
}

function reviveBlob(stored: StoredBlob): LocalBlob {
  const bytes = new Uint8Array(stored.bytes);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return { ...stored, bytes: buffer };
}

// ─────────────────────────────────────────────────────────────
// IndexedDB plumbing
// ─────────────────────────────────────────────────────────────

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(DEVICE_KEY_STORE)) {
        db.createObjectStore(DEVICE_KEY_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_STEPS)) {
        const store = db.createObjectStore(STORE_STEPS, { keyPath: 'id' });
        store.createIndex('productionOrderId', 'productionOrderId');
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const store = db.createObjectStore(STORE_OUTBOX, { keyPath: 'mutationId' });
        store.createIndex('sequenceNumber', 'sequenceNumber');
      }
      if (!db.objectStoreNames.contains(STORE_EVIDENCE)) {
        const store = db.createObjectStore(STORE_EVIDENCE, { keyPath: 'id' });
        store.createIndex('workStepInstanceId', 'workStepInstanceId');
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        const store = db.createObjectStore(STORE_BLOBS, { keyPath: 'id' });
        store.createIndex('workStepInstanceId', 'workStepInstanceId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadOrCreateDeviceKey(db: IDBDatabase): Promise<CryptoKey> {
  const existing = await get<{ id: string; key: CryptoKey }>(
    db,
    DEVICE_KEY_STORE as StoreName,
    DEVICE_KEY_ID,
  );
  if (existing?.key) return existing.key;

  // A non-extractable CryptoKey can be stored in IndexedDB as a structured
  // clone and comes back usable — without its raw bytes ever existing in JS.
  const key = await generateDeviceKey();
  await put(db, DEVICE_KEY_STORE as StoreName, { id: DEVICE_KEY_ID, key });
  return key;
}

function put(db: IDBDatabase, store: StoreName, value: unknown): Promise<void> {
  return transact(db, store, 'readwrite', (objectStore) => objectStore.put(value)).then(() => {});
}

function get<T>(db: IDBDatabase, store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return transact<T | undefined>(db, store, 'readonly', (objectStore) => objectStore.get(key));
}

function remove(db: IDBDatabase, store: StoreName, key: IDBValidKey): Promise<void> {
  return transact(db, store, 'readwrite', (objectStore) => objectStore.delete(key)).then(() => {});
}

function clear(db: IDBDatabase, store: StoreName): Promise<void> {
  return transact(db, store, 'readwrite', (objectStore) => objectStore.clear()).then(() => {});
}

function requestAll<T>(
  db: IDBDatabase,
  store: StoreName,
  index?: [string, IDBValidKey],
): Promise<T[]> {
  return transact<T[]>(db, store, 'readonly', (objectStore) =>
    index ? objectStore.index(index[0]).getAll(index[1]) : objectStore.getAll(),
  );
}

function transact<T>(
  db: IDBDatabase,
  store: StoreName,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
