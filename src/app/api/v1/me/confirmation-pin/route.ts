import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withErrorHandling } from '@/lib/api/handler';
import { requireAuthContext } from '@/lib/authz/require-permission';
import { setConfirmationPin } from '@/domain/identity/set-confirmation-pin';

/**
 * Die Bestätigungs-PIN des **angemeldeten** Kontos setzen oder ändern.
 *
 * Unter `/me`, und nicht unter `/users/{id}`, weil der Pfad die Zusicherung
 * mitträgt: es gibt keine Kennung, über die das für jemand anderen ginge.
 * Begründung in set-confirmation-pin.ts — die PIN ist die Unterschrift, und
 * wer sie für einen anderen vergibt, kennt sie.
 */
const setPinSchema = z.object({
  newPin: z.string().min(4).max(12),
  currentPin: z.string().min(4).max(12).optional(),
});

export async function PUT(request: Request): Promise<NextResponse> {
  return withErrorHandling(request, async () => {
    const actor = await requireAuthContext();
    const body = setPinSchema.parse(await request.json());

    const result = await setConfirmationPin({
      actor,
      newPin: body.newPin,
      currentPin: body.currentPin,
    });

    // Kein Echo der Eingabe: die Antwort sagt, was geschehen ist, nicht womit.
    return NextResponse.json({ wasFirstTime: result.wasFirstTime });
  });
}
