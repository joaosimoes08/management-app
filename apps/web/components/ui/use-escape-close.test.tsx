import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IpamModal } from '@/features/ipam/components/ipam-modal';
import { useConfirm } from './confirm-dialog';
import { Modal } from './modal';

afterEach(cleanup);

describe('Escape in dialogs', () => {
  it('closes NAT even when focus is outside the dialog', () => {
    const close = vi.fn();
    render(<IpamModal title="Editar regra NAT" close={close}>NAT</IpamModal>);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('cancels a nested confirmation before closing its parent dialog', async () => {
    const decision = vi.fn();
    function Example() {
      const [open, setOpen] = useState(true);
      const { confirm, confirmDialog } = useConfirm();
      return <>
        {open && <Modal title="Revisão de retirada" close={() => setOpen(false)}>
          <button onClick={() => void confirm('Retirar?').then(decision)}>Rever</button>
        </Modal>}
        {confirmDialog}
      </>;
    }
    render(<Example />);
    fireEvent.click(screen.getByRole('button', { name: 'Rever' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Escape', repeat: true });
    expect(screen.getByRole('dialog', { name: 'Revisão de retirada' })).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await Promise.resolve();
    expect(decision).toHaveBeenCalledWith(false);
  });
});
