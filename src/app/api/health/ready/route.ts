import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';
import { getMalwareScanner, MalwareScannerNotConfiguredError } from '@/lib/storage/malware-scan';

// Readiness: can this instance actually serve traffic right now? Checks its
// dependencies explicitly, distinct from liveness (see /api/health). An
// orchestrator should stop routing traffic here on failure, but should NOT
// restart the process — that would not fix a database outage.
//
// ## Why the malware scanner is reported but does not fail the probe
//
// The scanner fails closed by design: an unreachable clamd answers ERROR and
// every upload is refused (see malware-scan.ts). Correct, but silent until
// someone in the hall photographs a weld and is told no. A readiness probe is
// the right place to say it out loud.
//
// It is deliberately NOT a 503, though. If clamd is down it is down for every
// instance, so failing readiness would take the whole application out of
// rotation — turning "photo uploads are refused" into "nobody can work at
// all". Everything except evidence upload is unaffected and should keep
// serving. So: HTTP 200, `status: "degraded"`, and `uploadsBlocked: true` so a
// monitor can alert on exactly the thing that is broken.
//
// The scanner's identity is reported alongside its reachability, because
// `"malwareScanner": "ok"` from the stub must never read as "a scanner is
// running" — in production the stub cannot be selected at all, but a staging
// environment that quietly runs it is worth seeing.

export async function GET(): Promise<NextResponse> {
  const database = await checkDatabase();
  const scanner = await checkMalwareScanner();

  if (database !== 'ok') {
    return NextResponse.json(
      {
        status: 'not_ready',
        checks: { database, malwareScanner: scanner.status, scannerKind: scanner.kind },
      },
      { status: 503 },
    );
  }

  const degraded = scanner.status !== 'ok';
  if (degraded) {
    logger.error(
      { scannerKind: scanner.kind, detail: scanner.detail },
      'Readiness: malware scanner not reachable — evidence uploads will be refused',
    );
  }

  return NextResponse.json(
    {
      status: degraded ? 'degraded' : 'ready',
      checks: { database, malwareScanner: scanner.status, scannerKind: scanner.kind },
      ...(degraded ? { uploadsBlocked: true, detail: scanner.detail } : {}),
    },
    { status: 200 },
  );
}

async function checkDatabase(): Promise<'ok' | 'failed'> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch (error) {
    logger.error({ err: error }, 'Readiness check failed: database unreachable');
    return 'failed';
  }
}

interface ScannerCheck {
  status: 'ok' | 'unreachable' | 'not_configured';
  /** Which implementation answered — see the note above on why this matters. */
  kind: 'clamav' | 'stub' | 'none';
  detail?: string;
}

async function checkMalwareScanner(): Promise<ScannerCheck> {
  const kind = process.env.MALWARE_SCANNER?.trim().toLowerCase() === 'clamav' ? 'clamav' : 'stub';

  let scanner;
  try {
    scanner = getMalwareScanner();
  } catch (error) {
    // Production without a configured scanner. getMalwareScanner throws at
    // call time rather than at import, so this is where it surfaces.
    return {
      status: 'not_configured',
      kind: 'none',
      detail:
        error instanceof MalwareScannerNotConfiguredError
          ? error.message
          : 'Malware-Scanner konnte nicht aufgelöst werden.',
    };
  }

  const reachable = await scanner.ping();
  return reachable
    ? { status: 'ok', kind }
    : {
        status: 'unreachable',
        kind,
        detail: `clamd unter ${process.env.CLAMAV_HOST ?? '127.0.0.1'}:${
          process.env.CLAMAV_PORT ?? 3310
        } antwortet nicht — Nachweis-Uploads werden abgelehnt.`,
      };
}
