'use client';

import { useEffect, useRef, useState } from 'react';
import { RemoteAudioTrack } from 'livekit-client';
import { useSessionContext } from '@livekit/components-react';
import * as Dialog from '@radix-ui/react-dialog';
import { useAudioRecovery } from '@/components/agents-ui/resilient-audio';
import { readSessionDiagnostics } from '@/lib/session-diagnostics';

const BUILD = 'sound-check-3';
type Sample = {
  time: string;
  connected: string;
  allowed: boolean;
  streams: { id: string; bytes?: number; energy?: number; state: string }[];
  players: {
    paused: boolean;
    muted: boolean;
    volume: number;
    time: number;
    error: number | null;
    errorMessage: string | null;
    readyState: number;
  }[];
};

export function SoundCheck() {
  const recovery = useAudioRecovery();
  const { room, isConnected } = useSessionContext();
  const [open, setOpen] = useState(false);
  const [latest, setLatest] = useState<Sample>();
  const [message, setMessage] = useState('');
  const history = useRef<Sample[]>([]);
  const actions = useRef<{ time: string; action: string }[]>([]);
  const buttonClass = 'rounded-lg border px-3 py-2 text-sm';

  useEffect(() => {
    if (!isConnected) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function sample() {
      const streams: Sample['streams'] = [];
      const players: Sample['players'] = [];
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.audioTrackPublications.values()) {
          const track = publication.track;
          if (!(track instanceof RemoteAudioTrack)) continue;
          const stats = await track.getReceiverStats().catch(() => undefined);
          streams.push({
            id: publication.trackSid,
            bytes: stats?.bytesReceived,
            energy: stats?.totalAudioEnergy,
            state: track.mediaStreamTrack.readyState,
          });
          for (const element of track.attachedElements) {
            players.push({
              paused: element.paused,
              muted: element.muted,
              volume: element.volume,
              time: element.currentTime,
              error: element.error?.code ?? null,
              errorMessage: element.error?.message ?? null,
              readyState: element.readyState,
            });
          }
        }
      }
      if (stopped) return;
      const value = {
        time: new Date().toISOString(),
        connected: room.state,
        allowed: room.canPlaybackAudio,
        streams,
        players,
      };
      history.current = [...history.current.slice(-29), value];
      if (open) setLatest(value);
      timer = setTimeout(() => void sample(), 1000);
    }
    void sample();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [room, isConnected, open]);

  function record(action: string) {
    actions.current = [...actions.current.slice(-9), { time: new Date().toISOString(), action }];
  }

  async function retry() {
    record('retry-playback');
    try {
      recovery.reset();
      await room.startAudio();
      setMessage(
        'New voice player started. Ask Diana for another reply; the sound report will show whether playback advances.'
      );
    } catch {
      setMessage('The browser could not start playback. Please copy the sound report below.');
    }
  }

  async function testTone() {
    record('test-tone');
    const context = new AudioContext();
    try {
      await context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 440;
      gain.gain.setValueAtTime(0.04, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.4);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        void context.close();
      };
      oscillator.start();
      oscillator.stop(context.currentTime + 0.4);
      setMessage(
        'A short test tone was requested. Note whether you heard it when sharing the report.'
      );
    } catch {
      void context.close();
      setMessage('The browser could not start the test tone.');
    }
  }

  const report = JSON.stringify(
    {
      build: BUILD,
      browser: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      room: room.name,
      samples: history.current,
      actions: actions.current,
      failures: recovery.failures.current,
      lifecycle: readSessionDiagnostics(),
    },
    null,
    2
  );
  const received = latest?.streams.some((stream) => (stream.energy ?? 0) > 0);
  const playing = latest?.players.some(
    (player) => !player.paused && !player.muted && player.volume > 0 && !player.error
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="bg-background fixed top-20 left-4 z-[55] rounded-lg border px-3 py-2 text-sm">
        Sound check
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/50" />
        <Dialog.Content className="bg-background fixed inset-x-4 top-24 z-[120] mx-auto max-h-[75svh] max-w-lg overflow-y-auto rounded-xl border p-4 shadow-lg">
          <Dialog.Title className="text-lg font-semibold">Sound check</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm">
            Open this during a silent reply or after an unexpected reset. You can share this report
            to help diagnose sound problems. It contains playback details, not conversation text,
            recordings, or sign-in tokens.
          </Dialog.Description>
          <dl className="my-4 grid grid-cols-2 gap-2 text-sm">
            <dt>Voice signal received in this call</dt>
            <dd>{latest ? (received ? 'Yes' : 'Not yet') : 'Checking…'}</dd>
            <dt>Voice players</dt>
            <dd>{latest?.players.length ?? 'Checking…'}</dd>
            <dt>Browser reports playback</dt>
            <dd>{latest ? (playing ? 'Playing' : 'Not playing') : 'Checking…'}</dd>
            <dt>Browser permits audio</dt>
            <dd>{latest ? (latest.allowed ? 'Yes' : 'No') : 'Checking…'}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button className={buttonClass} disabled={!isConnected} onClick={() => void retry()}>
              Retry voice playback
            </button>
            <button className={buttonClass} onClick={() => void testTone()}>
              Play test tone
            </button>
            <button
              className={buttonClass}
              onClick={() => {
                void navigator.clipboard.writeText(report).then(
                  () => setMessage('Sound report copied. Paste it into your support conversation.'),
                  () => setMessage('Copy is unavailable. Select and copy the report below.')
                );
              }}
            >
              Copy sound report
            </button>
          </div>
          {message && (
            <p role="status" className="mt-3 text-sm">
              {message}
            </p>
          )}
          <details className="mt-3 text-sm">
            <summary>Sound report · {BUILD}</summary>
            <textarea
              aria-label="Sound report"
              readOnly
              value={report}
              className="mt-2 h-40 w-full border p-2 font-mono text-xs"
            />
          </details>
          <Dialog.Close className={`${buttonClass} mt-4`}>Close sound check</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
