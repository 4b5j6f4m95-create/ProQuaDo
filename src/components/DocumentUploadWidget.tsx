'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Client Component because the whole point of presigned URLs (ADR-003) is
// that the browser uploads directly to S3/MinIO, bypassing our app server —
// a Server Action can't do that. Hash is computed client-side too (for
// early feedback), but the server independently re-computes it after
// upload and rejects on mismatch (see completeDocumentUpload) — the client
// value here is never trusted as-is.
export function DocumentUploadWidget({ documentRevisionId }: { documentRevisionId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus('uploading');
    setError(null);
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const uploadUrlResponse = await fetch(
        `/api/v1/document-revisions/${documentRevisionId}/upload-url`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mimeType: file.type || 'application/octet-stream' }),
        },
      );
      if (!uploadUrlResponse.ok) throw new Error(await extractErrorDetail(uploadUrlResponse));
      const { uploadUrl, storageKey } = await uploadUrlResponse.json();

      const putResponse = await fetch(uploadUrl, { method: 'PUT', body: file });
      if (!putResponse.ok) throw new Error('Datei-Upload fehlgeschlagen.');

      const completeResponse = await fetch(
        `/api/v1/document-revisions/${documentRevisionId}/complete-upload`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storageKey,
            mimeType: file.type || 'application/octet-stream',
            expectedHashSha256: hashHex,
          }),
        },
      );
      if (!completeResponse.ok) throw new Error(await extractErrorDetail(completeResponse));

      setStatus('idle');
      router.refresh();
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler beim Upload.');
    }
  }

  return (
    <div className="card">
      <label>
        Datei hochladen
        <input type="file" onChange={handleUpload} disabled={status === 'uploading'} />
      </label>
      {status === 'uploading' && <p>Wird hochgeladen…</p>}
      {status === 'error' && <p style={{ color: '#b00020' }}>{error}</p>}
    </div>
  );
}

async function extractErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    return body.detail ?? `Fehler (${response.status})`;
  } catch {
    return `Fehler (${response.status})`;
  }
}
