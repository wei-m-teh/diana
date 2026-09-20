import { TokenSource } from 'livekit-client';
import { accessToken, authentication } from './cognito-auth';

// Only public deployment configuration is served from S3.
export function createDeploymentTokenSource() {
  return TokenSource.custom(async () => {
    const { config } = await authentication();
    const token = await accessToken();
    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      credentials: 'omit',
    });
    if (response.status === 401 || response.status === 403) {
      window.dispatchEvent(new Event('diana-signout'));
      throw new Error('Please sign in again to start a conversation.');
    }
    if (!response.ok) throw new Error('Unable to start a conversation. Please try again.');
    return response.json();
  });
}
