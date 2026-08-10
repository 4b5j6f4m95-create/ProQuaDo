import Link from 'next/link';
import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { getDocument } from '@/domain/documents/document-queries';
import { DocumentUploadWidget } from '@/components/DocumentUploadWidget';
import {
  submitForReviewAction,
  approveAction,
  rejectAction,
  releaseAction,
  withdrawAction,
  createDocumentRevisionAction,
} from '../actions';

export default async function DocumentDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const actor = await requirePageAuth();
  const document = await getDocument(actor, params.id);
  const latest = document.revisions[0];

  return (
    <main>
      <p>
        <Link href={`/projects/${document.projectId}`}>← Projekt</Link>
      </p>
      <h1>
        {document.documentNumber} — {document.title}
      </h1>

      {latest && (
        <div className="card">
          <h2>
            Revision {latest.revisionNumber} — <span className="status-badge">{latest.status}</span>
          </h2>
          {latest.fileHashSha256 ? (
            <p>
              Datei: {latest.mimeType}, {latest.fileSizeBytes ? String(latest.fileSizeBytes) : '?'}{' '}
              Bytes, Hash {latest.fileHashSha256.slice(0, 12)}…, Malware-Scan:{' '}
              {latest.malwareScanStatus}
            </p>
          ) : (
            <p>Keine Datei hochgeladen.</p>
          )}

          {latest.status === 'DRAFT' && <DocumentUploadWidget documentRevisionId={latest.id} />}

          <div className="actions">
            {latest.status === 'DRAFT' && latest.fileHashSha256 && (
              <form action={submitForReviewAction}>
                <input type="hidden" name="documentRevisionId" value={latest.id} />
                <input type="hidden" name="documentId" value={document.id} />
                <button type="submit">Zur Prüfung einreichen</button>
              </form>
            )}
            {latest.status === 'IN_REVIEW' && (
              <>
                <form action={approveAction}>
                  <input type="hidden" name="documentRevisionId" value={latest.id} />
                  <input type="hidden" name="documentId" value={document.id} />
                  <button type="submit">Genehmigen</button>
                </form>
                <form action={rejectAction}>
                  <input type="hidden" name="documentRevisionId" value={latest.id} />
                  <input type="hidden" name="documentId" value={document.id} />
                  <input type="hidden" name="reason" value="Überarbeitung erforderlich" />
                  <button type="submit">Ablehnen</button>
                </form>
              </>
            )}
            {latest.status === 'APPROVED' && (
              <form action={releaseAction}>
                <input type="hidden" name="documentRevisionId" value={latest.id} />
                <input type="hidden" name="documentId" value={document.id} />
                <button type="submit">Freigeben</button>
              </form>
            )}
            {latest.status === 'RELEASED' && (
              <form action={withdrawAction}>
                <input type="hidden" name="documentRevisionId" value={latest.id} />
                <input type="hidden" name="documentId" value={document.id} />
                <input type="hidden" name="reason" value="Fehler in der Revision festgestellt" />
                <button type="submit">Zurückziehen</button>
              </form>
            )}
          </div>

          {(latest.status === 'RELEASED' ||
            latest.status === 'SUPERSEDED' ||
            latest.status === 'WITHDRAWN') && (
            <form action={createDocumentRevisionAction}>
              <input type="hidden" name="documentId" value={document.id} />
              <label>
                Neue Revision — Titel
                <input name="title" required defaultValue={document.title} />
              </label>
              <label>
                Änderungsgrund
                <input name="changeReason" required />
              </label>
              <button type="submit">Neue Revision anlegen</button>
            </form>
          )}
        </div>
      )}

      <h2>Revisionshistorie</h2>
      <table>
        <thead>
          <tr>
            <th>Revision</th>
            <th>Status</th>
            <th>Freigegeben am</th>
          </tr>
        </thead>
        <tbody>
          {document.revisions.map((revision) => (
            <tr key={revision.id}>
              <td>{revision.revisionNumber}</td>
              <td>
                <span className="status-badge">{revision.status}</span>
              </td>
              <td>
                {revision.releasedAt ? new Date(revision.releasedAt).toLocaleString('de-DE') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
