import { type LocationFix, parseLocationFix } from './location';

export async function deviceLocation(): Promise<LocationFix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    let finished = false;
    const finish = (fix: LocationFix | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(fix);
    };
    const timer = setTimeout(() => finish(null), 8000);
    try {
      navigator.geolocation.getCurrentPosition(
        (position) =>
          finish(
            parseLocationFix({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyMeters: position.coords.accuracy,
              capturedAt: new Date(position.timestamp).toISOString(),
            })
          ),
        () => finish(null),
        { enableHighAccuracy: false, maximumAge: 0, timeout: 7000 }
      );
    } catch {
      finish(null);
    }
  });
}
