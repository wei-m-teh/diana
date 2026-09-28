import { Room, RoomEvent } from 'livekit-client';

const KEY = 'diana-session-diagnostics-v1';
type Entry = { time: string; event: string; visibility: string; state?: string };
export function readSessionDiagnostics(): Entry[] {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}
export function recordSessionDiagnostic(event: string, state?: string) {
  try {
    const entries = readSessionDiagnostics();
    entries.push({
      time: new Date().toISOString(),
      event,
      visibility: document.visibilityState,
      state,
    });
    sessionStorage.setItem(KEY, JSON.stringify(entries.slice(-60)));
  } catch {
    // Diagnostics must never interfere with the conversation.
  }
}

export function traceSessionLifecycle(room: Room) {
  recordSessionDiagnostic('session-mounted', room.state);
  const pageEvent = (event: Event) => recordSessionDiagnostic(event.type, room.state);
  const stateChanged = (state: string) => recordSessionDiagnostic('connection-state', state);
  const disconnected = (reason?: number) =>
    recordSessionDiagnostic('disconnected', String(reason ?? 'unspecified'));
  const originalDisconnect = room.disconnect;
  const tracedDisconnect: Room['disconnect'] = function (...args) {
    recordSessionDiagnostic('disconnect-called', room.state);
    return originalDisconnect.apply(room, args);
  };
  room.disconnect = tracedDisconnect;
  const events = ['freeze', 'resume', 'pagehide', 'pageshow', 'beforeunload', 'visibilitychange'];
  for (const event of events) window.addEventListener(event, pageEvent, true);
  room.on(RoomEvent.ConnectionStateChanged, stateChanged);
  room.on(RoomEvent.Disconnected, disconnected);
  return () => {
    recordSessionDiagnostic('session-unmounted', room.state);
    for (const event of events) window.removeEventListener(event, pageEvent, true);
    room.off(RoomEvent.ConnectionStateChanged, stateChanged);
    room.off(RoomEvent.Disconnected, disconnected);
    if (room.disconnect === tracedDisconnect) room.disconnect = originalDisconnect;
  };
}
