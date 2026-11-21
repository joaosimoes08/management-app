'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export interface ConfirmOptions {
  /** Main question, e.g. "Eliminar a regra NAT X?". Line breaks are kept. */
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Deletes and other irreversible actions: danger button, focus starts on Cancelar. */
  destructive?: boolean;
}

export type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Accessible replacement for window.confirm, built on the existing modal classes. */
export function ConfirmDialog({ message, title, confirmLabel, cancelLabel = 'Cancelar', destructive = false, onResolve }: ConfirmOptions & { onResolve: (confirmed: boolean) => void }) {
  const titleId = useId();
  const messageId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    (destructive ? cancelRef : confirmRef).current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [destructive]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onResolve(false); return; }
    if (event.key !== 'Tab' || !cardRef.current) return;
    const focusable = [...cardRef.current.querySelectorAll<HTMLElement>(focusableSelector)];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const lines = message.split('\n');
  const body: ReactNode = lines.map((line, index) => <span key={index}>{line}{index < lines.length - 1 && <br />}</span>);

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onResolve(false)}>
    <section ref={cardRef} className="modal-card" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} onKeyDown={onKeyDown}>
      <div className="modal-heading"><h2 id={titleId}>{title ?? (destructive ? 'Confirmar eliminação' : 'Confirmar')}</h2><button type="button" className="icon-button subtle" onClick={() => onResolve(false)} aria-label="Fechar"><X size={16} /></button></div>
      <div className="modal-form">
        <p className="panel-description" id={messageId}>{body}</p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="secondary-button" onClick={() => onResolve(false)}>{cancelLabel}</button>
          <button ref={confirmRef} type="button" className={destructive ? 'secondary-button danger' : 'primary-button'} onClick={() => onResolve(true)}>{confirmLabel ?? (destructive ? 'Eliminar' : 'Confirmar')}</button>
        </div>
      </div>
    </section>
  </div>;
}

/**
 * Promise-based confirm. Render `confirmDialog` once in the component:
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ message: 'Eliminar X?', destructive: true }))) return;
 * Focus returns to the element that was focused when confirm() was called.
 */
export function useConfirm(): { confirm: ConfirmFn; confirmDialog: ReactNode } {
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    pending.current?.(false);
    returnFocus.current = typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const normalized = typeof options === 'string' ? { message: options } : options;
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setRequest(normalized);
    });
  }, []);

  useEffect(() => () => { pending.current?.(false); }, []);

  const resolve = useCallback((confirmed: boolean) => {
    pending.current?.(confirmed);
    pending.current = null;
    setRequest(null);
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target?.isConnected) window.setTimeout(() => target.focus(), 0);
  }, []);

  const confirmDialog = request && typeof document !== 'undefined'
    ? createPortal(<ConfirmDialog {...request} onResolve={resolve} />, document.body)
    : null;
  return { confirm, confirmDialog };
}
