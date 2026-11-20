import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, Rack } from '../../types';
import { RACK_VIEW_STORAGE_KEY } from '../../utils';
import { RackDetail } from './rack-detail';

class TestResizeObserver { observe() {} disconnect() {} unobserve() {} }
vi.mock('./rack-device-zoom', () => ({ RackDeviceZoom: ({ deviceId, face }: { deviceId: string; face: string }) => <div data-testid="device-focus" data-device={deviceId} data-face={face} /> }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../asset-image', () => ({ AssetImage: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }));

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
    const picker = screen.getByRole('combobox', { name: 'rack.view' }) as HTMLSelectElement;
    expect(picker.value).toBe('both');
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['rack.view.front', 'rack.view.rear', 'rack.view.both']);
    expect(faces(container)).toEqual(['front', 'rear']);
    expect(screen.getByRole('img', { name: 'Bastidor Core cabinet, frente' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Bastidor Core cabinet, traseira' })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-face="front"] .rack-overlay, [data-face="rear"] .rack-overlay')).toHaveLength(2);
  });

  it('shows one face below 1280px and hides the both option', () => {
    setViewport(1024);
    const { container } = renderRack();
    const picker = screen.getByRole('combobox', { name: 'rack.view' }) as HTMLSelectElement;
    expect(within(picker).queryByRole('option', { name: 'rack.view.both' })).not.toBeInTheDocument();
    expect(picker.value).toBe('front');
    expect(faces(container)).toEqual(['front']);
  });

  it('switches face from the view picker and remembers the choice for the session', () => {
    setViewport(1920);
    const first = renderRack();
    const picker = screen.getByRole('combobox', { name: 'rack.view' });
    fireEvent.change(picker, { target: { value: 'front' } });
    expect(faces(first.container)).toEqual(['front']);
    fireEvent.change(picker, { target: { value: 'rear' } });
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
    expect(within(front).getByRole('img', { name: 'Vista frontal de Edge switch' })).toBeInTheDocument();
    expect(rear.querySelector('.rack-device-media-missing')).not.toBeNull();
    expect(rear.querySelector('.rack-device-missing-face')).toHaveTextContent('Sem imagem traseira');
  });
});

describe('RackDetail device focus face', () => {
  const openDevice = (container: HTMLElement, face: 'front' | 'rear') => fireEvent.click(container.querySelector(`[data-face="${face}"] .rack-overlay`) as HTMLElement);
  const focus = () => screen.getByTestId('device-focus');

  it('in Both, shows the face the device was clicked on', () => {
    setViewport(1920);
    const { container } = renderRack();
    openDevice(container, 'rear');
    expect(focus()).toHaveAttribute('data-device', 'device-1');
    expect(focus()).toHaveAttribute('data-face', 'rear');
  });

  it('follows the utility-bar view when it changes while the device is focused', () => {
    setViewport(1920);
    const { container } = renderRack();
    openDevice(container, 'rear');
    const picker = screen.getByRole('combobox', { name: 'rack.view' });
    fireEvent.change(picker, { target: { value: 'front' } });
    expect(focus()).toHaveAttribute('data-face', 'front');
    fireEvent.change(picker, { target: { value: 'rear' } });
    expect(focus()).toHaveAttribute('data-face', 'rear');
    fireEvent.change(picker, { target: { value: 'both' } });
    expect(focus()).toHaveAttribute('data-face', 'rear');
  });

  it('in Front or Rear, shows that face', () => {
    setViewport(1920);
    sessionStorage.setItem(RACK_VIEW_STORAGE_KEY, 'rear');
    const { container } = renderRack();
    openDevice(container, 'rear');
    expect(focus()).toHaveAttribute('data-face', 'rear');
  });
});
