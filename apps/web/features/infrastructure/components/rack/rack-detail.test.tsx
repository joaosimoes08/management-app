import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RACK_VIEWPORT } from '../../utils';
import type { Rack } from '../../types';
import { RackDetail } from './rack-detail';

let notifyResize: ResizeObserverCallback | undefined;
class TestResizeObserver {
  constructor(callback: ResizeObserverCallback) { notifyResize = callback; }
  observe() {}
  disconnect() {}
  unobserve() {}
}

vi.mock('./rack-device-zoom', () => ({ RackDeviceZoom: () => null }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

beforeEach(() => { vi.stubGlobal('ResizeObserver', TestResizeObserver); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); notifyResize = undefined; });

const rack: Rack = {
  id: 'rack-a', name: 'Core cabinet', roomId: 'room-1', units: 42,
  devices: [{ id: 'device-1', name: 'Edge switch', type: 'SWITCH', status: 'ACTIVE', rackId: 'rack-a', rackUnitStart: 20, rackUnitSize: 2 }],
};

function renderRack() {
  const onPreviewPlacement = vi.fn(async (_deviceId: string, _rackId: string, rackUnitStart: number) => ({
    target: { id: 'device-1', name: 'Edge switch', rackId: 'rack-a', rackUnitStart, rackUnitSize: 2 },
    changes: [{ id: 'device-1', name: 'Edge switch', rackId: 'rack-a', rackUnitStart, rackUnitSize: 2 }],
  }));
  const result = render(<RackDetail rack={rack} onOut={vi.fn()} onDevice={vi.fn()} canEdit onPreviewPlacement={onPreviewPlacement} onPlaceDevice={vi.fn()} onEditDevice={vi.fn()} />);
  const stage = result.container.querySelector('.rack-stage') as HTMLDivElement;
  stage.style.padding = '12px';
  const setSize = (width: number, height: number) => {
    Object.defineProperty(stage, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(stage, 'clientHeight', { configurable: true, value: height });
    act(() => notifyResize?.([], {} as ResizeObserver));
  };
  return { ...result, stage, setSize, onPreviewPlacement };
}

describe('RackDetail viewport fit and interactions', () => {
  it.each([[900, 400], [360, 560]])('fits a 42U rack within %s×%s available pixels', async (width, height) => {
    const { container, setSize } = renderRack();
    setSize(width, height);
    const expectedWidth = Math.min(304, width - 24, (height - 24) * 304 / 838);
    const frame = container.querySelector('.rack-frame') as HTMLDivElement;
    const inner = container.querySelector('.rack-stage-inner') as HTMLDivElement;
    await waitFor(() => expect(parseFloat(frame.style.width)).toBeCloseTo(expectedWidth, 3));
    expect(parseFloat(inner.style.height)).toBeCloseTo(expectedWidth * 838 / 304, 3);
    expect(parseFloat(frame.style.width)).toBeLessThanOrEqual(width - 24);
    expect(parseFloat(inner.style.height)).toBeLessThanOrEqual(height - 24 + 0.001);
  });

  it('keeps the utility-bar tools compact: icon-only View label, no Zoom word, labelled action buttons', () => {
    render(<RackDetail rack={rack} onOut={vi.fn()} onDevice={vi.fn()} canEdit onPreviewPlacement={vi.fn()} onPlaceDevice={vi.fn()} onEditDevice={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const view = screen.getByRole('combobox', { name: 'rack.view' });
    expect(view.closest('label')).toHaveAttribute('title', 'rack.view');
    expect(view.closest('label')?.querySelector('span')).toBeNull();
    const zoom = screen.getByRole('button', { name: 'rack.zoom: 0%' });
    expect(zoom).toHaveAttribute('title', 'rack.zoom');
    expect(zoom).not.toHaveTextContent('rack.zoom');
    for (const name of ['rack.back', 'rack.edit', 'rack.delete']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('title', name);
      expect(button.querySelector('.rack-action-label')).toHaveTextContent(name);
    }
  });

  it('keeps the delete action label, name and tooltip in step while deleting', () => {
    render(<RackDetail rack={rack} onOut={vi.fn()} onDevice={vi.fn()} canEdit onPreviewPlacement={vi.fn()} onPlaceDevice={vi.fn()} onEditDevice={vi.fn()} onDelete={vi.fn()} deleting />);
    const button = screen.getByRole('button', { name: 'rack.deleting' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'rack.deleting');
    expect(button.querySelector('.rack-action-label')).toHaveTextContent('rack.deleting');
  });

  it('maps the 0–100% zoom slider onto the fitted rack and restores the fit', async () => {
    const { container, setSize } = renderRack();
    setSize(900, 400);
    const frame = container.querySelector('.rack-frame') as HTMLDivElement;
    await waitFor(() => expect(parseFloat(frame.style.width)).toBeLessThan(304));
    const fittedWidth = parseFloat(frame.style.width);
    const trigger = screen.getByRole('button', { name: 'rack.zoom: 0%' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const slider = screen.getByRole('slider', { name: 'rack.zoomLevel' });
    expect(slider).toHaveFocus();
    fireEvent.change(slider, { target: { value: '100' } });
    expect(parseFloat(frame.style.width)).toBeCloseTo(fittedWidth * 2.5, 2);
    expect(screen.getByRole('button', { name: 'rack.zoom: 100%' })).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: '50' } });
    expect(parseFloat(frame.style.width)).toBeCloseTo(fittedWidth * 1.75, 2);
    fireEvent.click(screen.getByRole('button', { name: 'rack.zoomFit' }));
    expect(parseFloat(frame.style.width)).toBeCloseTo(fittedWidth, 2);
    expect(screen.getByRole('button', { name: 'rack.zoom: 0%' })).toBeInTheDocument();
  });

  it('maps a drop from the rendered overlay bounds to the corresponding rack unit', async () => {
    const { container, setSize, onPreviewPlacement } = renderRack();
    setSize(900, 400);
    const area = container.querySelector('.rack-overlay-area') as HTMLDivElement;
    const frame = container.querySelector('.rack-frame') as HTMLDivElement;
    const frameHeight = parseFloat(frame.style.width) * 838 / 304;
    const areaTop = 10 + frameHeight * RACK_VIEWPORT.top;
    const areaHeight = frameHeight * RACK_VIEWPORT.height;
    vi.spyOn(area, 'getBoundingClientRect').mockReturnValue({ x: 0, y: areaTop, top: areaTop, bottom: areaTop + areaHeight, left: 0, right: 0, width: 0, height: areaHeight, toJSON: () => ({}) });
    const dataTransfer = { getData: (key: string) => ({ 'application/x-device-id': 'device-1', 'application/x-device-size': '2' }[key] ?? ''), dropEffect: 'none' };
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clientY', { value: areaTop + areaHeight / 2 });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    fireEvent(area, event);
    await waitFor(() => expect(onPreviewPlacement).toHaveBeenCalledWith('device-1', 'rack-a', 20));
  });
});
