// IANA names, not offsets: daylight-saving rules are resolved for each instant.
export function validTimezone(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length > 100 ||
    !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(value)
  )
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
export function deviceTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return validTimezone(zone) ? zone : null;
  } catch {
    return null;
  }
}
export function resolveTimezone(
  preference: unknown,
  device: unknown
): { mode: 'manual' | 'device'; name: string | null } {
  return validTimezone(preference)
    ? { mode: 'manual', name: preference }
    : { mode: 'device', name: validTimezone(device) ? device : null };
}
