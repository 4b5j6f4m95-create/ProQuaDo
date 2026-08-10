import { requireAuthContext } from '@/lib/authz/require-permission';
import { withOrgContext } from '@/lib/db/tenant-context';
import { ConfirmationPinForm } from '@/components/ConfirmationPinForm';

/**
 * Das eigene Konto. Bisher gab es dafür keinen Bildschirm — und damit keinen
 * Weg, die Bestätigungs-PIN zu setzen, ohne die ein neu angelegtes Konto
 * keinen Arbeitsschritt abschließen kann (ADR-005).
 *
 * Bewusst schmal: hier steht, wer man ist und wie man seine Unterschrift
 * setzt. Alles, was andere Konten betrifft, gehört in die Administration und
 * ausdrücklich **nicht** hierher.
 */
export default async function AccountPage() {
  const actor = await requireAuthContext();

  const user = await withOrgContext(actor.organizationId, (tx) =>
    tx.user.findFirstOrThrow({
      where: { id: actor.userId },
      select: { email: true, displayName: true, confirmationPinHash: true },
    }),
  );

  const hasPin = user.confirmationPinHash !== null;

  return (
    <main>
      <h1>Mein Konto</h1>
      <p className="muted">
        {user.displayName ? `${user.displayName} · ${user.email}` : user.email}
      </p>

      {!hasPin && (
        <p role="alert" className="warning-text">
          Für dieses Konto ist noch keine Bestätigungs-PIN hinterlegt. Ohne sie lassen sich keine
          Arbeitsschritte abschließen.
        </p>
      )}

      <ConfirmationPinForm hasPin={hasPin} />
    </main>
  );
}
