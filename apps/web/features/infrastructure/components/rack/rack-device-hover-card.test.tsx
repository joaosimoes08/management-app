import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Device, Rack } from '../../types';
import { HOVER_CARD_GAP, HOVER_CARD_MARGIN, placeHoverCard, setActiveRackCard, type HoverCardBox } from './rack-device-hover-card';
import { RackEquipmentOverlay } from './rack-equipment-overlay';

vi.mock('../asset-image', () => ({ AssetImage: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }));
afterEach(() => { cleanup(); setActiveRackCard(null); vi.restoreAllMocks(); });

const rect = (left: number, top: number, width: number, height: number): HoverCardBox => ({ left, top, right: left + width, bottom: top + height });
const card = { width: 250, height: 180 };
const viewport = { width: 1440, height: 900 };
const stage = rect(300, 200, 800, 640);
const frontRack = rect(400, 220, 304, 600);
const rearRack = rect(760, 220, 304, 600);
/** Ambas: the box around the front and rear frames. */
const pair = { top: frontRack.top, left: frontRack.left, right: rearRack.right, bottom: frontRack.bottom };

describe('placeHoverCard', () => {
  it('single face: puts the card to the right of that one rack', () => {
    const place = placeHoverCard({ device: rect(420, 500, 260, 14), rack: frontRack, stage, card, viewport });
    expect(place).toMatchObject({ side: 'right', left: frontRack.right + HOVER_CARD_GAP });
  });

  it('Ambas: anchors a front-face card to the right edge of the pair, clear of the rear rack', () => {
    const place = placeHoverCard({ device: rect(420, 500, 260, 14), rack: pair, stage, card, viewport });
    expect(place).toMatchObject({ side: 'right', left: rearRack.right + HOVER_CARD_GAP });
    expect(place.left).toBeGreaterThan(rearRack.right);
  });

  it('Ambas: anchors a rear-face card to the same right edge', () => {
    const place = placeHoverCard({ device: rect(780, 500, 260, 14), rack: pair, stage, card, viewport });
    expect(place).toMatchObject({ side: 'right', left: rearRack.right + HOVER_CARD_GAP });
  });

  it('Ambas: flips to the left of the front rack when the pair has no room on the right', () => {
    const narrow = { width: 1200, height: 900 };
    const place = placeHoverCard({ device: rect(780, 500, 260, 14), rack: pair, stage, card, viewport: narrow });
    expect(place).toMatchObject({ side: 'left', left: frontRack.left - HOVER_CARD_GAP - card.width });
    expect(place.left + card.width).toBeLessThan(frontRack.left);
  });

  it('Ambas: clamps inside the viewport as a last resort when neither side of the pair fits', () => {
    const narrow = { width: 900, height: 900 };
    const tightPair = rect(150, 220, 640, 600);
    const place = placeHoverCard({ device: rect(170, 500, 260, 14), rack: tightPair, stage: rect(0, 200, 900, 640), card, viewport: narrow });
    expect(place).toMatchObject({ side: 'right', left: narrow.width - HOVER_CARD_MARGIN - card.width });
  });

  it('keeps a top-U card below the stage top line', () => {
    const place = placeHoverCard({ device: rect(420, 222, 260, 14), rack: frontRack, stage, card, viewport });
    expect(place.top).toBe(stage.top + HOVER_CARD_MARGIN);
  });

  it('keeps a bottom-U card above the stage bottom line', () => {
    const place = placeHoverCard({ device: rect(420, 812, 260, 14), rack: frontRack, stage, card, viewport });
    expect(place.top + card.height).toBe(stage.bottom - HOVER_CARD_MARGIN);
  });

  it('centres the card on a device in the middle of the rack', () => {
    const place = placeHoverCard({ device: rect(420, 500, 260, 20), rack: frontRack, stage, card, viewport });
    expect(place.top).toBe(510 - card.height / 2);
  });

  it('single face: flips to the left of the rack when the window is too narrow on the right', () => {
    const narrow = { width: 1100, height: 900 };
    const place = placeHoverCard({ device: rect(780, 500, 260, 14), rack: rearRack, stage, card, viewport: narrow });
    expect(place).toMatchObject({ side: 'left', left: rearRack.left - HOVER_CARD_GAP - card.width });
  });

  it('clamps inside the viewport when neither side fits', () => {
    const tiny = { width: 400, height: 600 };
    const place = placeHoverCard({ device: rect(60, 300, 260, 14), rack: rect(40, 100, 304, 600), stage: rect(0, 80, 400, 520), card, viewport: tiny });
    expect(place.left).toBe(tiny.width - HOVER_CARD_MARGIN - card.width);
    expect(place.top).toBeGreaterThanOrEqual(HOVER_CARD_MARGIN);
  });

  it('uses the viewport when the stage is mostly scrolled out of view', () => {
    const place = placeHoverCard({ device: rect(420, -40, 260, 14), rack: frontRack, stage: rect(300, -500, 800, 560), card, viewport });
    expect(place.top).toBe(HOVER_CARD_MARGIN);
  });
});

