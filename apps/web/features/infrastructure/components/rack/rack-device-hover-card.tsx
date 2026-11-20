'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Gap between the rack and the card, and the minimum distance kept from the stage and viewport edges. */
export const HOVER_CARD_GAP = 14;
export const HOVER_CARD_MARGIN = 8;

export interface HoverCardBox { top: number; right: number; bottom: number; left: number }
export interface HoverCardPlacement { top: number; left: number; side: 'right' | 'left' }

export interface PlaceHoverCardInput {
  /** The hovered device. The card is centred on it vertically. */
  device: HoverCardBox;
  /** The rack the device sits in. The card goes beside it, never over it. */
  rack: HoverCardBox;
  /** The visible rack stage. The card stays between its top and bottom lines. */
  stage: HoverCardBox;
  card: { width: number; height: number };
  viewport: { width: number; height: number };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Viewport coordinates for the device card: to the right of the rack, flipped to its left when the right side is out of
 * the window, and clamped so it is fully visible. Vertically it is centred on the device, then kept below the stage's
 * top line and above its bottom line (devices in the top U's open downwards, bottom U's upwards).
 */
export function placeHoverCard({ device, rack, stage, card, viewport }: PlaceHoverCardInput): HoverCardPlacement {
  const minLeft = HOVER_CARD_MARGIN;
  const maxLeft = viewport.width - HOVER_CARD_MARGIN - card.width;
  let side: HoverCardPlacement['side'] = 'right';
  let left = rack.right + HOVER_CARD_GAP;
  if (left > maxLeft) {
    const flipped = rack.left - HOVER_CARD_GAP - card.width;
    if (flipped >= minLeft) {
      side = 'left';
      left = flipped;
    } else {
      left = clamp(left, minLeft, maxLeft);
    }
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

  useLayoutEffect(() => {
    const update = () => {
      const card = ref.current;
      if (!card || !anchor.isConnected) return;
      const rack = anchor.closest('.rack-frame') ?? anchor;
      const stage = anchor.closest('.rack-stage-wrap') ?? anchor.closest('.rack-stage') ?? rack;
      const next = placeHoverCard({
        device: box(anchor),
        rack: box(rack),
        stage: box(stage),
        card: { width: card.offsetWidth, height: card.offsetHeight },
        viewport: { width: document.documentElement.clientWidth || window.innerWidth, height: document.documentElement.clientHeight || window.innerHeight },
      });
      setPlacement((previous) => previous && previous.top === next.top && previous.left === next.left && previous.side === next.side ? previous : next);
    };
    update();
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
  }, [anchor, children]);

  if (typeof document === 'undefined') return null;
  return createPortal(<div ref={ref} id={id} role="tooltip" className="rack-equipment-tooltip" data-side={placement?.side} style={{ top: placement?.top ?? 0, left: placement?.left ?? 0, visibility: placement ? 'visible' : 'hidden' }}>{children}</div>, document.body);
}
