import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Modal } from './modal';
import { useDialogFocus, useDialogFocusRef } from './use-dialog-focus';

function Dialog({ label, close, children, returnFocus }: { label: string; close: () => void; children?: React.ReactNode; returnFocus?: boolean }) {
  const ref = useDialogFocusRef<HTMLElement>(true, { returnFocus });
  return <section ref={ref} role="dialog" aria-modal="true" aria-label={label}>
    <div className="modal-heading"><button type="button" onClick={close}>Fechar {label}</button></div>
    <input aria-label={`Nome ${label}`} />
    {children}
    <button type="button" onClick={close}>Guardar {label}</button>
  </section>;
}

function Harness({ returnFocus }: { returnFocus?: boolean }) {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return <div>
    <button type="button" onClick={() => setOuter(true)}>Abrir</button>
    {outer && <Dialog label="externo" close={() => setOuter(false)} returnFocus={returnFocus}>
      <button type="button" onClick={() => setInner(true)}>Abrir interno</button>
      {inner && <Dialog label="interno" close={() => setInner(false)} />}
    </Dialog>}
  </div>;
}

const tab = (shiftKey = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Tab', shiftKey });

afterEach(cleanup);

describe('useDialogFocus', () => {
  it('moves focus to the first control after the heading when the dialog opens', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByLabelText('Nome externo')).toHaveFocus();
  });

  it('keeps Tab and Shift+Tab inside the dialog', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const first = screen.getByRole('button', { name: 'Fechar externo' });
    const last = screen.getByRole('button', { name: 'Guardar externo' });

    act(() => last.focus());
    tab();
    expect(first).toHaveFocus();

    tab(true);
    expect(last).toHaveFocus();

    // Focus that escaped to the page is pulled back in.
    act(() => screen.getByRole('button', { name: 'Abrir' }).focus());
    tab();
    expect(first).toHaveFocus();
  });

  it('returns focus to the opener when the dialog closes', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    act(() => opener.focus());
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar externo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('does not return focus when returnFocus is false', () => {
    render(<Harness returnFocus={false} />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    act(() => opener.focus());
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar externo' }));
    expect(opener).not.toHaveFocus();
  });

  it('traps only the innermost dialog and returns focus to the outer dialog when the inner one closes', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const innerOpener = screen.getByRole('button', { name: 'Abrir interno' });
    act(() => innerOpener.focus());
    fireEvent.click(innerOpener);
    expect(screen.getByLabelText('Nome interno')).toHaveFocus();

    act(() => screen.getByRole('button', { name: 'Guardar interno' }).focus());
    tab();
    expect(screen.getByRole('button', { name: 'Fechar interno' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Guardar interno' }));
    expect(innerOpener).toHaveFocus();

    // The outer trap is active again.
    act(() => screen.getByRole('button', { name: 'Guardar externo' }).focus());
    tab();
    expect(screen.getByRole('button', { name: 'Fechar externo' })).toHaveFocus();
  });

  it('honours initialFocus and leaves focus alone when a child already took it', () => {
    function Custom() {
      const ref = useRef<HTMLElement>(null);
      const target = useRef<HTMLButtonElement>(null);
      useDialogFocus(ref, true, { initialFocus: target });
      return <section ref={ref} role="dialog"><button type="button">Primeiro</button><button type="button" ref={target}>Alvo</button></section>;
    }
    render(<Custom />);
    expect(screen.getByRole('button', { name: 'Alvo' })).toHaveFocus();
    cleanup();

    function AutoFocused() {
      const ref = useDialogFocusRef<HTMLElement>();
      return <section ref={ref} role="dialog"><button type="button">Primeiro</button><input aria-label="Auto" autoFocus /></section>;
    }
    render(<AutoFocused />);
    expect(screen.getByLabelText('Auto')).toHaveFocus();
  });

  it('focuses the dialog itself when it has no focusable controls', () => {
    function Empty() {
      const ref = useDialogFocusRef<HTMLElement>();
      return <section ref={ref} role="dialog" aria-label="Vazio"><p>Sem controlos</p></section>;
    }
    render(<Empty />);
    const dialog = screen.getByRole('dialog', { name: 'Vazio' });
    expect(dialog).toHaveFocus();
    tab();
    expect(dialog).toHaveFocus();
  });
});

describe('Modal focus', () => {
  it('moves focus into the shared modal and back to the opener on close', () => {
    function ModalHarness() {
      const [open, setOpen] = useState(false);
      return <div>
        <button type="button" onClick={() => setOpen(true)}>Editar</button>
        {open && <Modal title="Editar equipamento" close={() => setOpen(false)}><label>Nome<input /></label></Modal>}
      </div>;
    }
    render(<ModalHarness />);
    const opener = screen.getByRole('button', { name: 'Editar' });
    act(() => opener.focus());
    fireEvent.click(opener);
    expect(screen.getByLabelText('Nome')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
