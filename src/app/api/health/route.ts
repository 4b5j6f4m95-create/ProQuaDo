import { NextResponse } from 'next/server';

// Liveness: is the Node process itself responsive? No dependency checks —
// a slow/unavailable database must NOT make the process look dead to the
// orchestrator (that would cause unnecessary restarts). See
// docs/01_SYSTEM_CONTEXT.md "Observability".
export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok' }, { status: 200 });
}
