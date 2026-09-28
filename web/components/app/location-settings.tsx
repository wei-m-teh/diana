'use client';

import { useState } from 'react';
import { deviceLocation } from '@/lib/device-location';
import type { LocationPreference, SavedLocation } from '@/lib/location';

export function LocationSettings({
  value,
  onChange,
  disabled,
  lastKnown,
}: {
  value: LocationPreference;
  onChange: (value: LocationPreference) => void;
  disabled: boolean;
  lastKnown?: SavedLocation | null;
}) {
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState('');
  async function check() {
    setChecking(true);
    setStatus('Checking this device’s location…');
    const fix = await deviceLocation();
    setStatus(
      fix
        ? 'Location access works. Save changes to use it for future conversations.'
        : 'Location unavailable. Check this browser’s permission and device location settings. Diana can use a saved location or a manual city.'
    );
    setChecking(false);
  }
  return (
    <fieldset disabled={disabled || checking} className="flex flex-col gap-3">
      <legend className="mb-2 text-xl font-semibold">Location</legend>
      <label htmlFor="location-mode">Share location with Diana</label>
      <select
        id="location-mode"
        value={value.mode}
        className="bg-background rounded-lg border px-3 py-2"
        onChange={(event) => {
          const mode = event.target.value as LocationPreference['mode'];
          onChange(mode === 'manual' ? { mode, city: '' } : { mode });
          setStatus('');
          if (mode === 'device') void check();
        }}
      >
        <option value="off">Off — clear saved location</option>
        <option value="device">Use device location</option>
        <option value="manual">Use a city I enter</option>
      </select>
      {value.mode === 'manual' && (
        <label className="flex flex-col gap-2">
          City, region and country
          <input
            value={value.city}
            maxLength={120}
            placeholder="Seattle, Washington, USA"
            className="rounded-lg border bg-transparent px-3 py-2"
            onChange={(event) => onChange({ mode: 'manual', city: event.target.value })}
          />
        </label>
      )}
      {value.mode === 'device' && (
        <button
          type="button"
          className="self-start rounded-lg border px-4 py-2"
          onClick={() => void check()}
        >
          Allow / check location on this device
        </button>
      )}
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        Device mode checks your approximate location when each conversation starts. Your last
        location and its time are saved to your account for future conversations if a new location
        is unavailable. Permission is controlled separately on each device. No continuous tracking.
      </p>
      {lastKnown && (
        <p className="text-muted-foreground text-sm">
          Last saved: {lastKnown.city ?? 'Approximate location'} ·{' '}
          {new Date(lastKnown.capturedAt).toLocaleString()}
        </p>
      )}
      <p className="text-muted-foreground text-sm">
        Save changes to apply on web and Android, starting with your next conversation. Turning
        sharing off clears the saved fix; it cannot remove location already shared in an active
        conversation.
      </p>
    </fieldset>
  );
}
