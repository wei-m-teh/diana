export const PERSONALITY_TRAITS = [
  {
    key: 'openness',
    label: 'Openness',
    low: 'Practical and familiar',
    high: 'Curious and imaginative',
  },
  {
    key: 'conscientiousness',
    label: 'Conscientiousness',
    low: 'Spontaneous and flexible',
    high: 'Organized and deliberate',
  },
  {
    key: 'extraversion',
    label: 'Extraversion',
    low: 'Reserved and quiet',
    high: 'Outgoing and energetic',
  },
  {
    key: 'agreeableness',
    label: 'Agreeableness',
    low: 'Direct and challenging',
    high: 'Cooperative and accommodating',
  },
  {
    key: 'neuroticism',
    label: 'Neuroticism',
    low: 'Calm and steady',
    high: 'Expressive and sensitive',
  },
] as const;
export type Personality = Record<(typeof PERSONALITY_TRAITS)[number]['key'], number>;
export const DEFAULT_PERSONALITY: Personality = {
  openness: 50,
  conscientiousness: 50,
  extraversion: 50,
  agreeableness: 50,
  neuroticism: 50,
};
export function isPersonality(value: unknown): value is Personality {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const traits = value as Record<string, unknown>;
  return (
    Object.keys(traits).length === PERSONALITY_TRAITS.length &&
    PERSONALITY_TRAITS.every(
      ({ key }) =>
        typeof traits[key] === 'number' &&
        Number.isInteger(traits[key]) &&
        traits[key] >= 0 &&
        traits[key] <= 100
    )
  );
}
export function normalizePersonality(value: unknown): Personality {
  return isPersonality(value) ? { ...value } : { ...DEFAULT_PERSONALITY };
}
export function samePersonality(a: Personality, b: Personality): boolean {
  return PERSONALITY_TRAITS.every(({ key }) => a[key] === b[key]);
}
