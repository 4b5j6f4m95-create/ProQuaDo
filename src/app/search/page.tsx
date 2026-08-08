import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { searchTraceability } from '@/domain/dossier/search';
import { StatusChip } from '@/components/StatusChip';

const TYPE_LABEL: Record<string, string> = {
  ORDER: 'Produktionsauftrag',
  DOCUMENT: 'Dokument',
  NON_CONFORMANCE: 'Abweichung',
};

/**
 * Rückverfolgbarkeitssuche — the entry point of Abnahmeszenario F. A GET form
 * on purpose: the query lives in the URL, so a search result is a link an
 * auditor can put in a report.
 */
export default async function SearchPage({ searchParams }: { searchParams: { q?: string } }) {
  const actor = await requirePageAuth();
  const term = searchParams.q?.trim() ?? '';
  const results = term.length >= 2 ? await searchTraceability({ actor, q: term }) : [];

  return (
    <main>
      <h1>Suche</h1>
      <form action="/search" method="get" className="card">
        <label>
          Seriennummer, Auftrag, Dokument oder Abweichung
          <input name="q" defaultValue={term} minLength={2} required autoFocus />
        </label>
        <button type="submit" className="primary touch-target">
          Suchen
        </button>
      </form>

      {term.length > 0 && term.length < 2 && (
        <p className="notice">Bitte mindestens zwei Zeichen eingeben.</p>
      )}

      {term.length >= 2 && results.length === 0 && (
        <p className="notice">
          Keine Treffer für &bdquo;{term}&ldquo; — im Rahmen dessen, was Sie einsehen dürfen.
        </p>
      )}

      {results.map((result) => (
        <section key={`${result.type}-${result.id}`} className="card">
          <p>
            <strong>
              <Link href={result.href}>{result.label}</Link>
            </strong>{' '}
            · {TYPE_LABEL[result.type] ?? result.type} · <StatusChip status={result.status} />
          </p>
          <p>{result.title}</p>
          <p className="muted">{result.detail}</p>
          {result.type === 'ORDER' && (
            <Link className="button-link" href={`/production-orders/${result.id}/dossier`}>
              Produktionsakte →
            </Link>
          )}
        </section>
      ))}
    </main>
  );
}
