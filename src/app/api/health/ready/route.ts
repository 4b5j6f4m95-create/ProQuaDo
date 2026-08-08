import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logger';

// Readiness: can this instance actually serve traffic right now? Checks the
// database dependency explicitly, distinct from liveness (see /api/health).
// An orchestrator should stop routing traffic here on failure, but should
// NOT restart the process — that would not fix a database outage.
export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ready', checks: { database: 'ok' } }, { status: 200 });
  } catch (error) {
    logger.error({ err: error }, 'Readiness check failed: database unreachable');
    return NextResponse.json(
      { status: 'not_ready', checks: { database: 'failed' } },
      { status: 503 },
    );
  }
}
