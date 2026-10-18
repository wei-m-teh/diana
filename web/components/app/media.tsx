'use client';

import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from 'react';
import { ParticipantKind, RoomEvent } from 'livekit-client';
import { useSessionContext } from '@livekit/components-react';
import * as Dialog from '@radix-ui/react-dialog';
import { accessToken, authentication } from '@/lib/cognito-auth';
import { type MediaCard, parseMediaCard, safeMediaUrl, youtubeEmbed } from '@/lib/media';

const MediaContext = createContext({
  cards: [] as MediaCard[],
  videoOpen: false,
  setVideoOpen: (_value: boolean) => {},
});
export const useMedia = () => useContext(MediaContext);
export function MediaProvider({ children }: { children: ReactNode }) {
  const { room } = useSessionContext();
  const [cards, setCards] = useState<MediaCard[]>([]);
  const [videoOpen, setVideoOpen] = useState(false);
  useEffect(() => {
    const receive = (
      data: Uint8Array,
      participant: { kind: ParticipantKind } | undefined,
      _kind: unknown,
      topic?: string
    ) => {
      if (
        topic !== 'diana.media' ||
        participant?.kind !== ParticipantKind.AGENT ||
        data.length > 16000
      )
        return;
      try {
        const card = parseMediaCard(JSON.parse(new TextDecoder().decode(data)), room.name);
        if (card) setCards((old) => [...old.filter((x) => x.id !== card.id), card].slice(-30));
      } catch {
        /* Invalid messages are ignored. */
      }
    };
    room.on(RoomEvent.DataReceived, receive);
    return () => {
      room.off(RoomEvent.DataReceived, receive);
    };
  }, [room]);
  useEffect(() => {
    const publish = () => {
      if (room.state !== 'connected') return;
      void room.localParticipant
        .publishData(new TextEncoder().encode(JSON.stringify({ playing: videoOpen })), {
          reliable: true,
          topic: 'diana.media-playback',
        })
        .catch(() => {});
    };
    publish();
    room.on(RoomEvent.Connected, publish);
    room.on(RoomEvent.Reconnected, publish);
    return () => {
      room.off(RoomEvent.Connected, publish);
      room.off(RoomEvent.Reconnected, publish);
    };
  }, [room, videoOpen]);
  return (
    <MediaContext.Provider value={{ cards, videoOpen, setVideoOpen }}>
      {children}
    </MediaContext.Provider>
  );
}
async function resolveMedia(card: Pick<MediaCard, 'assetId' | 'url'>, room: string) {
  let result = { url: card.url ?? '', downloadUrl: card.url ?? '', type: '' };
  if (card.assetId) {
    const { config } = await authentication();
    const endpoint = new URL(config.tokenEndpoint);
    endpoint.pathname = endpoint.pathname.replace(/\/sessions$/, '/media');
    endpoint.search = '';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ room: room, id: card.assetId }),
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('This file may have expired. Ask Diana to share it again.');
    result = await response.json();
  }
  if (!safeMediaUrl(result.url) || !safeMediaUrl(result.downloadUrl))
    throw Error('This media link is unavailable.');
  return result;
}

function InlineImage({
  card,
  room,
  onOpen,
}: {
  card: MediaCard;
  room: string;
  onOpen: () => void;
}) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  const { assetId, url: sourceUrl } = card;
  useEffect(() => {
    let active = true;
    setUrl(undefined);
    setFailed(false);
    void resolveMedia({ assetId, url: sourceUrl }, room).then(
      (result) => {
        if (active) setUrl(result.url);
      },
      () => {
        if (active) setFailed(true);
      }
    );
    return () => {
      active = false;
    };
  }, [assetId, sourceUrl, room]);
  return url && !failed ? (
    <button
      type="button"
      onClick={onOpen}
      className="mt-2 block w-full"
      aria-label={`Expand ${card.title}`}
    >
      <img
        src={url}
        alt={card.title}
        referrerPolicy="no-referrer"
        className="max-h-48 w-full rounded object-contain"
        onError={() => setFailed(true)}
      />
    </button>
  ) : (
    <p className="text-muted-foreground text-xs">
      {failed ? 'Preview unavailable. Open the image to retry.' : 'Loading image…'}
    </p>
  );
}

