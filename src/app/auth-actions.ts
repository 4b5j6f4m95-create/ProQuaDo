'use server';

import { redirect } from 'next/navigation';
import { signOut } from '@/lib/auth';
import { buildEndSessionUrl } from '@/lib/auth/end-session';

/**
 * Signing out, both halves of it: this application's session and the identity
 * provider's. See end-session.ts for why the second half is not optional.
 *
 * `redirect: false` on signOut because the redirect has to go to the provider,
 * not to /login — going to /login first would leave the IdP session standing,
 * and the very next click would silently sign the same person back in.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirect: false });

  const returnTo = `${process.env.AUTH_URL ?? 'http://localhost:3000'}/login`;
  const endSessionUrl = await buildEndSessionUrl(returnTo);

  // redirect() throws to unwind — it must sit outside any try/catch that
  // would swallow it.
  redirect(endSessionUrl ?? '/login');
}
