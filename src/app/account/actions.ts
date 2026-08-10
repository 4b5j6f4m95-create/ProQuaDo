'use server';

import { revalidatePath } from 'next/cache';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { setConfirmationPin } from '@/domain/identity/set-confirmation-pin';
import { DomainError } from '@/lib/domain-errors';
import { AuthzError } from '@/lib/authz/errors';

export interface PinFormState {
  error: string | null;
  result: string | null;
}

/**
 * Gibt Fehler zurück, statt sie zu werfen — wie beim Export und bei der
 * Produktfreigabe. „Die bisherige PIN stimmt nicht" ist eine normale Antwort
 * mit einer offensichtlichen nächsten Handlung, kein Seitenabbruch (notes.md,
 * „Eine geworfene Ablehnung reißt in Next.js die ganze Seite weg").
 */
export async function setConfirmationPinAction(
  _prevState: PinFormState,
  formData: FormData,
): Promise<PinFormState> {
  const newPin = String(formData.get('newPin') ?? '');
  const repeatPin = String(formData.get('repeatPin') ?? '');
  const currentPinRaw = String(formData.get('currentPin') ?? '');

  // Die Wiederholung ist reine Formularsache und gehört deshalb nicht in den
  // Dienst: eine vertippte PIN, die niemand mehr kennt, kostet eine Schicht.
  if (newPin !== repeatPin) {
    return { error: 'Die beiden Eingaben stimmen nicht überein.', result: null };
  }

  try {
    const actor = await requireAuthContext();
    const { wasFirstTime } = await setConfirmationPin({
      actor,
      newPin,
      currentPin: currentPinRaw === '' ? undefined : currentPinRaw,
    });

    revalidatePath('/account');
    return {
      error: null,
      result: wasFirstTime
        ? 'PIN gesetzt. Sie können ab jetzt Arbeitsschritte bestätigen.'
        : 'PIN geändert. Die bisherige gilt nicht mehr.',
    };
  } catch (error) {
    if (error instanceof DomainError || error instanceof AuthzError) {
      return { error: error.message, result: null };
    }
    throw error;
  }
}
