'use client';

import { useMemo, useState } from 'react';
import { TokenSource } from 'livekit-client';
import { useSession } from '@livekit/components-react';
import { WarningIcon } from '@phosphor-icons/react/dist/ssr';
import type { AppConfig } from '@/app-config';
import { AgentSessionProvider } from '@/components/agents-ui/agent-session-provider';
import { StartAudioButton } from '@/components/agents-ui/start-audio-button';
import { ViewController } from '@/components/app/view-controller';
import { Toaster } from '@/components/ui/sonner';
import { useAgentErrors } from '@/hooks/useAgentErrors';
import { useDebugMode } from '@/hooks/useDebug';
import { signOut } from '@/lib/cognito-auth';
import { createDeploymentTokenSource } from '@/lib/deployment-token-source';
import { getSandboxTokenSource } from '@/lib/utils';
import { CognitoGate } from './cognito-gate';
import { ProfileSettings } from './profile-settings';

const IN_DEVELOPMENT = process.env.NODE_ENV !== 'production';

function AppSetup() {
  useDebugMode({ enabled: IN_DEVELOPMENT });
  useAgentErrors();

  return null;
}

interface AppProps {
  appConfig: AppConfig;
}

export function App(props: AppProps) {
  return process.env.NEXT_PUBLIC_DIANA_STATIC === '1' ? (
    <CognitoGate>
      <ConversationApp {...props} />
    </CognitoGate>
  ) : (
    <ConversationApp {...props} />
  );
}

function ConversationApp({ appConfig }: AppProps) {
  const [showProfile, setShowProfile] = useState(false);
  const tokenSource = useMemo(() => {
    if (process.env.NEXT_PUBLIC_DIANA_STATIC === '1') {
      return createDeploymentTokenSource();
    }
    return typeof process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT === 'string'
      ? getSandboxTokenSource(appConfig)
      : TokenSource.endpoint('/api/token');
  }, [appConfig]);

  const session = useSession(
    tokenSource,
    appConfig.agentName ? { agentName: appConfig.agentName } : undefined
  );

  return (
    <AgentSessionProvider session={session}>
      <AppSetup />
      {process.env.NEXT_PUBLIC_DIANA_STATIC === '1' && (
        <div className="fixed top-4 right-4 z-50 flex gap-2">
          <button className="rounded-full border px-4 py-2" onClick={() => setShowProfile(true)}>
            Profile / Settings
          </button>
          <button
            className="rounded-full border px-4 py-2"
            onClick={() => {
              void session.end().finally(() => signOut());
            }}
          >
            Sign out
          </button>
        </div>
      )}
      <main className="grid h-svh grid-cols-1 place-content-center">
        <ViewController appConfig={appConfig} />
      </main>
      {showProfile && <ProfileSettings onClose={() => setShowProfile(false)} />}
      <StartAudioButton label="Start Audio" />
      <Toaster
        icons={{
          warning: <WarningIcon weight="bold" />,
        }}
        position="top-center"
        className="toaster group"
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)',
          } as React.CSSProperties
        }
      />
    </AgentSessionProvider>
  );
}
