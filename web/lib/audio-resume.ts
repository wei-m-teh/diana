import { type Room, RoomEvent } from 'livekit-client';

/** Restore audio after another app/tab takes focus, without reconnecting the call. */
export function attachAudioResume(
  room: Pick<Room, 'state' | 'startAudio' | 'on' | 'off'>,
  isMuted: () => boolean,
  page: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> = document,
  browser: Pick<Window, 'addEventListener' | 'removeEventListener'> = window
) {
  let disposed = false;
  let pending = false;
  const resume = () => {
    if (
      disposed ||
      pending ||
      page.visibilityState !== 'visible' ||
      isMuted() ||
      room.state !== 'connected'
    )
      return;
    pending = true;
    // LiveKit resumes its context and players. Rejection updates playback permission
    // state, revealing the existing Start Audio button for a user-initiated retry.
    void room
      .startAudio()
      .catch(() => {})
      .finally(() => {
        pending = false;
      });
  };
  page.addEventListener('visibilitychange', resume);
  browser.addEventListener('focus', resume);
  browser.addEventListener('pageshow', resume);
  room.on(RoomEvent.Reconnected, resume);
  resume();
  return () => {
    disposed = true;
    page.removeEventListener('visibilitychange', resume);
    browser.removeEventListener('focus', resume);
    browser.removeEventListener('pageshow', resume);
    room.off(RoomEvent.Reconnected, resume);
  };
}
