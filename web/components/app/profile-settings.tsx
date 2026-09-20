'use client';

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { type UserProfile, profileRequest } from '@/lib/profile';
import { VOICES } from '@/lib/voices';

export function ProfileSettings({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = useState<UserProfile>();
  const [name, setName] = useState('');
  const [voice, setVoice] = useState('delia');
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
        setName(value.displayName);
        setVoice(value.preferences.voiceKey);
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
    !!profile && (name.trim() !== profile.displayName || voice !== profile.preferences.voiceKey);
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
                  if (saving || !dirty || invalidName) return;
                  setSaving(true);
                  setError('');
                  setSaved(false);
                  try {
                    const patch: { displayName?: string; voiceKey?: string } = {};
                    if (name.trim() !== profile.displayName) patch.displayName = name.trim();
                    if (voice !== profile.preferences.voiceKey) patch.voiceKey = voice;
                    const updated = await profileRequest(patch);
                    setProfile(updated);
                    setName(updated.displayName);
                    setVoice(updated.preferences.voiceKey);
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
                <div>
                  <p className="font-medium">Plan</p>
                  <p className="capitalize">
                    {profile.subscription.planId} · {profile.subscription.status}
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={saving || !dirty || invalidName}
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
