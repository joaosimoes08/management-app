import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiTokenProvider } from '@/lib/api/client';
import { openOperationalStreamCount, useOperationalEvents } from './use-operational-events';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ authenticated: true }) }));
vi.mock('@/lib/runtime-config', () => ({ getPublicRuntimeConfig: () => ({ apiUrl: 'http://api' }) }));

let push: (text: string) => void;
let drop: () => void;
const fetchMock = vi.fn();
const authorizationOf = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>).Authorization;

beforeEach(() => {
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (text) => controller.enqueue(new TextEncoder().encode(text));
        drop = () => controller.close();
        init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  setApiTokenProvider(async () => 'token');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); fetchMock.mockReset(); setApiTokenProvider(null); });

function Subscriber({ onEvent }: { onEvent: (name: string) => void }) {
  useOperationalEvents({ onEvent: (event) => onEvent(event.event) });
  return null;
}

describe('useOperationalEvents', () => {
  it('shares one stream between subscribers and closes it when the last one leaves', async () => {
    const first = vi.fn(); const second = vi.fn();
    const view = render(<><Subscriber onEvent={first} /><Subscriber onEvent={second} /></>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('http://api/api/v1/operations/events', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token', Accept: 'text/event-stream' }), cache: 'no-store' }));
    await act(async () => { push('event: alert.upserted\ndata: {"alertId":"a"}\n\n'); await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(first).toHaveBeenCalledWith('alert.upserted');
    expect(second).toHaveBeenCalledWith('alert.upserted');
    expect(openOperationalStreamCount()).toBe(1);
    view.unmount();
    expect(openOperationalStreamCount()).toBe(0);
  });

  it('reconnects with the fresh token after the token was refreshed while the stream was open', async () => {
    // Run the 5 s reconnect delay at once; every other timer keeps its delay.
    const realSetTimeout = window.setTimeout.bind(window);
    vi.spyOn(window, 'setTimeout').mockImplementation(((handler: () => void, delay?: number) => realSetTimeout(handler, delay === 5_000 ? 0 : delay)) as typeof window.setTimeout);
    let current = 'token-A';
    setApiTokenProvider(async () => current);
    const onEvent = vi.fn();
    const view = render(<Subscriber onEvent={onEvent} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(authorizationOf(fetchMock.mock.calls[0])).toBe('Bearer token-A');

    // Token A expires and the provider now hands out B; the open stream is not torn down for it.
    current = 'token-B';
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The server drops the stream: the reconnect must ask for a token again and send B.
    await act(async () => { drop(); await new Promise((resolve) => setTimeout(resolve, 10)); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(authorizationOf(fetchMock.mock.calls[1])).toBe('Bearer token-B');
    expect(openOperationalStreamCount()).toBe(1);
    view.unmount();
    expect(openOperationalStreamCount()).toBe(0);
  });
});
