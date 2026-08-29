'use client';

import type { ReactNode } from 'react';
import { Network, X } from 'lucide-react';

export interface IpamModalProps {
  title: string;
  children: ReactNode;
  close: () => void;
}

/** IPAM-local modal (narrower than the shared wide modal). */
export function IpamModal({ title, children, close }: IpamModalProps) {
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section className="modal-card" role="dialog" aria-modal="true">
      <div className="modal-heading"><h2>{title}</h2><button className="icon-button subtle" onClick={close} aria-label="Fechar"><X size={16} /></button></div>
      {children}
    </section>
  </div>;
}

export function Empty({ title, text }: { title: string; text: string }) {
  return <section className="ipam-card empty-context"><Network size={30} /><strong>{title}</strong><span>{text}</span></section>;
}
