'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Room, RoomEvent, TokenSource } from 'livekit-client';
import { useSession } from '@livekit/components-react';
import { WarningIcon } from '@phosphor-icons/react/dist/ssr';
import type { AppConfig } from '@/app-config';
import { AgentSessionProvider } from '@/components/agents-ui/agent-session-provider';
import { StartAudioButton } from '@/components/agents-ui/start-audio-button';
import { ViewController } from '@/components/app/view-controller';
import { Toaster } from '@/components/ui/sonner';
import { useAgentErrors } from '@/hooks/useAgentErrors';
import { useDebugMode } from '@/hooks/useDebug';
import { preserveRoomOnFreeze } from '@/lib/background-conversation';
import { signOut } from '@/lib/cognito-auth';
import { createDeploymentTokenSource } from '@/lib/deployment-token-source';
import { recordSessionDiagnostic, traceSessionLifecycle } from '@/lib/session-diagnostics';
import { getSandboxTokenSource } from '@/lib/utils';
import { CognitoGate } from './cognito-gate';
import { ProfileSettings } from './profile-settings';
import { SoundCheck } from './sound-check';

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
  const [sessionKey, setSessionKey] = useState(0);
  const resetSession = useCallback(() => setSessionKey((key) => key + 1), []);
  const openProfile = useCallback(() => setShowProfile(true), []);

  return (
    <>
      <ConversationSession
        key={sessionKey}
        appConfig={appConfig}
        onEnded={resetSession}
        onOpenProfile={openProfile}
      />
      {showProfile && <ProfileSettings onClose={() => setShowProfile(false)} />}
    </>
  );
}

function ConversationSession({
  appConfig,
  onEnded,
  onOpenProfile,
}: AppProps & { onEnded: () => void; onOpenProfile: () => void }) {
  const tokenSource = useMemo(() => {
    if (process.env.NEXT_PUBLIC_DIANA_STATIC === '1') {
      return createDeploymentTokenSource();
    }
    return typeof process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT === 'string'
      ? getSandboxTokenSource(appConfig)
      : TokenSource.endpoint('/api/token');
  }, [appConfig]);

  // Mobile page lifecycle events must not be interpreted as the user ending
  // a call. Closing the tab still destroys its media and transport; LiveKit
  // detects that loss server-side. End/sign-out explicitly disconnect below.
  const room = useMemo(() => new Room({ disconnectOnPageLeave: false }), []);
  const session = useSession(tokenSource, {
    room,
    ...(appConfig.agentName ? { agentName: appConfig.agentName } : {}),
  });

  useEffect(() => traceSessionLifecycle(session.room), [session.room]);

  useEffect(() => preserveRoomOnFreeze(session.room), [session.room]);

  useEffect(() => {
    // A completed call owns its room, media elements and playback state. Drop
    // that whole session before presenting Start again. Network reconnects do
    // not emit Disconnected, so they retain the ongoing conversation.
    let connected = false;
    const markConnected = () => {
      connected = true;
    };
    const resetAfterDisconnect = () => {
      if (connected) {
        connected = false;
        onEnded();
      }
    };
    const room = session.room;
    room.on(RoomEvent.Connected, markConnected);
    room.on(RoomEvent.Disconnected, resetAfterDisconnect);
    return () => {
      room.off(RoomEvent.Connected, markConnected);
      room.off(RoomEvent.Disconnected, resetAfterDisconnect);
    };
  }, [session.room, onEnded]);

  return (
    <AgentSessionProvider session={session}>
      <AppSetup />
      <SoundCheck />
      {process.env.NEXT_PUBLIC_DIANA_STATIC === '1' && (
        <div className="fixed top-4 right-4 z-50 flex gap-2">
          <button className="rounded-full border px-4 py-2" onClick={onOpenProfile}>
            Profile / Settings
          </button>
          <button
            className="rounded-full border px-4 py-2"
            onClick={() => {
              recordSessionDiagnostic('sign-out-clicked');
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
      <StartAudioButton
        label="Start Audio"
        className="fixed top-20 left-1/2 z-[100] -translate-x-1/2 shadow-lg"
      />
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
