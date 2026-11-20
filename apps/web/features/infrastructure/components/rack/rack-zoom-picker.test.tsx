import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { percentFromZoom, RACK_ZOOM_MAX, RACK_ZOOM_MIN, RackZoomPicker, zoomFromPercent } from './rack-zoom-picker';

vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
afterEach(() => cleanup());

describe('rack zoom percent mapping', () => {
  it('maps 0% to the fitted rack and 100% to the maximum zoom', () => {
    expect(zoomFromPercent(0)).toBe(RACK_ZOOM_MIN);
    expect(zoomFromPercent(100)).toBe(RACK_ZOOM_MAX);
    expect(zoomFromPercent(50)).toBe(1.75);
    expect(zoomFromPercent(-10)).toBe(RACK_ZOOM_MIN);
    expect(zoomFromPercent(140)).toBe(RACK_ZOOM_MAX);
  });

  it('maps zoom back to a whole percentage', () => {
    expect(percentFromZoom(1)).toBe(0);
    expect(percentFromZoom(2.5)).toBe(100);
    expect(percentFromZoom(1.75)).toBe(50);
    expect(percentFromZoom(1.2)).toBe(13);
  });
});

describe('RackZoomPicker', () => {
  const renderPicker = (zoom = 1) => {
    const onZoom = vi.fn();
    const onFit = vi.fn();
    render(<div><button type="button">outside</button><RackZoomPicker zoom={zoom} onZoom={onZoom} onFit={onFit} /></div>);
    return { onZoom, onFit, trigger: screen.getByRole('button', { name: `rack.zoom: ${percentFromZoom(zoom)}%` }) };
  };

  it('opens a slider panel below the trigger and reports the zoom for a slider value', () => {
    const { trigger, onZoom } = renderPicker(1.75);
    expect(trigger).toHaveTextContent('rack.zoom');
    expect(trigger).toHaveTextContent('50%');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const slider = screen.getByRole('slider', { name: 'rack.zoomLevel' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '100');
    expect(slider).toHaveValue('50');
    expect(trigger).toHaveAttribute('aria-controls', screen.getByRole('group', { name: 'rack.zoomPanel' }).id);
    fireEvent.change(slider, { target: { value: '20' } });
    expect(onZoom).toHaveBeenCalledWith(1.3);
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const { trigger } = renderPicker();
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('closes on an outside click but not on a click inside the panel', () => {
    const { trigger, onFit } = renderPicker();
    fireEvent.click(trigger);
    fireEvent.mouseDown(screen.getByRole('slider'));
    expect(screen.getByRole('slider')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'rack.zoomFit' }));
    expect(onFit).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });
});
