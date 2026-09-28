export type LocationPreference = { mode: 'off' | 'device' } | { mode: 'manual'; city: string };
export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
}
export interface SavedLocation extends LocationFix {
  city: string | null;
}
export function validLocationPreference(value: unknown): value is LocationPreference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (v.mode === 'off' || v.mode === 'device') return Object.keys(v).length === 1;
  return (
    v.mode === 'manual' &&
    Object.keys(v).length === 2 &&
    typeof v.city === 'string' &&
    v.city.trim().length > 0 &&
    v.city.length <= 120 &&
    !/[\u0000-\u001f\u007f]/u.test(v.city)
  );
}
export function locationPreference(value: unknown): LocationPreference {
  return validLocationPreference(value) ? value : { mode: 'off' };
}
// Coordinates are rounded before storage and inference; raw GPS precision is unnecessary.
export function parseLocationFix(value: unknown, now = Date.now()): LocationFix | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.latitude !== 'number' ||
    !Number.isFinite(v.latitude) ||
    Math.abs(v.latitude) > 90 ||
    typeof v.longitude !== 'number' ||
    !Number.isFinite(v.longitude) ||
    Math.abs(v.longitude) > 180 ||
    typeof v.accuracyMeters !== 'number' ||
    !Number.isFinite(v.accuracyMeters) ||
    v.accuracyMeters < 0 ||
    v.accuracyMeters > 100000 ||
    typeof v.capturedAt !== 'string'
  )
    return null;
  const captured = Date.parse(v.capturedAt);
  if (!Number.isFinite(captured) || captured > now + 60000 || captured < now - 600000) return null;
  return {
    latitude: Math.round(v.latitude * 100) / 100,
    longitude: Math.round(v.longitude * 100) / 100,
    accuracyMeters: Math.max(1000, v.accuracyMeters),
    capturedAt: new Date(Math.min(captured, now)).toISOString(),
  };
}
