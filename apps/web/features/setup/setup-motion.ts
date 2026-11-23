import type { Transition, Variants } from 'motion/react';

/** +1 when moving forward (Next), -1 when going back. */
export type StepDirection = 1 | -1;

const EASE_OUT: Transition['ease'] = [0.22, 1, 0.36, 1];
export const STEP_ENTER_MS = 240;
export const STEP_EXIT_MS = 140;
const SLIDE_PX = 16;

/**
 * Step content transition: the outgoing step fades and slides out, the incoming one
 * fades in from the side it is coming from. With reduced motion there is no slide,
 * only a very short opacity change.
 */
export function stepPanelVariants(reduceMotion: boolean): Variants {
  if (reduceMotion) {
    const fade = { duration: 0.08 };
    return { enter: { opacity: 0 }, center: { opacity: 1, x: 0, transition: fade }, exit: { opacity: 0, transition: fade } };
  }
  return {
    enter: (direction: StepDirection) => ({ opacity: 0, x: direction * SLIDE_PX }),
    center: { opacity: 1, x: 0, transition: { duration: STEP_ENTER_MS / 1000, ease: EASE_OUT } },
    exit: (direction: StepDirection) => ({ opacity: 0, x: direction * -SLIDE_PX * 0.75, transition: { duration: STEP_EXIT_MS / 1000, ease: 'easeIn' } }),
  };
}

/** The active-row highlight gliding between steps, and the ring arc filling. */
export function stepIndicatorTransition(reduceMotion: boolean): Transition {
  return reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 };
}

export function ringTransition(reduceMotion: boolean): Transition {
  return reduceMotion ? { duration: 0 } : { duration: 0.45, ease: EASE_OUT };
}

export const CARD_HEIGHT_MS = 240;
const EASE_OUT_CSS = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Smoothly animates an element's height when its content makes it grow or shrink
 * (e.g. a taller setup step mounting). Only `height` is animated, so the content
 * never scales; the element should clip overflow. Instant when `disabled`
 * (reduced motion, small screens) or when the width changed (window resize).
 */
export function animateHeightChanges(element: HTMLElement, isDisabled: () => boolean): () => void {
  if (typeof ResizeObserver === 'undefined' || typeof element.animate !== 'function') return () => undefined;
  let last: { width: number; height: number } | null = null;
  let running: Animation | null = null;
  const observer = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1]?.borderBoxSize?.[0];
    const width = box ? box.inlineSize : element.offsetWidth;
    const height = box ? box.blockSize : element.offsetHeight;
    if (running) return; // intermediate frames of our own animation
    const previous = last;
    last = { width, height };
    if (!previous || Math.abs(previous.height - height) < 1 || Math.abs(previous.width - width) >= 1 || isDisabled()) return;
    // Pin the old height before this frame paints so the taller/shorter content never flashes at full size.
    element.style.height = `${previous.height}px`;
    running = element.animate([{ height: `${previous.height}px` }, { height: `${height}px` }], { duration: CARD_HEIGHT_MS, easing: EASE_OUT_CSS });
    const done = () => { running = null; element.style.height = ''; };
    running.addEventListener('finish', done);
    running.addEventListener('cancel', done);
  });
  observer.observe(element);
  return () => { observer.disconnect(); running?.cancel(); element.style.height = ''; };
}
