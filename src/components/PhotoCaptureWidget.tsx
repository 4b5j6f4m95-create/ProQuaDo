'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Photo capture (docs/07 A3). Client Component for the same reason as
 * DocumentUploadWidget: presigned uploads go browser → object storage
 * directly (ADR-003), which a Server Action cannot do.
 *
 * `capture="environment"` makes a tablet open the rear camera instead of a
 * file picker. The SHA-256 computed here is a claim; the server recomputes
 * it over what actually arrived and rejects a mismatch (Negativtest #7).
 */
export function PhotoCaptureWidget({
  workStepInstanceId,
  photoRequirementId,
  photoCategory,
  label,
}: {
  workStepInstanceId: string;
  photoRequirementId?: string;
  photoCategory?: string;
  label: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleCapture(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setStatus('uploading');
    setError(null);
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const mimeType = file.type || 'image/jpeg';
      const urlResponse = await fetch(
        `/api/v1/work-steps/${workStepInstanceId}/photo-evidence/upload-url`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mimeType, photoRequirementId, photoCategory }),
        },
      );
      if (!urlResponse.ok) throw new Error(await extractErrorDetail(urlResponse));
      const { uploadUrl, photoEvidenceId } = await urlResponse.json();

      const putResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': mimeType },
      });
      if (!putResponse.ok) throw new Error('Foto-Upload fehlgeschlagen.');

      const completeResponse = await fetch(`/api/v1/photo-evidence/${photoEvidenceId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedHashSha256: hashHex }),
      });
      if (!completeResponse.ok) throw new Error(await extractErrorDetail(completeResponse));

      setStatus('idle');
      router.refresh();
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler beim Foto-Upload.');
    }
  }

  return (
    <div>
      <label className="touch-target">
        {label}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleCapture}
          disabled={status === 'uploading'}
        />
      </label>
      {status === 'uploading' && <p aria-live="polite">Foto wird übertragen…</p>}
      {status === 'error' && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
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
