'use client';

import { useEffect, useRef } from 'react';

const openDialogs: Array<() => void> = [];

function closeTopDialog(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
  const close = openDialogs.at(-1);
  if (!close) return;
  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat) close();
}

/** Escape dismisses only the most recently opened dialog, even when focus is outside it. */
export function useEscapeClose(close: () => void, open = true) {
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => closeRef.current();
    if (!openDialogs.length) window.addEventListener('keydown', closeTopDialog, true);
    openDialogs.push(dismiss);
    return () => {
      openDialogs.splice(openDialogs.indexOf(dismiss), 1);
      if (!openDialogs.length) window.removeEventListener('keydown', closeTopDialog, true);
    };
  }, [open]);
}
