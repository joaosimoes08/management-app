'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Gap between the rack and the card, and the minimum distance kept from the stage and viewport edges. */
export const HOVER_CARD_GAP = 14;
export const HOVER_CARD_MARGIN = 8;

export interface HoverCardBox { top: number; right: number; bottom: number; left: number }
export interface HoverCardPlacement { top: number; left: number; side: 'right' | 'left' }

export interface PlaceHoverCardInput {
  /** The hovered device. The card is centred on it vertically. */
  device: HoverCardBox;
  /** The racks on the stage: one frame in single-face views, the front + rear pair in Ambas. The card goes beside them, never over them. */
  rack: HoverCardBox;
  /** The visible rack stage. The card stays between its top and bottom lines. */
  stage: HoverCardBox;
  card: { width: number; height: number };
  viewport: { width: number; height: number };
  /** The side to try first. Ambas: 'left' for the front (left) rack, 'right' for the rear one. Defaults to 'right'. */
  prefer?: HoverCardPlacement['side'];
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Viewport coordinates for the device card, beside the racks and never over them unless nothing else fits.
 * Horizontally the card opens on the `prefer` side (default right): in Ambas a front-face device prefers the left of the
 * front rack and a rear-face device the right of the rear rack; single-face views prefer the right. If that side is out of
 * the window it opens on the other side, and if neither fits it is clamped inside the window (the only case where it may
 * overlap a rack). Vertically it is centred on the device, then kept below the stage's top line and above its bottom
 * line (devices in the top U's open downwards, bottom U's upwards).
 */
export function placeHoverCard({ device, rack, stage, card, viewport, prefer = 'right' }: PlaceHoverCardInput): HoverCardPlacement {
  const minLeft = HOVER_CARD_MARGIN;
  const maxLeft = viewport.width - HOVER_CARD_MARGIN - card.width;
  const positions = { right: rack.right + HOVER_CARD_GAP, left: rack.left - HOVER_CARD_GAP - card.width };
  const fits = { right: positions.right <= maxLeft, left: positions.left >= minLeft };
  const other = prefer === 'right' ? 'left' : 'right';
  let side: HoverCardPlacement['side'];
  let left: number;
  if (fits[prefer]) {
    side = prefer;
    left = positions[prefer];
  } else if (fits[other]) {
    side = other;
    left = positions[other];
  } else {
    side = prefer;
    left = clamp(positions[prefer], minLeft, maxLeft);
  }

  // The stage part that is on screen; fall back to the whole viewport when it is too short for the card.
  let minTop = Math.max(stage.top, 0) + HOVER_CARD_MARGIN;
  let maxBottom = Math.min(stage.bottom, viewport.height) - HOVER_CARD_MARGIN;
  if (maxBottom - minTop < card.height) {
    minTop = HOVER_CARD_MARGIN;
    maxBottom = viewport.height - HOVER_CARD_MARGIN;
  }
  const centre = (device.top + device.bottom) / 2;
  const top = clamp(centre - card.height / 2, minTop, maxBottom - card.height);
  return { top: Math.round(top), left: Math.round(left), side };
}

const box = (element: Element): HoverCardBox => {
  const { top, right, bottom, left } = element.getBoundingClientRect();
  return { top, right, bottom, left };
};

/**
 * The box around every rack frame on the device's stage, so the card clears both faces in Ambas, and the side to try
 * first: with two or more frames (Ambas) a device in the leftmost frame (front) prefers the left, any other the right.
 */
function racksBox(anchor: HTMLElement): { rack: HoverCardBox; prefer: HoverCardPlacement['side'] } {
  const frames = [...(anchor.closest('.rack-stage')?.querySelectorAll('.rack-frame') ?? [])];
  const own = anchor.closest('.rack-frame') ?? anchor;
  const boxes = (frames.length ? frames : [own]).map(box);
  const rack = {
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
    left: Math.min(...boxes.map((b) => b.left)),
  };
  const leftmost = frames.length > 1 && box(own).left <= rack.left + 0.5;
  return { rack, prefer: leftmost ? 'left' : 'right' };
}

/** The one device card shown at a time, shared by the front and rear overlays. */
export interface ActiveRackCard { key: string; anchor: HTMLElement }
let activeCard: ActiveRackCard | null = null;
const cardListeners = new Set<() => void>();
export function setActiveRackCard(next: ActiveRackCard | null) {
  if (activeCard === next) return;
  activeCard = next;
  cardListeners.forEach((listener) => listener());
}
/** Hides the card only if it still belongs to this device, so a newer card on the other face stays. */
export function clearActiveRackCard(key: string) {
  if (activeCard?.key === key) setActiveRackCard(null);
}
/** Hides the card if it belongs to any device whose key starts with this prefix (an overlay that unmounts). */
export function clearActiveRackCards(prefix: string) {
  if (activeCard?.key.startsWith(prefix)) setActiveRackCard(null);
}
/** Hides the card if it is anchored to this element (used when that element is no longer in the page). */
export function clearActiveRackCardAnchor(anchor: HTMLElement) {
  if (activeCard?.anchor === anchor) setActiveRackCard(null);
}
const subscribeCard = (listener: () => void) => {
  cardListeners.add(listener);
  return () => { cardListeners.delete(listener); };
};
export function useActiveRackCard(): ActiveRackCard | null {
  return useSyncExternalStore(subscribeCard, () => activeCard, () => null);
}

export interface RackDeviceHoverCardProps {
  id: string;
  /** The hovered or focused device button. */
  anchor: HTMLElement;
  children: ReactNode;
}

/**
 * Device info card for the rack view. It is portalled to the body with fixed coordinates so the stage's scroll and
 * overflow clipping can never hide it, and it follows the device while the page or stage scrolls.
 */
export function RackDeviceHoverCard({ id, anchor, children }: RackDeviceHoverCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<HoverCardPlacement | null>(null);

  const update = useCallback(() => {
    const card = ref.current;
    if (!anchor.isConnected) {
      // The device left the DOM (moved, deleted, or its view re-rendered) while its card was open: close the card.
      clearActiveRackCardAnchor(anchor);
      return;
    }
    if (!card) return;
    const stage = anchor.closest('.rack-stage-wrap') ?? anchor.closest('.rack-stage') ?? anchor;
    const next = placeHoverCard({
      device: box(anchor),
      ...racksBox(anchor),
      stage: box(stage),
      card: { width: card.offsetWidth, height: card.offsetHeight },
      viewport: { width: document.documentElement.clientWidth || window.innerWidth, height: document.documentElement.clientHeight || window.innerHeight },
    });
    setPlacement((previous) => previous && previous.top === next.top && previous.left === next.left && previous.side === next.side ? previous : next);
  }, [anchor]);

  // Re-measure after every render (the content can change size); the equality check above stops this from looping.
  useLayoutEffect(() => { update(); });

  // Follow the device while the page or the stage scrolls, and on resize. Subscribed once per anchor.
  useEffect(() => {
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [update]);

  if (typeof document === 'undefined') return null;
  return createPortal(<div ref={ref} id={id} role="tooltip" className="rack-equipment-tooltip" data-side={placement?.side} style={{ top: placement?.top ?? 0, left: placement?.left ?? 0, visibility: placement ? 'visible' : 'hidden' }}>{children}</div>, document.body);
}
