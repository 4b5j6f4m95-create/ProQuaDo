import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import type { AuthContext } from './require-permission';

/**
 * Page-component counterpart to requireAuthContext() (used by API routes).
 * A page has no sensible way to return a 401 JSON body — an unauthenticated
 * visitor should land on /login, not a crashed error boundary. API routes
 * must keep using requireAuthContext(), which throws AuthzError instead.
 */
export async function requirePageAuth(): Promise<AuthContext> {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    redirect('/login');
  }
  return { userId: session.user.id, organizationId: session.user.organizationId };
}
