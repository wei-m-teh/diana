'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowDown, ExternalLink, Globe } from 'lucide-react';
import { type ReceivedMessage } from '@livekit/components-react';
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message';
import { type SearchSource, type SearchSources, linkLabel } from '@/lib/search-sources';
import { useSearchSources } from './conversation-context';
import { MediaPanel } from './media';

function ResultLink({ source }: { source: SearchSource }) {
  const [failed, setFailed] = useState(false);
  const domain = new URL(source.url).hostname.replace(/^www\./, '');
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-muted/20 hover:bg-muted/50 focus-visible:ring-ring flex gap-3 rounded-xl border p-3 transition-colors focus-visible:ring-2"
      aria-label={`${source.title} — ${domain} (opens in a new tab)`}
    >
      {source.imageUrl && !failed ? (
        <img
          src={source.imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-20 w-20 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span
          className="bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-lg"
          aria-hidden
        >
          <Globe className="size-5" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground truncate text-xs">{domain}</p>
        <h3 className="mt-1 line-clamp-2 font-medium break-words">{source.title}</h3>
        {source.description && (
          <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">{source.description}</p>
        )}
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium">
          {linkLabel(source.url)}
          <ExternalLink className="size-3" aria-hidden />
        </span>
      </div>
    </a>
  );
}
export function SearchResultGroup({ result }: { result: SearchSources }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label={`Results for ${result.query}`} className="space-y-3">
      <div>
        <h2 className="font-semibold break-words">{result.query}</h2>
        <p className="text-muted-foreground text-xs">
          Web results · checked{' '}
          {new Date(result.retrievedAt).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </p>
      </div>
      <div className="grid gap-2">
        {result.sources.slice(0, expanded ? 10 : 3).map((source) => (
          <ResultLink key={source.url} source={source} />
        ))}
      </div>
      {result.sources.length > 3 && (
        <button
          type="button"
          className="min-h-11 rounded-lg border px-3 text-sm"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show fewer results' : `Show ${result.sources.length - 3} more results`}
        </button>
      )}
    </section>
  );
}

function Timeline({
  messages,
  media,
  visible,
  showTranscript,
}: {
  messages: ReceivedMessage[];
  media: { id: string; revision: string; content: ReactNode }[];
  visible: boolean;
  showTranscript: boolean;
}) {
  const results = useSearchSources();
  const viewport = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const received = useRef(new Map<string, number>());
  const [unread, setUnread] = useState(false);
  const time = (id: string) => {
    if (!received.current.has(id)) received.current.set(id, Date.now());
    return received.current.get(id)!;
  };
  const entries = [
    ...messages.map((m) => ({
      id: `message-${m.id}`,
      time: m.timestamp,
      content: (
        <Message from={m.from?.isLocal ? 'user' : 'assistant'}>
          <MessageContent>
            <MessageResponse>{m.message}</MessageResponse>
          </MessageContent>
        </Message>
      ),
    })),
    ...media.map((m) => ({ id: `media-${m.id}`, time: time(`media-${m.id}`), content: m.content })),
    ...results.map((r) => ({
      id: `result-${r.id}`,
      time: time(`result-${r.id}`),
      content: <SearchResultGroup result={r} />,
    })),
  ].sort((a, b) => a.time - b.time);
  const updateKey =
    messages.map((m) => `${m.id}:${m.message}`).join('|') +
    JSON.stringify(results) +
    media.map((m) => `${m.id}:${m.revision}`).join('|');
  useEffect(() => {
    if (following.current && visible && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
    else setUnread(true);
  }, [updateKey, visible]);
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (following.current && viewport.current)
        viewport.current.scrollTop = viewport.current.scrollHeight;
    });
    if (body.current) observer.observe(body.current);
    return () => observer.disconnect();
  }, []);
  function latest() {
    following.current = true;
    setUnread(false);
    if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }
  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={viewport}
        role="region"
        aria-label="Conversation"
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:auto]"
        onScroll={() => {
          const el = viewport.current;
          if (!el) return;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
          if (following.current) setUnread(false);
        }}
      >
        <div ref={body} className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-5 md:px-6">
          {!entries.length && (
            <p className="text-muted-foreground py-12 text-center">
              {showTranscript
                ? 'Your conversation will appear here.'
                : 'Links, images, videos and documents Diana shares will appear here.'}
            </p>
          )}
          {entries.map((e) => (
            <div key={e.id} data-conversation-item={e.id}>
              {e.content}
            </div>
          ))}
        </div>
      </div>
      {unread && (
        <button
          type="button"
          onClick={latest}
          className="bg-background absolute bottom-3 left-1/2 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full border px-4 text-sm whitespace-nowrap shadow-lg"
        >
          {showTranscript ? 'New results / messages' : 'New results'}{' '}
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
}
export function ConversationResults({
  messages,
  visible,
  showTranscript,
}: {
  messages: ReceivedMessage[];
  visible: boolean;
  showTranscript: boolean;
}) {
  return (
    <MediaPanel>
      {(items) => (
        <Timeline
          messages={messages}
          media={items}
          visible={visible}
          showTranscript={showTranscript}
        />
      )}
    </MediaPanel>
  );
}
