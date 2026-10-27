'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { parseSseChunk, pubSubAvailability, type OperationEvent } from './sse';

type Options<T> = { url?: string; fallback?: (signal?: AbortSignal) => Promise<T>; onEvent?: (event: OperationEvent) => void; intervalMs?: number };
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function useOperationalEvents<T>({ url = '/api/v1/operations/events', fallback, onEvent, intervalMs = 30_000 }: Options<T>) {
  const { token } = useAuth();
  const [data, setData] = useState<T | undefined>(); const [connected, setConnected] = useState(false); const [error, setError] = useState<Error | null>(null);
  const onEventRef = useRef(onEvent); onEventRef.current = onEvent;
  const fallbackRef = useRef(fallback); fallbackRef.current = fallback;
  useEffect(() => {
    if (!token) return;
    let disposed = false; let timer: number | undefined; let reconnectTimer: number | undefined; let polling = false; const controller = new AbortController();
    const poll = async () => { if (!fallbackRef.current || disposed || polling) return; polling = true; try { setData(await fallbackRef.current(controller.signal)); setError(null); } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason : new Error('Falha ao atualizar operações.')); } finally { polling = false; } };
    const startPolling = () => { if (timer === undefined) { void poll(); timer = window.setInterval(() => void poll(), intervalMs); } };
    const stopPolling = () => { if (timer !== undefined) { window.clearInterval(timer); timer = undefined; } };
    const reconnect = () => { if (!disposed && reconnectTimer === undefined) reconnectTimer = window.setTimeout(() => { reconnectTimer = undefined; void connect(); }, 5_000); };
    const connect = async () => {
      let response: Response;
      try { response = await fetch(`${apiUrl}${url}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, cache: 'no-store', signal: controller.signal }); if (!response.ok || !response.body) throw new Error(`SSE indisponível (${response.status})`); }
      catch (reason) { if (!disposed && !controller.signal.aborted) { setConnected(false); setError(reason instanceof Error ? reason : new Error('SSE indisponível.')); startPolling(); reconnect(); } return; }
      if (disposed) return; setConnected(true); setError(null); stopPolling();
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      try { while (!disposed) { const chunk = await reader.read(); if (chunk.done) throw new Error('SSE desligado.'); buffer += decoder.decode(chunk.value, { stream: true }); const records = buffer.split(/\r?\n\r?\n/); buffer = records.pop() ?? ''; records.flatMap(parseSseChunk).forEach((event) => {
        const available = pubSubAvailability({ event: event.event, data: event.data });
        if (available !== undefined) {
          if (available) { setConnected(true); stopPolling(); }
          else { setConnected(false); startPolling(); }
        }
        onEventRef.current?.(event);
      }); } }
      catch (reason) { if (!disposed && !controller.signal.aborted) { setConnected(false); setError(reason instanceof Error ? reason : new Error('SSE desligado.')); startPolling(); reconnect(); } }
      finally { reader.releaseLock(); }
    };
    void connect();
    return () => { disposed = true; controller.abort(); stopPolling(); if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer); };
  }, [token, url, intervalMs]);
  return { data, connected, error };
}
