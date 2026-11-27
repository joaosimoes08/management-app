'use client';

import { useLayoutEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { contextToolbarHasControls, contextToolbarOverflows } from './context-toolbar-fit';

export interface ToolbarFit {
  /** The page's controls do not fit beside the title and sit in the "Controlos" panel. */
  compact: boolean;
  /** The "Controlos" panel is open (only meaningful while compact). */
  controlsOpen: boolean;
  setControlsOpen: Dispatch<SetStateAction<boolean>>;
}

/**
 * One-line utility bar: when the page's controls do not fit beside the title (they would wrap or spill),
 * they move into the "Controlos" panel. The check runs before paint and again on resize or content change.
 * Mirrors the state on the bar as `data-compact`; leaving compact mode closes the panel.
 */
export function useToolbarFit(toolbarRef: RefObject<HTMLElement | null>): ToolbarFit {
  const [compact, setCompact] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    let frame = 0;
    // Width at which the one-line layout last failed for real, so a passing trial cannot flip it back and forth.
    let failedAt = -1;
    const fit = () => {
      frame = 0;
      const width = toolbar.clientWidth;
      if (!contextToolbarHasControls(toolbar)) {
        if (toolbar.hasAttribute('data-compact')) { toolbar.removeAttribute('data-compact'); setCompact(false); }
        return;
      }
      if (!toolbar.hasAttribute('data-compact')) {
        if (contextToolbarOverflows(toolbar)) { failedAt = width; toolbar.setAttribute('data-compact', ''); setCompact(true); }
        return;
      }
      if (width <= failedAt) return;
      // Trial: lay the bar out on one line with the page actions folded to their minimum, measure, and keep compact if it still spills.
      toolbar.removeAttribute('data-compact');
      toolbar.setAttribute('data-measuring', '');
      const overflows = contextToolbarOverflows(toolbar);
      toolbar.removeAttribute('data-measuring');
      if (overflows) toolbar.setAttribute('data-compact', '');
      else { setCompact(false); setControlsOpen(false); }
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(fit); };
    fit();
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    resize?.observe(toolbar);
    const content = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver((records) => {
      const inside = (selector: string) => records.every((record) => (record.target instanceof Element ? record.target : record.target.parentElement)?.closest(selector));
      if (inside('.responsive-overflow-measure, .responsive-overflow-popover')) return;
      // "Mais ações" re-folding itself is a consequence of our own layout change, not new content: keep the failure memory.
      if (!inside('.responsive-toolbar-actions')) failedAt = -1;
      schedule();
    });
    content?.observe(toolbar, { childList: true, subtree: true, characterData: true });
    return () => { resize?.disconnect(); content?.disconnect(); if (frame) window.cancelAnimationFrame(frame); };
  }, [toolbarRef]);

  return { compact, controlsOpen, setControlsOpen };
}
