'use client';

import { useEffect, useState } from 'react';
import { restoreSignIn, signIn } from '@/lib/cognito-auth';

export function CognitoGate({ children }: { children: React.ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let mounted = true;
    restoreSignIn()
      .then((value) => {
        if (mounted) setSignedIn(value);
      })
      .catch(() => {
        if (mounted) setError('Sign-in could not be completed. Please try again.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    const reset = () => setSignedIn(false);
    window.addEventListener('diana-signout', reset);
    return () => {
      mounted = false;
      window.removeEventListener('diana-signout', reset);
    };
  }, []);
  if (signedIn) return children;
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-3xl font-semibold">Diana</h1>
      <p>Sign in to start your conversation.</p>
      {error && <p role="alert">{error}</p>}
      <button
        className="bg-foreground text-background rounded-full px-6 py-3"
        disabled={loading}
        onClick={() => {
          setLoading(true);
          void signIn().catch(() => {
            setError('Unable to open sign-in. Please try again.');
            setLoading(false);
          });
        }}
      >
        {loading ? 'Loading…' : 'Sign in'}
      </button>
    </main>
  );
}