const rack: Rack = {
  id: 'rack-a', name: 'Core cabinet', roomId: 'room-1', units: 42,
  devices: [{ id: 'device-1', name: 'Edge switch', type: 'SWITCH', status: 'ACTIVE', rackId: 'rack-a', rackUnitStart: 42, rackUnitSize: 1, managementIp: '10.0.0.1' } as Device],
};

describe('RackEquipmentOverlay device card', () => {
  const renderOverlay = (dragging = '') => render(<div className="rack-stage-wrap"><div className="rack-frame"><RackEquipmentOverlay rack={rack} face="front" onSelect={vi.fn()} onDropDevice={vi.fn()} draggingDeviceId={dragging} onDragging={vi.fn()} canEdit /></div></div>);

  it('renders the card on hover in a portal outside the clipped rack stage', () => {
    renderOverlay();
    const device = screen.getByRole('button', { name: /Edge switch/ });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(device);
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.textContent).toContain('10.0.0.1');
    expect(tooltip.parentElement).toBe(document.body);
    expect(device.contains(tooltip)).toBe(false);
    expect(device.getAttribute('aria-describedby')).toBe(tooltip.id);
    fireEvent.mouseLeave(device);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('shows one card at a time across the front and rear overlays', () => {
    render(<div className="rack-stage-wrap"><div className="rack-stage">{(['front', 'rear'] as const).map((face) => <div className="rack-frame" key={face}><RackEquipmentOverlay rack={rack} face={face} onSelect={vi.fn()} onDropDevice={vi.fn()} draggingDeviceId="" onDragging={vi.fn()} canEdit /></div>)}</div></div>);
    const [front, rear] = screen.getAllByRole('button', { name: /Edge switch/ });
    fireEvent.mouseEnter(front);
    fireEvent.mouseEnter(rear);
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    expect(rear.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    expect(front.getAttribute('aria-describedby')).toBeNull();
    fireEvent.mouseLeave(front);
    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
  });

  it('subscribes to scroll and resize once, not on every render', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const view = renderOverlay();
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Edge switch/ }));
    const subscriptions = () => add.mock.calls.filter(([type]) => type === 'scroll' || type === 'resize').length;
    expect(subscriptions()).toBe(2);
    view.rerender(<div className="rack-stage-wrap"><div className="rack-frame"><RackEquipmentOverlay rack={{ ...rack }} face="front" onSelect={vi.fn()} onDropDevice={vi.fn()} draggingDeviceId="" onDragging={vi.fn()} canEdit /></div></div>);
    expect(subscriptions()).toBe(2);
  });

  it('hides the card on Escape', () => {
    renderOverlay();
    const device = screen.getByRole('button', { name: /Edge switch/ });
    fireEvent.mouseEnter(device);
    fireEvent.keyDown(device, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not show the card while a device is being dragged', () => {
    renderOverlay('device-1');
    fireEvent.mouseEnter(screen.getByRole('button', { name: /Edge switch/ }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
