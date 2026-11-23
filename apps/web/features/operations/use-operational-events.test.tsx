import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openOperationalStreamCount, useOperationalEvents } from './use-operational-events';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('@/lib/runtime-config', () => ({ getPublicRuntimeConfig: () => ({ apiUrl: 'http://api' }) }));

let push: (text: string) => void;
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockImplementation((_url: string, init: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (text) => controller.enqueue(new TextEncoder().encode(text));
        init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetchMock.mockReset(); });

function Subscriber({ onEvent }: { onEvent: (name: string) => void }) {
  useOperationalEvents({ onEvent: (event) => onEvent(event.event) });
  return null;
}

describe('useOperationalEvents', () => {
  it('shares one stream between subscribers and closes it when the last one leaves', async () => {
    const first = vi.fn(); const second = vi.fn();
    const view = render(<><Subscriber onEvent={first} /><Subscriber onEvent={second} /></>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('http://api/api/v1/operations/events', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token' }) }));
    await act(async () => { push('event: alert.upserted\ndata: {"alertId":"a"}\n\n'); await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(first).toHaveBeenCalledWith('alert.upserted');
    expect(second).toHaveBeenCalledWith('alert.upserted');
    expect(openOperationalStreamCount()).toBe(1);
    view.unmount();
    expect(openOperationalStreamCount()).toBe(0);
  });
});
