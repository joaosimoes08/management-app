import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, Rack } from '../../types';
import { RACK_VIEW_STORAGE_KEY } from '../../utils';
import { RackDetail } from './rack-detail';

class TestResizeObserver { observe() {} disconnect() {} unobserve() {} }
vi.mock('./rack-device-zoom', () => ({ RackDeviceZoom: () => null }));
vi.mock('../asset-image', () => ({ AssetImage: ({ alt }: { alt: string }) => <img alt={alt} /> }));

const originalWidth = window.innerWidth;
function setViewport(width: number) { Object.defineProperty(window, 'innerWidth', { configurable: true, value: width }); }

beforeEach(() => { vi.stubGlobal('ResizeObserver', TestResizeObserver); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); setViewport(originalWidth); sessionStorage.clear(); });

const rack: Rack = {
  id: 'rack-a', name: 'Core cabinet', roomId: 'room-1', units: 42,
  devices: [{
    id: 'device-1', name: 'Edge switch', type: 'SWITCH', status: 'ACTIVE', rackId: 'rack-a', rackUnitStart: 20, rackUnitSize: 1,
    model: { id: 'model-1', manufacturer: 'Acme', model: 'S1', frontAsset: { id: 'front-1', filename: 'front.png', mimeType: 'image/png' } },
  } as Device],
};

const renderRack = () => render(<RackDetail rack={rack} onOut={vi.fn()} onDevice={vi.fn()} canEdit onPreviewPlacement={vi.fn()} onPlaceDevice={vi.fn()} onEditDevice={vi.fn()} />);
const faces = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.rack-face')].map((face) => face.dataset.face);

describe('RackDetail front and rear views', () => {
  it('shows both faces side by side by default on wide screens', () => {
    setViewport(1920);
    const { container } = renderRack();
    const toggle = screen.getByRole('radiogroup', { name: 'Face do bastidor' });
    expect(within(toggle).getByRole('radio', { name: 'Ambas' })).toHaveAttribute('aria-checked', 'true');
    expect(faces(container)).toEqual(['front', 'rear']);
    expect(screen.getByAltText('Bastidor Core cabinet, frente')).toBeInTheDocument();
    expect(screen.getByAltText('Bastidor Core cabinet, traseira')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-face="front"] .rack-overlay, [data-face="rear"] .rack-overlay')).toHaveLength(2);
  });

  it('shows one face below 1280px and hides the both option', () => {
    setViewport(1024);
    const { container } = renderRack();
    expect(screen.queryByRole('radio', { name: 'Ambas' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Frente' })).toHaveAttribute('aria-checked', 'true');
    expect(faces(container)).toEqual(['front']);
  });

  it('switches face with the keyboard and remembers the choice for the session', () => {
    setViewport(1920);
    const first = renderRack();
    const front = screen.getByRole('radio', { name: 'Frente' });
    fireEvent.click(front);
    expect(faces(first.container)).toEqual(['front']);
    fireEvent.keyDown(front, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Traseira' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Traseira' })).toHaveFocus();
    expect(faces(first.container)).toEqual(['rear']);
    expect(sessionStorage.getItem(RACK_VIEW_STORAGE_KEY)).toBe('rear');
    first.unmount();
    const second = renderRack();
    expect(faces(second.container)).toEqual(['rear']);
  });

  it('falls back to the type icon with a missing-image label on the face without an image', () => {
    setViewport(1920);
    const { container } = renderRack();
    const front = container.querySelector('[data-face="front"] .rack-overlay') as HTMLElement;
    const rear = container.querySelector('[data-face="rear"] .rack-overlay') as HTMLElement;
    expect(front.querySelector('.rack-device-media-missing')).toBeNull();
    expect(within(front).getByAltText('Vista frontal de Edge switch')).toBeInTheDocument();
    expect(rear.querySelector('.rack-device-media-missing')).not.toBeNull();
    expect(rear.querySelector('.rack-device-missing-face')).toHaveTextContent('Sem imagem traseira');
  });
});
