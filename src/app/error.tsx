'use client';

export default function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main style={{ padding: '2rem', maxWidth: 640 }}>
      <h1>Ein Fehler ist aufgetreten</h1>
      <p>{error.message}</p>
      <button onClick={reset} type="button">
        Erneut versuchen
      </button>
    </main>
  );
}
