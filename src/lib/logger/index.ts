import pino from 'pino';

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

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  base: {
    nodeId: process.env.SERVER_NODE_ID ?? 'unknown',
  },
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});

export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
