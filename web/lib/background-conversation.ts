import { Room, RoomEvent } from 'livekit-client';

// livekit-client 2.19.2 treats browser freeze as an intentional leave even
// when disconnectOnPageLeave is false:
// https://github.com/livekit/client-sdk-js/issues/1968
// Remove the freeze listener too; Room uses disconnectOnPageLeave: false.
// Explicit End/sign-out and component-unmount cleanup still disconnect.
// This compatibility workaround must be regression-tested on SDK upgrades.
export function preserveRoomOnFreeze(room: Room): () => void {
  function removeFreezeDisconnect() {
    const handler = (room as unknown as { onPageLeave?: EventListener }).onPageLeave;
    if (typeof handler === 'function') {
      window.removeEventListener('freeze', handler);
    } else {
      console.warn('Background conversation compatibility check failed: LiveKit handler changed.');
    }
  }
  room.on(RoomEvent.Connected, removeFreezeDisconnect);
  room.on(RoomEvent.Reconnected, removeFreezeDisconnect);
  removeFreezeDisconnect();
  return () => {
    room.off(RoomEvent.Connected, removeFreezeDisconnect);
    room.off(RoomEvent.Reconnected, removeFreezeDisconnect);
  };
}
