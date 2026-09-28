import { useEffect, useState } from 'react';
import { type AgentState } from '@livekit/components-react';

export function useAgentAudioVisualizerBarAnimator(
  state: AgentState | undefined,
  columns: number,
  interval: number
): number[] {
  const [index, setIndex] = useState(0);
  const connecting = state === 'connecting' || state === 'initializing';
  useEffect(() => {
    if (!connecting) return;
    setIndex(0);
    const timer = window.setInterval(() => setIndex((value) => value + 1), interval);
    return () => window.clearInterval(timer);
  }, [connecting, interval, columns]);

  if (columns < 1) return [];
  if (connecting) return [index % columns, columns - 1 - (index % columns)];
  // Keep brightness steady throughout a conversation. Previously thinking and
  // listening alternated a large bar on/off every 150/500 ms, causing flashes.
  // Speaking is still represented by the smoothly changing audio-band heights.
  return Array.from({ length: columns }, (_, i) => i);
}
