import { InMemoryWebStorage, UserManager, WebStorageStateStore } from 'oidc-client-ts';

interface DeploymentConfig {
  tokenEndpoint: string;
  cognitoIssuer: string;
  cognitoDomain: string;
  cognitoClientId: string;
  cognitoScope: string;
  redirectUri: string;
}

let instance: Promise<{ manager: UserManager; config: DeploymentConfig }> | undefined;
export function authentication() {
  return (instance ??= (async () => {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Unable to load sign-in configuration.');
    const config: DeploymentConfig = await response.json();
    if (
      !config.cognitoIssuer ||
      !config.cognitoClientId ||
      !config.tokenEndpoint?.startsWith('https://')
    ) {
      throw new Error('Sign-in is not configured.');
    }
    const manager = new UserManager({
      authority: config.cognitoIssuer,
      client_id: config.cognitoClientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: `openid email ${config.cognitoScope}`,
      automaticSilentRenew: false,
      loadUserInfo: false,
      revokeTokenTypes: ['refresh_token'],
      userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
      stateStore: new WebStorageStateStore({ store: window.sessionStorage }),
    });
    return { manager, config };
  })());
}

let initialized: Promise<boolean> | undefined;
export function restoreSignIn() {
  return (initialized ??= (async () => {
    const { manager } = await authentication();
    const query = new URLSearchParams(window.location.search);
    if (query.has('code') || query.has('error')) {
      try {
        await manager.signinRedirectCallback();
      } finally {
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
    const user = await manager.getUser();
    return !!user && !user.expired;
  })());
}

export async function signIn() {
  const { manager } = await authentication();
  await manager.signinRedirect();
}

export async function accessToken() {
  const { manager } = await authentication();
  let user = await manager.getUser();
  try {
    if (user && (user.expires_in ?? 0) < 60) user = await manager.signinSilent();
    if (!user || user.expired) throw new Error('Sign in to start a conversation.');
    return user.access_token;
  } catch {
    await manager.removeUser();
    window.dispatchEvent(new Event('diana-signout'));
    throw new Error('Your sign-in has expired. Please sign in again.');
  }
}

export async function signOut() {
  const { manager, config } = await authentication();
  try {
    await manager.revokeTokens(['refresh_token']);
  } finally {
    await manager.removeUser();
    window.location.assign(
      `${config.cognitoDomain}/logout?client_id=${encodeURIComponent(config.cognitoClientId)}&logout_uri=${encodeURIComponent(config.redirectUri)}`
    );
  }
}
