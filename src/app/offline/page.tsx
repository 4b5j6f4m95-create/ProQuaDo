import { requirePageAuth } from '@/lib/authz/require-page-auth';
import { OfflineWorkspace } from '@/components/OfflineWorkspace';

/**
 * The offline-capable tablet surface. Deliberately a single client-rendered
 * page: every other page in this app is server-rendered and therefore needs
 * a network round trip to show anything at all, which is exactly what is
 * missing in the hall this screen is for.
 */
export default async function OfflinePage() {
  const actor = await requirePageAuth();
  return <OfflineWorkspace actorId={actor.userId} />;
}
