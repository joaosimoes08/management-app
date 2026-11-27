'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { openOperationalEventStream } from './api';
import { parseSseChunk, pubSubAvailability, type OperationEvent } from './sse';

type StreamState = 'connecting' | 'up' | 'down';
type Listener = { event: (event: OperationEvent) => void; state: (state: StreamState, error: Error | null) => void };
type Stream = { listeners: Set<Listener>; state: StreamState; error: Error | null; controller: AbortController; reconnectTimer?: number; closed: boolean };

/**
 * One event stream per API path, shared by every subscriber on the page (header bell,
 * dashboard cards, /alertas). Browsers allow few connections per origin, so each widget opening
 * its own stream would starve normal requests. Closed when the last subscriber leaves.
 * A token refresh does not reopen the stream: each (re)connect asks the API client for a
 * fresh token, so a reconnect after the stream dropped never reuses an expired one.
 */
const streams = new Map<string, Stream>();

function setState(stream: Stream, state: StreamState, error: Error | null) {
  stream.state = state; stream.error = error;
  for (const listener of [...stream.listeners]) listener.state(state, error);
}

function openStream(path: string): Stream {
  const stream: Stream = { listeners: new Set(), state: 'connecting', error: null, controller: new AbortController(), closed: false };
  const fail = (reason: unknown, fallback: string) => {
    if (stream.closed || stream.controller.signal.aborted) return;
    setState(stream, 'down', reason instanceof Error ? reason : new Error(fallback));
    if (stream.reconnectTimer === undefined) stream.reconnectTimer = window.setTimeout(() => { stream.reconnectTimer = undefined; void connect(); }, 5_000);
  };
  const connect = async () => {
    let response: Awaited<ReturnType<typeof openOperationalEventStream>>;
    try {
      response = await openOperationalEventStream(path, stream.controller.signal);
    } catch (reason) { fail(reason, 'SSE indisponível.'); return; }
    if (stream.closed) return;
    setState(stream, 'up', null);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    try {
      while (!stream.closed) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('SSE desligado.');
        buffer += decoder.decode(chunk.value, { stream: true });
        const records = buffer.split(/\r?\n\r?\n/); buffer = records.pop() ?? '';
        records.flatMap(parseSseChunk).forEach((event) => {
          const available = pubSubAvailability({ event: event.event, data: event.data });
          if (available !== undefined && (available ? stream.state !== 'up' : stream.state !== 'down')) setState(stream, available ? 'up' : 'down', null);
          for (const listener of [...stream.listeners]) listener.event(event);
        });
      }
    } catch (reason) { fail(reason, 'SSE desligado.'); }
    finally { reader.releaseLock(); }
  };
  streams.set(path, stream);
  void connect();
  return stream;
}

function subscribe(path: string, listener: Listener): () => void {
  const stream = streams.get(path) ?? openStream(path);
  stream.listeners.add(listener);
  // A late subscriber learns the current state at once (and starts polling if the stream is down).
  if (stream.state !== 'connecting') listener.state(stream.state, stream.error);
  return () => {
    stream.listeners.delete(listener);
    if (stream.listeners.size) return;
    stream.closed = true; stream.controller.abort();
    if (stream.reconnectTimer !== undefined) window.clearTimeout(stream.reconnectTimer);
    if (streams.get(path) === stream) streams.delete(path);
  };
}

/** Test hook: how many shared streams are open. */
export const openOperationalStreamCount = () => streams.size;

type Options<T> = { url?: string; fallback?: (signal?: AbortSignal) => Promise<T>; onEvent?: (event: OperationEvent) => void; intervalMs?: number };
export function useOperationalEvents<T>({ url = '/api/v1/operations/events', fallback, onEvent, intervalMs = 30_000 }: Options<T>) {
  const { authenticated } = useAuth();
  const [data, setData] = useState<T | undefined>(); const [connected, setConnected] = useState(false); const [error, setError] = useState<Error | null>(null);
  const onEventRef = useRef(onEvent); onEventRef.current = onEvent;
  const fallbackRef = useRef(fallback); fallbackRef.current = fallback;
  useEffect(() => {
    if (!authenticated) return;
    let disposed = false; let timer: number | undefined; let polling = false; const controller = new AbortController();
    // Each subscriber polls its own fallback while the shared stream is down.
    const poll = async () => { if (!fallbackRef.current || disposed || polling) return; polling = true; try { setData(await fallbackRef.current(controller.signal)); setError(null); } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason : new Error('Falha ao atualizar operações.')); } finally { polling = false; } };
    const startPolling = () => { if (timer === undefined) { void poll(); timer = window.setInterval(() => void poll(), intervalMs); } };
    const stopPolling = () => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined; } };
    const unsubscribe = subscribe(url, {
      event: (event) => { if (!disposed) onEventRef.current?.(event); },
      state: (state, reason) => {
        if (disposed) return;
        if (state === 'up') { setConnected(true); setError(null); stopPolling(); }
        else if (state === 'down') { setConnected(false); if (reason) setError(reason); startPolling(); }
      },
    });
    return () => { disposed = true; controller.abort(); stopPolling(); unsubscribe(); };
  }, [authenticated, url, intervalMs]);
  return { data, connected, error };
}
