'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { openLocalDb, type LocalDb, type LocalEvidenceRecord } from './local-db';
import { enqueueMutation, runSync, DeviceRevokedLocally, type SyncResult } from './sync-client';
import { prepareBlob } from './resumable-upload';
import type { LocalWorkStep } from './client-work-step-status';

/**
 * Browser plumbing for the offline workspace: opens the local database,
 * registers the device once, tracks connectivity, and exposes the four
 * things the UI actually does — prepare, capture, complete locally, sync.
 *
 * Everything that touches the invariant lives in client-work-step-status.ts
 * and is only *called* from here. This file is deliberately dumb about what
 * a status means; it moves data.
 */

const DEVICE_ID_KEY = 'device-id';
/**
 * Who the stored device belongs to. Added in Phase 7, because the device id
 * was keyed to the *browser* and the tablet this application is built for is
 * shared by a shift.
 *
 * What happened without it: the previous user's device id stayed in
 * IndexedDB, the server correctly refused it (`assertDeviceActive` treats
 * another user's device as not-found, so as not to be a membership oracle),
 * and the offline workspace answered "Gerät wurde nicht gefunden" on every
 * action with no way out of the screen. On the one piece of hardware the
 * offline mode exists for.
 */
const DEVICE_OWNER_KEY = 'device-owner';

export interface OfflineBundleResponse {
  cursor: string;
  orders: Array<{
    productionOrderId: string;
    orderNumber: string;
    serialNumber: string | null;
    productName: string;
    steps: Array<{
      workStepInstanceId: string;
      stepNumber: number;
      status: string;
      version: number;
      title: string;
      instruction: string | null;
      photoRequired: boolean;
      checklistItems: Array<{ id: string; itemNumber: number; text: string; isRequired: boolean }>;
      photoRequirements: Array<{ id: string; category: string; minCount: number }>;
      inspectionCharacteristics: Array<{
        id: string;
        characteristicNumber: number;
        name: string;
        unit: string | null;
        isRequired: boolean;
      }>;
      documentRevisions: Array<{
        documentRevisionId: string;
        documentNumber: string;
        revisionNumber: string;
      }>;
      releaseToken: string | null;
      releaseValidUntil: string | null;
    }>;
  }>;
}

export interface WorkspaceState {
  ready: boolean;
  online: boolean;
  deviceId: string | null;
  steps: LocalWorkStep[];
  /** The bundle's reference data, keyed by step — requirements, documents,
   *  instruction text. Not encrypted-state, just what to render. */
  reference: Record<string, OfflineBundleResponse['orders'][number]['steps'][number]>;
  evidence: Record<string, LocalEvidenceRecord[]>;
  pendingMutations: number;
  lastSync: SyncResult | null;
  message: string | null;
  error: string | null;
}

