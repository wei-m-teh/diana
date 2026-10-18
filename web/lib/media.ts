export type MediaCard = {
  id: string;
  room: string;
  kind: 'image' | 'video' | 'document';
  origin: 'web' | 'uploaded' | 'generated';
  status: 'processing' | 'ready' | 'error';
  title: string;
  assetId?: string;
  url?: string;
  sourceUrl?: string;
  attribution?: string;
  preview?: string;
  message?: string;
};
export function safeMediaUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const u = new URL(value);
    const h = u.hostname.toLowerCase();
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === '443') &&
      h.includes('.') &&
      !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) &&
      !h.endsWith('.local') &&
      !h.endsWith('.internal')
    );
  } catch {
    return false;
  }
}
export function parseMediaCard(value: unknown, room: string): MediaCard | null {
  if (!value || typeof value !== 'object') return null;
  const x = value as MediaCard;
  if (
    x.room !== room ||
    typeof x.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(x.id) ||
    typeof x.title !== 'string' ||
    !x.title ||
    x.title.length > 150 ||
    !['image', 'video', 'document'].includes(x.kind) ||
    !['web', 'uploaded', 'generated'].includes(x.origin) ||
    !['processing', 'ready', 'error'].includes(x.status)
  )
    return null;
  if (
    (x.url !== undefined && !safeMediaUrl(x.url)) ||
    (x.sourceUrl !== undefined && !safeMediaUrl(x.sourceUrl))
  )
    return null;
  if (
    x.assetId !== undefined &&
    (typeof x.assetId !== 'string' || !/^[a-f0-9-]{36}$/.test(x.assetId))
  )
    return null;
  if (x.status === 'ready' && !x.url && !x.assetId) return null;
  for (const k of ['preview', 'attribution', 'message'] as const)
    if (
      x[k] !== undefined &&
      (typeof x[k] !== 'string' || x[k]!.length > (k === 'preview' ? 6000 : 500))
    )
      return null;
  return {
    id: x.id,
    room: x.room,
    kind: x.kind,
    origin: x.origin,
    status: x.status,
    title: x.title,
    assetId: x.assetId,
    url: x.url,
    sourceUrl: x.sourceUrl,
    attribution: x.attribution,
    preview: x.preview,
    message: x.message,
  };
}
export function youtubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    let id: string | null = null;
    if (
      ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(u.hostname) &&
      u.pathname === '/watch'
    )
      id = u.searchParams.get('v');
    if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
    return id && /^[\w-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  } catch {
    return null;
  }
}
