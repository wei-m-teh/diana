import { GeoPlacesClient, ReverseGeocodeCommand } from '@aws-sdk/client-geo-places';
import { locationPreference, type LocationFix, type SavedLocation } from '../../web/lib/location';
import type { UserProfile } from './profile-store';
const places = new GeoPlacesClient({ maxAttempts: 1 });
export function createCityLookup(client: Pick<typeof places, 'send'> = places) {
  return async (fix: LocationFix): Promise<string | null> => {
    try {
      const response = await client.send(new ReverseGeocodeCommand({
        QueryPosition: [fix.longitude, fix.latitude], MaxResults: 1,
        IntendedUse: 'Storage', Language: 'en',
      }), { abortSignal: AbortSignal.timeout(2000) });
      const address = response.ResultItems?.[0]?.Address;
      // Never retain street, house number or the full address label.
      const city = [address?.Locality, address?.Region?.Name, address?.Country?.Name].filter(Boolean).join(', ');
      return city ? city.slice(0, 200) : null;
    } catch { return null; }
  };
}
export const lookupCity = createCityLookup();
export function sessionLocation(profile: UserProfile | void, fresh?: SavedLocation) {
  const preference = locationPreference(profile?.preferences.location);
  if (preference.mode === 'off') return { source: 'unavailable' };
  if (preference.mode === 'manual') return { source: 'manual', city: preference.city };
  const saved = profile?.lastKnownLocation;
  if (!saved) return { source: 'unavailable' };
  return { ...saved, source: fresh && saved.capturedAt === fresh.capturedAt && saved.latitude === fresh.latitude && saved.longitude === fresh.longitude ? 'device' : 'last_known' };
}
