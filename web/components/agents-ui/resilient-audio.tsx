'use client';

import { createContext, useContext, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Track } from 'livekit-client';
import {
  AudioTrack,
  type RoomAudioRendererProps,
  type TrackReference,
  useTracks,
} from '@livekit/components-react';

type Failure = { time: string; track: string; code: number; message: string; attempt: number };
const RecoveryContext = createContext<{
  generation: number;
  reset: () => void;
  failures: React.MutableRefObject<Failure[]>;
} | null>(null);

export function AudioRecoveryProvider({ children }: { children: React.ReactNode }) {
  const [generation, setGeneration] = useState(0);
  const failures = useRef<Failure[]>([]);
  return (
    <RecoveryContext.Provider
      value={{
        generation,
        // Mount and attach the new players while the Retry click still has user activation.
        reset: () => flushSync(() => setGeneration((value) => value + 1)),
        failures,
      }}
    >
      {children}
    </RecoveryContext.Provider>
  );
}

export function useAudioRecovery() {
  const recovery = useContext(RecoveryContext);
  if (!recovery) throw new Error('AudioRecoveryProvider is required');
  return recovery;
}

function RecoveringTrack({
  trackRef,
  volume,
  muted,
}: { trackRef: TrackReference } & Pick<RoomAudioRendererProps, 'volume' | 'muted'>) {
  const [attempt, setAttempt] = useState(0);
  const handled = useRef(new WeakSet<HTMLMediaElement>());
  const { failures } = useAudioRecovery();
  return (
    <AudioTrack
      key={attempt}
      trackRef={trackRef}
      volume={volume}
      muted={muted}
      onError={(event) => {
        const player = event.currentTarget;
        const error = player.error;
        if (!error || handled.current.has(player)) return;
        handled.current.add(player);
        failures.current = [
          ...failures.current.slice(-19),
          {
            time: new Date().toISOString(),
            track: trackRef.publication.trackSid,
            code: error.code,
            message: error.message.slice(0, 500),
            attempt,
          },
        ];
        // play() cannot clear a terminal media error. A new element lets LiveKit
        // detach the failed player and attach this same remote track afresh.
        // Cap attempts so a persistent decoder/device failure cannot loop forever.
        if ((error.code === 3 || error.code === 4) && attempt < 2) {
          setAttempt((value) => value + 1);
        }
      }}
    />
  );
}

export function ResilientAudioRenderer({ room, volume, muted }: RoomAudioRendererProps) {
  const { generation } = useAudioRecovery();
  const tracks = useTracks(
    [Track.Source.Microphone, Track.Source.ScreenShareAudio, Track.Source.Unknown],
    { updateOnlyOn: [], onlySubscribed: true, room }
  ).filter((ref) => !ref.participant.isLocal && ref.publication.kind === Track.Kind.Audio);

  return (
    <div style={{ display: 'none' }}>
      {tracks.map((trackRef) => (
        <RecoveringTrack
          key={`${trackRef.participant.identity}:${trackRef.publication.trackSid}:${generation}`}
          trackRef={trackRef}
          volume={volume}
          muted={muted}
        />
      ))}
    </div>
  );
}
