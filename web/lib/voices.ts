// Web mirror of agent/src/voices.py. Keep keys in sync: they are persisted in
// user_settings.voice_key and sent to the agent as dispatch metadata.
// The token service uses `tier` to gate "pro" voices by plan.

export type VoiceTier = 'free' | 'pro';

export interface Voice {
  key: string;
  label: string;
  tier: VoiceTier;
}

export const VOICES: Voice[] = [
  { key: 'delia', label: 'Delia — warm, friendly', tier: 'free' },
  { key: 'thalia', label: 'Thalia — clear, upbeat', tier: 'free' },
  { key: 'andromeda', label: 'Andromeda — calm', tier: 'free' },
  { key: 'apollo', label: 'Apollo — confident', tier: 'free' },
  { key: 'orion', label: 'Orion — deep', tier: 'free' },
  { key: 'aria', label: 'Aria — expressive', tier: 'pro' },
  { key: 'nova', label: 'Nova — lively', tier: 'pro' },
];

export const DEFAULT_VOICE_KEY = 'delia';

const VOICE_BY_KEY = new Map(VOICES.map((v) => [v.key, v]));

export function getVoice(key: string | null | undefined): Voice {
  return (key && VOICE_BY_KEY.get(key)) || VOICE_BY_KEY.get(DEFAULT_VOICE_KEY)!;
}

export function isProVoice(key: string | null | undefined): boolean {
  return getVoice(key).tier === 'pro';
}
