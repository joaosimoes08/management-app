'use client';

import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useDialogFocusRef } from '@/components/ui/use-dialog-focus';
import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useUiText } from '@/components/ui/use-ui-text';

export interface ModalProps {
  title: string;
  children: ReactNode;
  close: () => void;
  entryMotion?: boolean;
  /** Extra class on the card (e.g. a fixed-height tabbed editor). */
  className?: string;
}

export function Modal({ title, children, close, entryMotion = false, className = '' }: ModalProps) {
  const ui = useUiText();
  useEscapeClose(close);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  // Focus moves into the dialog, Tab stays inside it, and closing returns focus to the opener.
  const cardRef = useDialogFocusRef<HTMLElement>();

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section ref={cardRef} className={`modal-card wide-modal${entryMotion ? ' entry-motion' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-heading">
          <h2>{title}</h2>
          <button type="button" className="icon-button subtle" onClick={close} aria-label={ui('ui.close')}>
            <X size={16} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
