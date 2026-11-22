'use client';

import { useEffect, useRef, type RefObject } from 'react';

export const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Dialogs with an active trap, innermost last: only the top one handles Tab. */
const openTraps: Array<RefObject<HTMLElement | null>> = [];

function focusableIn(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => !element.closest('[inert]') && element.getAttribute('aria-hidden') !== 'true');
}

function trapTab(event: KeyboardEvent) {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const container = openTraps.at(-1)?.current;
  if (!container) return;
  const focusable = focusableIn(container);
  const active = document.activeElement;
  if (!focusable.length) { event.preventDefault(); container.focus(); return; }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!active || !container.contains(active)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
  else if (event.shiftKey && (active === first || active === container)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}

export interface DialogFocusOptions {
  /** Element to focus when the dialog opens. Default: the first focusable control after the dialog heading. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** false when something else (e.g. useConfirm) already returns focus to the opener. */
  returnFocus?: boolean;
}

/**
 * Focus handling for a modal dialog: moves focus inside when it opens (unless a child already took
 * it, e.g. autoFocus), keeps Tab and Shift+Tab inside, and on close puts focus back on the element
 * that had it when the dialog opened, if that element is still on the page.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, active = true, { initialFocus, returnFocus = true }: DialogFocusOptions = {}) {
  const initialFocusRef = useRef(initialFocus);
  initialFocusRef.current = initialFocus;

  useEffect(() => {
    if (!active) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const container = ref.current;
    if (container && !container.contains(document.activeElement)) {
      const heading = container.querySelector('.modal-heading');
      const candidates = focusableIn(container);
      const target = initialFocusRef.current?.current
        ?? candidates.find((element) => !heading?.contains(element))
        ?? candidates[0];
      if (target) target.focus();
      else { if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1'); container.focus(); }
    }
    if (!openTraps.length) document.addEventListener('keydown', trapTab, true);
    openTraps.push(ref);
    return () => {
      openTraps.splice(openTraps.lastIndexOf(ref), 1);
      if (!openTraps.length) document.removeEventListener('keydown', trapTab, true);
      // Return focus only if it was inside this dialog (or lost to the body) when it closed,
      // so closing one dialog by opening another does not steal focus back.
      const current = document.activeElement;
      const focusWasInside = !current || current === document.body || Boolean(container?.contains(current)) || !current.isConnected;
      if (returnFocus && opener?.isConnected && focusWasInside) opener.focus();
    };
  }, [active, ref, returnFocus]);
}

/** useDialogFocus with its own ref: `const dialogRef = useDialogFocusRef<HTMLElement>(); <section ref={dialogRef} role="dialog">`. */
export function useDialogFocusRef<T extends HTMLElement = HTMLElement>(active = true, options?: DialogFocusOptions) {
  const ref = useRef<T>(null);
  useDialogFocus(ref, active, options);
  return ref;
}