export function useOfflineWorkspace(actorId: string) {
  const dbRef = useRef<LocalDb | null>(null);
  const [state, setState] = useState<WorkspaceState>({
    ready: false,
    online: true,
    deviceId: null,
    steps: [],
    reference: {},
    evidence: {},
    pendingMutations: 0,
    lastSync: null,
    message: null,
    error: null,
  });

  const refresh = useCallback(async () => {
    const db = dbRef.current;
    if (!db) return;
    const steps = await db.listSteps();
    const evidence: Record<string, LocalEvidenceRecord[]> = {};
    for (const step of steps) {
      evidence[step.workStepInstanceId] = await db.listEvidence(step.workStepInstanceId);
    }
    const outbox = await db.listOutbox();
    const reference = (await db.getMeta<WorkspaceState['reference']>('reference')) ?? {};

    setState((s) => ({
      ...s,
      steps: steps.sort((a, b) => a.stepNumber - b.stepNumber),
      evidence,
      reference,
      pendingMutations: outbox.filter((m) => m.state !== 'CONFIRMED').length,
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const db = await openLocalDb();
        if (cancelled) return;
        dbRef.current = db;

        const handover = await resolveHandover(db, actorId);
        if (cancelled) return;
        if (handover.blocked) {
          setState((s) => ({
            ...s,
            ready: true,
            online: navigator.onLine,
            error: handover.reason,
          }));
          await refresh();
          return;
        }

        let deviceId = handover.deviceId;
        if (!deviceId && navigator.onLine) {
          // Registration needs the server; a device that has never been
          // online cannot sync anyway, so deferring it costs nothing.
          const registered = await postJson<{ deviceId: string }>('/api/v1/devices', {
            deviceLabel: navigator.userAgent.slice(0, 120),
          });
          deviceId = registered.deviceId;
          await db.setMeta(DEVICE_ID_KEY, deviceId);
          await db.setMeta(DEVICE_OWNER_KEY, actorId);
        }

        if (cancelled) return;
        setState((s) => ({
          ...s,
          ready: true,
          online: navigator.onLine,
          deviceId: deviceId ?? null,
          ...(handover.message ? { message: handover.message } : {}),
        }));
        await refresh();
      } catch (error) {
        if (!cancelled) setState((s) => ({ ...s, ready: true, error: String(error) }));
      }
    })();

    const setOnline = () => setState((s) => ({ ...s, online: navigator.onLine }));
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOnline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', setOnline);
      window.removeEventListener('offline', setOnline);
    };
  }, [refresh, actorId]);

  /** "Für Offline vorbereiten": pull the bundle and project it into the
   *  local database. Release tokens arrive only for steps the server has
   *  already released — see offline-bundle.ts. */
  const prepare = useCallback(async () => {
    const db = dbRef.current;
    const deviceId = state.deviceId;
    if (!db || !deviceId) return;

    setState((s) => ({ ...s, message: 'Daten werden geladen…', error: null }));
    try {
      const bundle = await getJson<OfflineBundleResponse>(
        `/api/v1/sync/bundle?deviceId=${encodeURIComponent(deviceId)}`,
      );

      const reference: WorkspaceState['reference'] = {};
      for (const order of bundle.orders) {
        for (const step of order.steps) {
          reference[step.workStepInstanceId] = step;
          const existing = await db.getStep(step.workStepInstanceId);
          await db.putStep({
            workStepInstanceId: step.workStepInstanceId,
            productionOrderId: order.productionOrderId,
            stepNumber: step.stepNumber,
            title: `${order.orderNumber} · ${step.title}`,
            // Locally-owned states survive a refresh: a step the worker has
            // already finished offline must not be reset to READY because
            // the server still thinks it is running.
            status:
              existing &&
              ['IN_PROGRESS', 'PAUSED', 'COMPLETED_PENDING_SYNC', 'WAITING_FOR_SERVER'].includes(
                existing.status,
              )
                ? existing.status
                : (step.status as LocalWorkStep['status']),
            entityVersion: step.version,
            ...(step.releaseToken ? { releaseToken: step.releaseToken } : {}),
            ...(step.releaseValidUntil ? { releaseValidUntil: step.releaseValidUntil } : {}),
            ...(existing?.localStartedAt ? { localStartedAt: existing.localStartedAt } : {}),
            ...(existing?.localCompletedAt ? { localCompletedAt: existing.localCompletedAt } : {}),
          });
        }
      }
      await db.setMeta('reference', reference);
      await db.setMeta('sync-cursor', bundle.cursor);

      setState((s) => ({ ...s, message: 'Offline-Daten aktualisiert.' }));
      await refresh();
    } catch (error) {
      setState((s) => ({ ...s, error: String(error), message: null }));
    }
  }, [state.deviceId, refresh]);

  const sync = useCallback(async () => {
    const db = dbRef.current;
    const deviceId = state.deviceId;
    if (!db || !deviceId) return;

    setState((s) => ({ ...s, message: 'Synchronisation läuft…', error: null }));
    try {
      const result = await runSync({
        db,
        deviceId,
        actorId,
        fetchJson: fetchJsonWithError,
        fetchBinary: fetchBinaryWithError,
      });
      setState((s) => ({
        ...s,
        lastSync: result,
        message:
          `${result.accepted} übernommen, ${result.rejected} abgelehnt, ` +
          `${result.conflicts} Konflikt(e), ${result.eventsApplied} Änderung(en) empfangen.`,
      }));
      await refresh();
    } catch (error) {
      if (error instanceof DeviceRevokedLocally) {
        setState((s) => ({ ...s, error: error.message, steps: [], deviceId: null }));
        return;
      }
      setState((s) => ({ ...s, error: String(error), message: null }));
    }
  }, [state.deviceId, actorId, refresh]);

  const enqueue = useCallback(
    async (
      commandType: Parameters<typeof enqueueMutation>[1]['commandType'],
      payload: Record<string, unknown>,
      baseVersion?: number,
    ) => {
      const db = dbRef.current;
      const deviceId = state.deviceId;
      if (!db || !deviceId) return;
      await enqueueMutation(db, {
        deviceId,
        actorId,
        commandType,
        payload,
        ...(baseVersion !== undefined ? { baseVersion } : {}),
      });
      await refresh();
    },
    [state.deviceId, actorId, refresh],
  );

  const captureEvidence = useCallback(
    async (record: Omit<LocalEvidenceRecord, 'id' | 'capturedAt'>) => {
      const db = dbRef.current;
      if (!db) return;
      await db.putEvidence({
        ...record,
        id: crypto.randomUUID(),
        capturedAt: new Date().toISOString(),
      });
      await refresh();
    },
    [refresh],
  );

  const capturePhoto = useCallback(
    async (workStepInstanceId: string, file: File, photoRequirementId?: string) => {
      const db = dbRef.current;
      if (!db) return;
      const blob = await prepareBlob({
        workStepInstanceId,
        file,
        mimeType: file.type || 'image/jpeg',
        ...(photoRequirementId ? { photoRequirementId } : {}),
      });
      await db.putBlob(blob);
      await captureEvidence({
        workStepInstanceId,
        kind: 'PHOTO',
        data: { blobId: blob.id, sha256: blob.sha256, photoRequirementId },
      });
    },
    [captureEvidence],
  );

  const putStep = useCallback(
    async (step: LocalWorkStep) => {
      await dbRef.current?.putStep(step);
      await refresh();
    },
    [refresh],
  );

  return { state, prepare, sync, enqueue, captureEvidence, capturePhoto, putStep, refresh };
}

