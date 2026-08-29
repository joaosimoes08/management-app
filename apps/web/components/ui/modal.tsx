'use client';

import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export interface ModalProps {
  title: string;
  children: ReactNode;
  close: () => void;
}

export function Modal({ title, children, close }: ModalProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="modal-card wide-modal">
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button subtle" onClick={close}>
            <X size={16} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
