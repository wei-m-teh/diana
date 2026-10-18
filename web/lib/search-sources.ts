import { safeMediaUrl } from './media';

export type SearchSource = { title: string; url: string; description?: string; imageUrl?: string };
export type SearchSources = {
  id: string;
  query: string;
  retrievedAt: string;
  sources: SearchSource[];
};
export function linkLabel(url: string) {
  const u = new URL(url);
  if (/^(www\.)?amazon\.(com|co\.uk|ca|de|fr|it|es|co\.jp|com\.au|in)$/.test(u.hostname))
    return u.pathname === '/s' ? 'Search on Amazon' : 'View on Amazon';
  if (/^(www\.|m\.)?(youtube\.com|youtu\.be)$/.test(u.hostname)) return 'Watch video';
  if (/\.pdf$/i.test(u.pathname)) return 'Read document';
  return 'Visit website';
}
export function parseSearchSources(value: unknown): SearchSources | null {
  if (!value || typeof value !== 'object') return null;
  const x = value as Partial<SearchSources>;
  if (
    typeof x.id !== 'string' ||
    !x.id ||
    x.id.length > 100 ||
    typeof x.query !== 'string' ||
    x.query.length > 500 ||
    typeof x.retrievedAt !== 'string' ||
    !Number.isFinite(Date.parse(x.retrievedAt)) ||
    !Array.isArray(x.sources)
  )
    return null;
  const sources: SearchSource[] = [];
  const seen = new Set<string>();
  for (const source of x.sources.slice(0, 10)) {
    if (
      typeof source?.title !== 'string' ||
      !source.title ||
      source.title.length > 200 ||
      !safeMediaUrl(source.url) ||
      seen.has(source.url)
    )
      continue;
    seen.add(source.url);
    sources.push({
      title: source.title,
      url: source.url,
      description:
        typeof source.description === 'string' ? source.description.slice(0, 300) : undefined,
      imageUrl: safeMediaUrl(source.imageUrl) ? source.imageUrl : undefined,
    });
  }
  return sources.length ? { id: x.id, query: x.query, retrievedAt: x.retrievedAt, sources } : null;
}
