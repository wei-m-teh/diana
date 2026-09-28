'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { LocationSettings } from '@/components/app/location-settings';
import {
  type LocationPreference,
  locationPreference,
  validLocationPreference,
} from '@/lib/location';
import {
  DEFAULT_PERSONALITY,
  PERSONALITY_TRAITS,
  type Personality,
  normalizePersonality,
  samePersonality,
} from '@/lib/personality';
import { type UserProfile, profileRequest } from '@/lib/profile';
import { deviceTimezone, validTimezone } from '@/lib/timezone';
import { VOICES } from '@/lib/voices';

export function ProfileSettings({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = useState<UserProfile>();
  const [name, setName] = useState('');
  const [voice, setVoice] = useState('delia');
  const [location, setLocation] = useState<LocationPreference>({ mode: 'off' });
  const [timezone, setTimezone] = useState('');
  const [automaticTimezone, setAutomaticTimezone] = useState(true);
  const [personality, setPersonality] = useState<Personality>({ ...DEFAULT_PERSONALITY });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    profileRequest()
      .then((value) => {
        if (!active) return;
        setProfile(value);
        setLocation(locationPreference(value.preferences.location));
        setName(value.displayName);
        setVoice(value.preferences.voiceKey);
        setAutomaticTimezone(!value.preferences.timezone);
        setTimezone(value.preferences.timezone ?? deviceTimezone() ?? 'UTC');
        setPersonality(normalizePersonality(value.preferences.personality));
      })
      .catch(() => {
        if (active) setError('Unable to load your profile. Please try again.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  const dirty =
    !!profile &&
    (name.trim() !== profile.displayName ||
      voice !== profile.preferences.voiceKey ||
      JSON.stringify(location) !==
        JSON.stringify(locationPreference(profile.preferences.location)) ||
      (automaticTimezone ? null : timezone) !== (profile.preferences.timezone ?? null) ||
      !samePersonality(personality, normalizePersonality(profile.preferences.personality)));
  const invalidTimezone = !automaticTimezone && !validTimezone(timezone);
  const invalidName = name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name);
  function close() {
    if (!dirty || window.confirm('Discard your unsaved profile changes?')) onClose();
  }
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !saving) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="bg-background fixed inset-0 z-[60] overflow-y-auto px-6 py-8"
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            if (!saving) close();
          }}
        >
          <div className="mx-auto flex max-w-lg flex-col gap-6">
            <button
              className="self-start rounded-lg border px-4 py-2"
              onClick={close}
              disabled={saving}
            >
              Back to Diana
            </button>
            <Dialog.Title className="text-3xl font-semibold">Profile / Settings</Dialog.Title>
            {loading && <p role="status">Loading your profile…</p>}
            {error && (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            )}
            {!loading && !profile && (
              <button
                className="rounded-lg border px-4 py-2"
                onClick={() => setAttempt(attempt + 1)}
              >
                Retry
              </button>
            )}
            {profile && (
              <form
                className="flex flex-col gap-6"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (
                    saving ||
                    !dirty ||
                    invalidName ||
                    invalidTimezone ||
                    !validLocationPreference(location)
                  )
                    return;
                  setSaving(true);
                  setError('');
                  setSaved(false);
                  try {
                    const patch: {
                      displayName?: string;
                      voiceKey?: string;
                      personality?: Personality;
                      timezone?: string | null;
                      location?: LocationPreference;
                    } = {};
                    if (name.trim() !== profile.displayName) patch.displayName = name.trim();
                    if (voice !== profile.preferences.voiceKey) patch.voiceKey = voice;
                    if (
                      !samePersonality(
                        personality,
                        normalizePersonality(profile.preferences.personality)
                      )
                    )
                      patch.personality = personality;
                    if (
                      (automaticTimezone ? null : timezone) !==
                      (profile.preferences.timezone ?? null)
                    )
                      patch.timezone = automaticTimezone ? null : timezone;
                    if (
                      JSON.stringify(location) !==
                      JSON.stringify(locationPreference(profile.preferences.location))
                    )
                      patch.location = location;
                    const updated = await profileRequest(patch);
                    setProfile(updated);
                    setLocation(locationPreference(updated.preferences.location));
                    setName(updated.displayName);
                    setVoice(updated.preferences.voiceKey);
                    setAutomaticTimezone(!updated.preferences.timezone);
                    setTimezone(updated.preferences.timezone ?? deviceTimezone() ?? 'UTC');
                    setPersonality(normalizePersonality(updated.preferences.personality));
                    setSaved(true);
                  } catch {
                    setError('Your changes could not be saved. Please try again.');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <div>
                  <p className="font-medium">Email</p>
                  <p className="break-all">{profile.email || 'Not provided'}</p>
                  <p className="text-muted-foreground text-sm">Managed by your sign-in account.</p>
                </div>
                <label className="flex flex-col gap-2">
                  Display name
                  <input
                    autoComplete="nickname"
                    maxLength={100}
                    value={name}
                    disabled={saving}
                    className="rounded-lg border bg-transparent px-3 py-2"
                    onChange={(event) => {
                      setName(event.target.value);
                      setSaved(false);
                    }}
                  />
                </label>
                {invalidName && (
                  <p role="alert">Use up to 100 characters without control characters.</p>
                )}
                <div className="flex flex-col gap-2">
                  <label htmlFor="preferred-voice">Preferred voice</label>
                  <select
                    id="preferred-voice"
                    value={voice}
                    disabled={saving}
                    className="bg-background rounded-lg border px-3 py-2"
                    aria-describedby="voice-note"
                    onChange={(event) => {
                      setVoice(event.target.value);
                      setSaved(false);
                    }}
                  >
                    {!VOICES.some((item) => item.key === voice) && (
                      <option value={voice}>Previously saved voice</option>
                    )}
                    {VOICES.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p id="voice-note" className="text-muted-foreground text-sm">
                  This saves your preference. Changing Diana’s speaking voice is not available yet.
                </p>
                <LocationSettings
                  value={location}
                  onChange={(value) => {
                    setLocation(value);
                    setSaved(false);
                  }}
                  disabled={saving}
                  lastKnown={profile.lastKnownLocation}
                />
                <fieldset disabled={saving} className="flex flex-col gap-3">
                  <legend className="mb-2 text-xl font-semibold">Timezone</legend>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={automaticTimezone}
                      onChange={(event) => {
                        setAutomaticTimezone(event.target.checked);
                        setSaved(false);
                      }}
                    />
                    Use device timezone
                  </label>
                  {automaticTimezone ? (
                    <p className="text-muted-foreground text-sm">
                      This device: {deviceTimezone() ?? 'Unavailable'}. Each device follows its own
                      timezone.
                    </p>
                  ) : (
                    <label className="flex flex-col gap-2">
                      Timezone name
                      <input
                        value={timezone}
                        onChange={(event) => {
                          setTimezone(event.target.value);
                          setSaved(false);
                        }}
                        placeholder="America/New_York"
                        className="rounded-lg border bg-transparent px-3 py-2"
                      />
                    </label>
                  )}
                  {invalidTimezone && (
                    <p role="alert">Enter an IANA timezone such as America/New_York.</p>
                  )}
                  <p className="text-muted-foreground text-sm">
                    Manual settings apply to both web and Android, starting with your next
                    conversation. Device mode follows travel and daylight saving automatically.
                  </p>
                </fieldset>
                <fieldset
                  disabled={saving}
                  className="flex flex-col gap-6"
                  aria-describedby="personality-note"
                >
                  <legend className="mb-2 text-xl font-semibold">Diana’s personality</legend>
                  <p id="personality-note" className="text-muted-foreground text-sm">
                    Shape how Diana talks with you. Saved changes apply to your next web
                    conversation. These control conversational style, not accuracy or safety. The
                    speaking voice stays the same.
                  </p>
                  {PERSONALITY_TRAITS.map(({ key, label, low, high }) => (
                    <div key={key} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-4">
                        <label htmlFor={`personality-${key}`} className="font-medium">
                          {label}
                        </label>
                        <output htmlFor={`personality-${key}`} className="text-sm tabular-nums">
                          {personality[key]} / 100
                        </output>
                      </div>
                      <input
                        id={`personality-${key}`}
                        type="range"
                        min={0}
                        max={100}
                        step={1}
                        value={personality[key]}
                        aria-describedby={`personality-${key}-ends`}
                        aria-valuetext={`${personality[key]} out of 100: ${personality[key] < 34 ? low : personality[key] < 67 ? 'Balanced' : high}`}
                        className="h-8 w-full cursor-pointer accent-blue-600"
                        onChange={(event) => {
                          setPersonality({ ...personality, [key]: Number(event.target.value) });
                          setSaved(false);
                        }}
                      />
                      <div
                        id={`personality-${key}-ends`}
                        className="text-muted-foreground flex justify-between gap-6 text-xs"
                      >
                        <span>{low}</span>
                        <span className="text-right">{high}</span>
                      </div>
                    </div>
                  ))}
                  <p className="text-muted-foreground text-sm">
                    Neuroticism adjusts emotional expressiveness and sensitivity; Diana will still
                    respond with care and stability. Midpoint values give a balanced style.
                  </p>
                  <button
                    type="button"
                    className="self-start rounded-lg border px-4 py-2"
                    onClick={() => {
                      setPersonality({ ...DEFAULT_PERSONALITY });
                      setSaved(false);
                    }}
                  >
                    Reset personality to balanced
                  </button>
                </fieldset>
                <div>
                  <p className="font-medium">Plan</p>
                  <p className="capitalize">
                    {profile.subscription.planId} · {profile.subscription.status}
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={
                    saving ||
                    !dirty ||
                    invalidName ||
                    invalidTimezone ||
                    !validLocationPreference(location)
                  }
                  className="bg-foreground text-background rounded-full px-6 py-3 disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                {saved && <p role="status">Profile saved.</p>}
              </form>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
