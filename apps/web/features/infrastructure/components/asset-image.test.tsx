import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api/errors';
import { setApiTokenProvider } from '@/lib/api/client';
import { AssetImage, clearAssetBlobCache, loadAssetBlob } from './asset-image';

let token = 'token-1';
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ authenticated: true }) }));

const asset = { id: 'asset-1', filename: 'front.png', mimeType: 'image/png' } as never;
const okResponse = () => new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 });

beforeEach(() => {
  token = 'token-1';
  setApiTokenProvider(async () => token);
  clearAssetBlobCache();
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:asset'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setApiTokenProvider(null); });

describe('AssetImage download cache (D4)', () => {
  it('downloads an asset once for every image that shows it, with the API client token', async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
    render(<>{Array.from({ length: 12 }, (_, index) => <AssetImage key={index} asset={asset} alt={`device ${index}`} />)}</>);
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(12));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/assets/asset-1/file'), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer token-1' }) }));
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
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValue(okResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadAssetBlob(asset)).rejects.toBeInstanceOf(ApiRequestError);
    await expect(loadAssetBlob(asset)).resolves.toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('shows the placeholder when the download fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    render(<AssetImage asset={asset} alt="front" />);
    await waitFor(() => expect(screen.getByLabelText('front')).toHaveTextContent('Imagem indisponível'));
    expect(screen.queryByRole('img')).toBeNull();
  });
});
