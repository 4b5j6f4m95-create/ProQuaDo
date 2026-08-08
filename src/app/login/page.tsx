import { signIn } from '@/lib/auth';

export default function LoginPage() {
  return (
    <main>
      <h1>ProQuaDo Anmeldung</h1>
      <form
        action={async () => {
          'use server';
          await signIn('oidc');
        }}
      >
        <button type="submit">Mit SSO anmelden</button>
      </form>
    </main>
  );
}
