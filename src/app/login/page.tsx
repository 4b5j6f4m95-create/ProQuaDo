import { redirect } from 'next/navigation';
import { auth, signIn } from '@/lib/auth';

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) {
    redirect('/projects');
  }

  return (
    <main>
      <h1>ProQuaDo Anmeldung</h1>
      <form
        action={async () => {
          'use server';
          await signIn('oidc', { redirectTo: '/projects' });
        }}
      >
        <button type="submit">Mit SSO anmelden</button>
      </form>
    </main>
  );
}
