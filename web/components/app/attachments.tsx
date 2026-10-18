'use client';

import { useEffect, useRef, useState } from 'react';
import { ParticipantKind, RoomEvent } from 'livekit-client';
import { useSessionContext } from '@livekit/components-react';
import { accessToken, authentication } from '@/lib/cognito-auth';

type Item = { id: string; name: string; state: string; message: string };
const accept = '.jpg,.jpeg,.png,.webp,.pdf,.txt,.md,.docx,.mp4,.webm,.mov';
const mime: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};
export function Attachments() {
  const { room, isConnected } = useSessionContext();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const working = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const receive = (
      data: Uint8Array,
      participant: { kind: ParticipantKind } | undefined,
      _kind: unknown,
      topic?: string
    ) => {
      if (
        topic !== 'diana.attachment' ||
        participant?.kind !== ParticipantKind.AGENT ||
        data.length > 1024
      )
        return;
      try {
        const value = JSON.parse(new TextDecoder().decode(data));
        if (['processing', 'ready', 'error'].includes(value.state))
          setItems((previous) =>
            previous.map((item) => (item.id === value.id ? { ...item, state: value.state } : item))
          );
      } catch {
        /* Ignore malformed status messages. */
      }
    };
    room.on(RoomEvent.DataReceived, receive);
    return () => {
      mounted.current = false;
      abort.current?.abort();
      room.off(RoomEvent.DataReceived, receive);
    };
  }, [room]);

  async function upload(file: File) {
    if (working.current || !isConnected) return;
    const type = mime[file.name.split('.').pop()?.toLowerCase() ?? ''];
    if (!type || file.size < 1 || file.size > (type.startsWith('video/') ? 60 : 20) * 1024 * 1024) {
      setError('Choose a supported file: up to 20 MB, or 60 MB for videos.');
      return;
    }
    working.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 180000);
    const name = room.name;
    try {
      const { config } = await authentication();
      const endpoint = new URL(config.tokenEndpoint);
      endpoint.pathname = endpoint.pathname.replace(/\/sessions$/, '/attachments');
      endpoint.search = '';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ room: name, name: file.name, type, size: file.size }),
        signal: controller.signal,
        credentials: 'omit',
      });
      if (!response.ok)
        throw new Error(
          response.status === 403
            ? 'Sign in again, or start a new conversation if you reached the ten-file limit.'
            : 'Unable to prepare this upload. Please try again.'
        );
      const signed = await response.json();
      const form = new FormData();
      Object.entries(signed.fields as Record<string, string>).forEach(([key, value]) =>
        form.append(key, value)
      );
      form.append('file', file);
      const uploaded = await fetch(signed.url, {
        method: 'POST',
        body: form,
        signal: controller.signal,
        credentials: 'omit',
      });
      if (!uploaded.ok) throw new Error('Upload failed. Please try again.');
      if (!mounted.current || room.name !== name || controller.signal.aborted) return;
      const message = `I shared an attachment (ID: ${signed.id}; filename: ${JSON.stringify(file.name)}). ${question.trim() || 'Please look at it and share your thoughts.'}`;
      setItems((previous) =>
        [...previous, { id: signed.id, name: file.name, state: 'uploaded', message }].slice(-10)
      );
      try {
        await room.localParticipant.sendText(message, { topic: 'lk.chat' });
      } catch {
        setError('The file uploaded, but Diana was not notified. Use “Ask again” below.');
      }
      setQuestion('');
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error && e.name !== 'AbortError'
            ? e.message
            : 'Upload cancelled or timed out. Please try again.'
        );
    } finally {
      clearTimeout(timer);
      working.current = false;
      if (mounted.current) setBusy(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <div className="mb-2 text-sm">
      <button
        type="button"
        className="rounded-lg border px-3 py-2"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        Share a file
      </button>
      {open && (
        <div className="bg-background mt-2 max-h-60 space-y-2 overflow-y-auto rounded-lg border p-3">
          <p>
            Images, PDF, Word, text, or videos up to two minutes. Files: 20 MB; videos: 60 MB. Up to
            ten uploads per conversation.
          </p>
          <p className="text-muted-foreground text-xs">
            Files are private to this conversation and scheduled for deletion after one day. Content
            is sent to Diana’s AI providers for analysis. Video uses sampled frames and an audio
            transcript; scanned PDFs need page images.
          </p>
          <label className="block">
            What would you like Diana to look at?
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={1000}
              className="mt-1 w-full rounded border bg-transparent p-2"
              placeholder="Optional question or feedback request"
              disabled={busy}
            />
          </label>
          <input
            ref={input}
            type="file"
            accept={accept}
            disabled={busy || !isConnected}
            aria-label="Choose an attachment"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          {busy && (
            <p role="status">
              Uploading…{' '}
              <button type="button" className="underline" onClick={() => abort.current?.abort()}>
                Cancel
              </button>
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <ul aria-live="polite" className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="break-words">
                {item.name} —{' '}
                {
                  {
                    uploaded: 'Uploaded; waiting for Diana',
                    processing: 'Diana is looking at it…',
                    ready: 'Ready to discuss',
                    error: 'Analysis failed',
                  }[item.state]
                }
                {item.state !== 'processing' && (
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => {
                      void room.localParticipant
                        .sendText(item.message, { topic: 'lk.chat' })
                        .catch(() => setError('Unable to notify Diana. Please try again.'));
                    }}
                  >
                    Ask again
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
