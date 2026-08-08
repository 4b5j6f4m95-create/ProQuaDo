'use client';

import { useEffect } from 'react';

/**
 * Registers the app-shell service worker (public/sw.js) so /offline can be
 * opened on a tablet with no connectivity.
 *
 * Only in production: in `next dev` the worker would cache HMR responses and
 * serve stale chunks after every edit, which looks exactly like a broken
 * build. Registration is best-effort — a browser that refuses it (private
 * mode, policy) simply has no offline shell, and the online app is
 * unaffected.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  return null;
}