export function MediaPanel({
  children,
}: {
  children?: (items: { id: string; revision: string; content: ReactNode }[]) => ReactNode;
}) {
  const { cards, setVideoOpen } = useMedia();
  const { room } = useSessionContext();
  const [selected, setSelected] = useState<MediaCard | null>(null);
  const [link, setLink] = useState<{ url: string; downloadUrl: string; type?: string } | null>(
    null
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
      setVideoOpen(false);
    },
    [setVideoOpen]
  );
  async function show(card: MediaCard) {
    const current = ++request.current;
    setSelected(card);
    setLink(null);
    setError('');
    setLoading(true);
    setVideoOpen(false);
    try {
      const result = await resolveMedia(card, room.name);
      if (current === request.current) {
        setLink(result);
        setVideoOpen(card.kind === 'video');
      }
    } catch (e) {
      if (current === request.current)
        setError(e instanceof Error ? e.message : 'Unable to open media.');
    } finally {
      if (current === request.current) setLoading(false);
    }
  }
  function close() {
    request.current++;
    setSelected(null);
    setLink(null);
    setVideoOpen(false);
    setError('');
  }
  const embed = link ? youtubeEmbed(link.url) : null;
  const nativeVideo = !!selected?.assetId || (!!link && /\.(mp4|webm)(\?|$)/i.test(link.url));
  const pdf = link?.type === 'application/pdf' || (!!link && /\.pdf(\?|$)/i.test(link.url));
  function renderCard(card: MediaCard) {
    return (
      <article key={card.id} className="rounded border p-2">
        <strong>{card.title}</strong>
        <p className="text-muted-foreground text-xs">
          {card.origin === 'generated'
            ? 'AI-generated'
            : card.origin === 'uploaded'
              ? 'Your upload'
              : 'Web source'}{' '}
          · {card.kind}
        </p>
        {card.status === 'ready' && card.kind === 'image' && (
          <InlineImage card={card} room={room.name} onOpen={() => void show(card)} />
        )}
        {card.status === 'ready' && card.kind === 'document' && card.preview && (
          <p className="my-2 line-clamp-4 whitespace-pre-wrap">{card.preview}</p>
        )}
        {card.status === 'processing' ? (
          <p role="status">Creating… You can keep talking.</p>
        ) : card.status === 'error' ? (
          <p role="alert">{card.message || 'Unable to create this media.'}</p>
        ) : (
          <button type="button" className="mt-1 underline" onClick={() => void show(card)}>
            Open {card.kind}
          </button>
        )}
        {card.sourceUrl && (
          <a
            href={card.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-3 underline"
          >
            Source
          </a>
        )}
        {card.attribution && <p className="text-xs">{card.attribution}</p>}
      </article>
    );
  }
  return (
    <>
      {children
        ? children(
            cards.map((card) => ({ id: card.id, revision: card.status, content: renderCard(card) }))
          )
        : cards.map(renderCard)}
      <span role="status" className="sr-only">
        {cards.length
          ? `${cards.length} media items shared. Latest: ${cards[cards.length - 1].title}, ${cards[cards.length - 1].status}.`
          : ''}
      </span>
      <Dialog.Root
        open={!!selected}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[190] bg-black/70" />
          <Dialog.Content
            aria-describedby={undefined}
            className="bg-background fixed top-1/2 left-1/2 z-[200] max-h-[85svh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border p-5"
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <Dialog.Title>{selected?.title}</Dialog.Title>
              <Dialog.Close className="rounded border px-3 py-1" aria-label="Close media">
                Close
              </Dialog.Close>
            </div>
            {loading && <p role="status">Opening…</p>}
            {error && (
              <p role="alert">
                {error}{' '}
                <button onClick={() => selected && void show(selected)} className="underline">
                  Retry
                </button>
              </p>
            )}
            {link && selected && (
              <>
                {selected.kind === 'image' && (
                  <img
                    src={link.url}
                    alt={selected.title}
                    className="max-h-[60svh] w-full object-contain"
                    referrerPolicy="no-referrer"
                    onError={() => setError('Image preview unavailable. Try the source link.')}
                  />
                )}
                {selected.kind === 'video' && (
                  <>
                    <p className="text-sm">
                      Diana’s voice and listening are paused while this player is open. Close it to
                      continue.
                    </p>
                    {embed ? (
                      <iframe
                        src={embed}
                        title={selected.title}
                        className="aspect-video w-full"
                        allow="fullscreen; picture-in-picture"
                        referrerPolicy="no-referrer"
                        allowFullScreen
                      />
                    ) : nativeVideo ? (
                      <video
                        src={link.url}
                        controls
                        playsInline
                        preload="metadata"
                        className="max-h-[60svh] w-full"
                        onError={() =>
                          setError('Video playback unavailable. Open the original link below.')
                        }
                      />
                    ) : (
                      <p>This site requires opening the original video link.</p>
                    )}
                  </>
                )}
                {selected.kind === 'document' && (
                  <>
                    {selected.preview && (
                      <pre className="max-h-72 overflow-auto font-sans whitespace-pre-wrap">
                        {selected.preview}
                      </pre>
                    )}
                    {pdf && (
                      <iframe
                        title={selected.title}
                        src={link.url}
                        className="h-[55svh] w-full"
                        sandbox=""
                        referrerPolicy="no-referrer"
                      />
                    )}
                    {!pdf && !selected.preview && (
                      <p>Download this document to open it in your preferred reader.</p>
                    )}
                  </>
                )}
                <a
                  href={link.downloadUrl}
                  onClick={() => {
                    if (selected.kind === 'video') close();
                  }}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {selected.assetId ? 'Download file' : 'Open original'}
                </a>
                {selected.sourceUrl && (
                  <a
                    href={selected.sourceUrl}
                    onClick={() => {
                      if (selected.kind === 'video') close();
                    }}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-4 underline"
                  >
                    Source and attribution
                  </a>
                )}
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
