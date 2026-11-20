import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetImage, clearAssetBlobCache, loadAssetBlob } from './asset-image';

let token = 'token-1';
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ token }) }));

const asset = { id: 'asset-1', filename: 'front.png', mimeType: 'image/png' } as never;
const okResponse = () => ({ ok: true, blob: async () => new Blob(['png'], { type: 'image/png' }) });

beforeEach(() => {
  token = 'token-1';
  clearAssetBlobCache();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:asset'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('AssetImage download cache (D4)', () => {
  it('downloads an asset once for every image that shows it', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    render(<>{Array.from({ length: 12 }, (_, index) => <AssetImage key={index} asset={asset} alt={`device ${index}`} />)}</>);
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(12));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([expect.stringContaining('/api/v1/assets/asset-1/file'), { headers: { Authorization: 'Bearer token-1' } }]);
  });

  it('does not download again when the token is refreshed', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<AssetImage asset={asset} alt="front" />);
    await screen.findByRole('img');
    token = 'token-2';
    view.rerender(<AssetImage asset={asset} alt="front" />);
    await screen.findByRole('img');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed download so a later render retries it', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 }).mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadAssetBlob(asset, 'token-1')).rejects.toThrow('Asset indisponível');
    await expect(loadAssetBlob(asset, 'token-1')).resolves.toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