// ── fetch helpers ────────────────────────────────────────────
// Errors are re-thrown carrying the server's `code`, because the sync client
// branches on DEVICE_REVOKED and a stringified message would not do.

type Handover =
  | { blocked: true; reason: string }
  | { blocked: false; deviceId: string | undefined; message?: string };

/**
 * Decides what to do with whatever the last person left on this tablet.
 *
 * Three outcomes, and the middle one is the one that matters:
 *
 *  - Same user (or nothing stored): carry on.
 *  - Different user, nothing pending: wipe and start fresh. The local
 *    database holds the previous user's orders, evidence and cursor; showing
 *    them to the next person would be a disclosure (docs/08), and syncing
 *    their outbox under this session would attribute their work to somebody
 *    else — which is the one thing this system must never do.
 *  - Different user WITH unsynced work: refuse, and say so. Wiping here would
 *    silently destroy captured work that only its author can deliver, and
 *    docs/06 is explicit that offline-captured work is preserved and becomes
 *    a decision. Losing it because somebody else logged in is not a decision.
 *
 * The owner was not recorded before Phase 7, so an unknown owner with a
 * stored device id is treated as "possibly someone else" and verified against
 * the server rather than assumed to be ours.
 */
async function resolveHandover(db: LocalDb, actorId: string): Promise<Handover> {
  const deviceId = await db.getMeta<string>(DEVICE_ID_KEY);
  if (!deviceId) return { blocked: false, deviceId: undefined };

  const owner = await db.getMeta<string>(DEVICE_OWNER_KEY);
  if (owner === actorId) return { blocked: false, deviceId };

  if (owner === undefined && !(await belongsToSomebodyElse(deviceId))) {
    // Pre-Phase-7 state that is in fact ours: adopt it rather than throw away
    // a working device registration and whatever it still has to deliver.
    await db.setMeta(DEVICE_OWNER_KEY, actorId);
    return { blocked: false, deviceId };
  }

  const pending = (await db.listOutbox()).filter((m) => m.state !== 'CONFIRMED');
  if (pending.length > 0) {
    return {
      blocked: true,
      reason:
        `Dieses Gerät hält noch ${pending.length} nicht übertragene Vorgang/Vorgänge einer ` +
        'anderen Anmeldung. Bitte mit dem vorherigen Benutzer anmelden und synchronisieren — ' +
        'diese Daten werden nicht verworfen.',
    };
  }

  await db.wipe();
  return {
    blocked: false,
    deviceId: undefined,
    message: 'Neue Anmeldung erkannt — lokale Daten des vorherigen Benutzers wurden entfernt.',
  };
}

/** True when the server does not recognise this device for the current
 *  session. Offline (or any other failure) answers "no": refusing to work
 *  because a check could not be run would strand a tablet that is doing
 *  exactly what it is supposed to do. */
async function belongsToSomebodyElse(deviceId: string): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    await getJson(`/api/v1/sync/health?deviceId=${encodeURIComponent(deviceId)}`);
    return false;
  } catch (error) {
    // NOT_FOUND is the deliberate answer for "unknown id" AND "somebody
    // else's id" — see assertDeviceActive on why the two are not
    // distinguished. Anything else (403 without sync.execute, a network
    // blip) is not evidence of a foreign device.
    return error instanceof ApiError && error.status === 404;
  }
}

class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    detail?: string;
  };
  throw new ApiError(
    body.code ?? 'HTTP_ERROR',
    body.message ?? body.detail ?? `HTTP ${response.status}`,
    response.status,
  );
}

async function getJson<T>(url: string): Promise<T> {
  return unwrap<T>(await fetch(url));
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  return unwrap<T>(
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

async function fetchJsonWithError<T>(url: string, init?: RequestInit): Promise<T> {
  return unwrap<T>(await fetch(url, init));
}

async function fetchBinaryWithError<T>(
  url: string,
  body: BodyInit,
  headers: Record<string, string>,
): Promise<T> {
  return unwrap<T>(await fetch(url, { method: 'POST', body, headers }));
}
