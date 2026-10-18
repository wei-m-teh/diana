'use client';

import { type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { ParticipantKind, RoomEvent } from 'livekit-client';
import { useSessionContext } from '@livekit/components-react';
import { type SearchSources, parseSearchSources } from '@/lib/search-sources';
import { deviceTimezone } from '@/lib/timezone';

const SourcesContext = createContext<SearchSources[]>([]);
export function ConversationContext({ children }: { children: ReactNode }) {
  const { room, isConnected } = useSessionContext();
  const [sources, setSources] = useState<SearchSources[]>([]);
  useEffect(() => {
    const receive = (
      data: Uint8Array,
      participant: { kind: ParticipantKind } | undefined,
      _kind: unknown,
      topic?: string
    ) => {
      if (
        topic !== 'diana.sources' ||
        participant?.kind !== ParticipantKind.AGENT ||
        data.length > 16000
      )
        return;
      try {
        const parsed = parseSearchSources(JSON.parse(new TextDecoder().decode(data)));
        if (parsed)
          setSources((previous) => {
            if (previous.some((x) => x.id === parsed.id))
              return previous.map((x) => (x.id === parsed.id ? parsed : x));
            return [...previous.slice(-9), parsed];
          });
      } catch {
        /* Ignore malformed source messages. */
      }
    };
    room.on(RoomEvent.DataReceived, receive);
    return () => {
      room.off(RoomEvent.DataReceived, receive);
    };
  }, [room]);
  useEffect(() => {
    if (!isConnected) return;
    let last: string | null = null;
    let stopped = false;
    const publish = async () => {
      const timezone = deviceTimezone();
      if (!timezone || timezone === last || stopped) return;
      try {
        await room.localParticipant.publishData(
          new TextEncoder().encode(JSON.stringify({ timezone })),
          { reliable: true, topic: 'diana.timezone' }
        );
        if (!stopped) last = timezone;
      } catch {
        /* Retry on the next poll or resume. */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void publish();
    };
    void publish();
    const timer = setInterval(() => void publish(), 30000);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [room, isConnected]);
  return <SourcesContext.Provider value={sources}>{children}</SourcesContext.Provider>;
}

export const useSearchSources = () => useContext(SourcesContext);
