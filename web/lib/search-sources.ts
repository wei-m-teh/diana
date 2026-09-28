export type SearchSources = {
  id: string;
  query: string;
  retrievedAt: string;
  sources: { title: string; url: string }[];
};
export function parseSearchSources(value: unknown): SearchSources | null {
  if (!value || typeof value !== 'object') return null;
  const x = value as Partial<SearchSources>;
  if (
    typeof x.id !== 'string' ||
    x.id.length > 100 ||
    typeof x.query !== 'string' ||
    x.query.length > 500 ||
    typeof x.retrievedAt !== 'string' ||
    !Array.isArray(x.sources)
  )
    return null;
  const sources = x.sources.slice(0, 3).filter((source) => {
    if (
      typeof source?.title !== 'string' ||
      source.title.length > 200 ||
      typeof source.url !== 'string' ||
      source.url.length > 2048
    )
      return false;
    try {
      const u = new URL(source.url);
      return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
    } catch {
      return false;
    }
  });
  return sources.length ? { id: x.id, query: x.query, retrievedAt: x.retrievedAt, sources } : null;
}
