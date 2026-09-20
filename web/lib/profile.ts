import { accessToken, authentication } from '@/lib/cognito-auth';

export interface UserProfile {
  email: string;
  displayName: string;
  preferences: { voiceKey: string };
  subscription: { planId: string; status: string };
}

export async function profileRequest(patch?: {
  displayName?: string;
  voiceKey?: string;
}): Promise<UserProfile> {
  const { config } = await authentication();
  const token = await accessToken();
  const endpoint = new URL(config.tokenEndpoint);
  endpoint.pathname = endpoint.pathname.replace(/\/sessions$/, '/me');
  endpoint.search = '';
  const response = await fetch(endpoint, {
    method: patch ? 'PATCH' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: patch ? JSON.stringify(patch) : undefined,
    cache: 'no-store',
    credentials: 'omit',
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401 || response.status === 403) {
    window.dispatchEvent(new Event('diana-signout'));
    throw new Error('Please sign in again.');
  }
  if (!response.ok) throw new Error('Unable to access your profile. Please try again.');
  return response.json();
}
