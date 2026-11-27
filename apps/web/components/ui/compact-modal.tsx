'use client';

import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useDialogFocusRef } from '@/components/ui/use-dialog-focus';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export interface CompactModalProps {
  title: string;
  children: ReactNode;
  close: () => void;
}

/**
 * Narrow dialog card (`.modal-card`, no `wide-modal`), for short forms and confirmations.
 * Markup is unchanged from the former IPAM modal, including its heading id.
 */
export function CompactModal({ title, children, close }: CompactModalProps) {
  useEscapeClose(close);
  const dialogRef = useDialogFocusRef<HTMLElement>();
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section ref={dialogRef} className="modal-card" role="dialog" aria-modal="true" aria-labelledby="ipam-modal-title">
      <div className="modal-heading"><h2 id="ipam-modal-title">{title}</h2><button type="button" className="icon-button subtle" onClick={close} aria-label="Fechar"><X size={16} /></button></div>
      {children}
    </section>
  </div>;
}
