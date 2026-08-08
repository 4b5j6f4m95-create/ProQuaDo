// Status is never communicated by colour alone (WCAG 2.2 AA, docs/07 F):
// every chip carries an icon AND the status text. The colour classes are a
// third, redundant channel.
const CHIP_META: Record<string, { icon: string; tone: string; label: string }> = {
  LOCKED: { icon: '🔒', tone: 'neutral', label: 'Gesperrt' },
  READY: { icon: '✔', tone: 'ready', label: 'Freigegeben' },
  IN_PROGRESS: { icon: '▶', tone: 'active', label: 'In Arbeit' },
  PAUSED: { icon: '⏸', tone: 'neutral', label: 'Pausiert' },
  COMPLETED_PENDING_SYNC: { icon: '⏳', tone: 'pending', label: 'Lokal abgeschlossen' },
  WAITING_FOR_SERVER: { icon: '⏳', tone: 'pending', label: 'Warte auf Server' },
  VALIDATING: { icon: '⏳', tone: 'pending', label: 'Wird geprüft' },
  AWAITING_SECOND_APPROVAL: { icon: '👥', tone: 'pending', label: 'Vier-Augen-Prüfung offen' },
  COMPLETED: { icon: '✓', tone: 'done', label: 'Abgeschlossen' },
  COMPLETION_REJECTED: { icon: '⚠', tone: 'blocked', label: 'Abschluss abgelehnt' },
  BLOCKED: { icon: '⛔', tone: 'blocked', label: 'Blockiert' },
  SKIP_REQUESTED: { icon: '❓', tone: 'pending', label: 'Übersprung beantragt' },
  SKIPPED: { icon: '⤼', tone: 'neutral', label: 'Übersprungen' },
  REWORK_REQUIRED: { icon: '🔁', tone: 'blocked', label: 'Nacharbeit erforderlich' },
  SUPERSEDED: { icon: '⤾', tone: 'neutral', label: 'Ersetzt' },
  // Production order statuses share the component — same visual language
  // for "this thing is currently blocked" wherever it appears.
  DRAFT: { icon: '✎', tone: 'neutral', label: 'Entwurf' },
  PLANNED: { icon: '🗓', tone: 'neutral', label: 'Geplant' },
  RELEASED: { icon: '✔', tone: 'ready', label: 'Freigegeben' },
  ON_HOLD: { icon: '⛔', tone: 'blocked', label: 'Gesperrt' },
  QUALITY_BLOCKED: { icon: '⛔', tone: 'blocked', label: 'Qualitätssperre' },
  CANCELLED: { icon: '✕', tone: 'neutral', label: 'Storniert' },
  ARCHIVED: { icon: '🗄', tone: 'neutral', label: 'Archiviert' },
};

export function StatusChip({ status }: { status: string }) {
  const meta = CHIP_META[status];
  return (
    <span className={`status-chip status-${meta?.tone ?? 'neutral'}`}>
      <span aria-hidden="true">{meta?.icon ?? '•'}</span> {meta?.label ?? status}
    </span>
  );
}
