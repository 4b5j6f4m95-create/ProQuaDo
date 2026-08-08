import pino from 'pino';
import pretty from 'pino-pretty';

// Structured, data-sparse logging per docs/16 (Observability) and
// 08_THREAT_MODEL_PRIVACY.md ("Sensible Daten in Logs" mitigation): redact
// known secret/PII-shaped fields regardless of where they appear in the
// log object, rather than trusting every call site to remember.
const REDACT_PATHS = [
  'password',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'pin',
  'apiKey',
  'authorization',
  'cookie',
  '*.password',
  '*.secret',
  '*.token',
  '*.pin',
  '*.apiKey',
];

// pino's normal `transport: { target: 'pino-pretty' }` spawns pino-pretty
// in a worker thread (via thread-stream) — Next.js's server bundling
// doesn't resolve that worker file at runtime ("Cannot find module
// .next/server/vendor-chunks/lib/worker.js"), crashing every request.
// Using pino-pretty directly as a synchronous destination stream avoids
// worker_threads entirely and works identically under `next dev`.
const destination = process.env.NODE_ENV === 'development' ? pretty({ colorize: true }) : undefined;

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    base: {
      nodeId: process.env.SERVER_NODE_ID ?? 'unknown',
    },
  },
  destination,
);

export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
