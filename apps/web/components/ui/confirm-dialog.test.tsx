import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useConfirm, type ConfirmOptions } from './confirm-dialog';
import { translateLegacyText } from '@/lib/i18n/legacy-messages';

function Harness({ options }: { options: ConfirmOptions }) {
  const { confirm, confirmDialog } = useConfirm();
  const [result, setResult] = useState('');
  return <div>
    <button type="button" onClick={() => void confirm(options).then((value) => setResult(String(value)))}>Abrir</button>
    <output aria-label="Resultado">{result}</output>
    {confirmDialog}
  </div>;
}

afterEach(cleanup);

describe('useConfirm', () => {
  it('opens an alertdialog, resolves true on confirm and returns focus to the trigger', async () => {
    render(<Harness options={{ title: 'Importar prefixos RIPE', message: 'Importar 2 prefixo(s)?', confirmLabel: 'Importar' }} />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('alertdialog', { name: 'Importar prefixos RIPE' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Importar 2 prefixo(s)?');
    const confirmButton = within(dialog).getByRole('button', { name: 'Importar' });
    expect(confirmButton).toHaveClass('primary-button');
    expect(confirmButton).toHaveFocus();
    fireEvent.click(confirmButton);
    await waitFor(() => expect(screen.getByLabelText('Resultado')).toHaveTextContent('true'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('uses the destructive variant, focuses Cancelar first and cancels on Escape', async () => {
    render(<Harness options={{ message: 'Eliminar a regra NAT web?', destructive: true }} />);
    const trigger = screen.getByRole('button', { name: 'Abrir' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('alertdialog', { name: 'Confirmar eliminação' });
    expect(within(dialog).getByRole('button', { name: 'Eliminar' })).toHaveClass('secondary-button', 'danger');
    expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.getByLabelText('Resultado')).toHaveTextContent('false'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps Tab focus inside the dialog and treats the backdrop and close button as cancel', async () => {
    render(<Harness options={{ message: 'Remover esta aplicação do portal?', destructive: true, confirmLabel: 'Remover' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    const dialog = screen.getByRole('alertdialog');
    const close = within(dialog).getByRole('button', { name: 'Fechar' });
    const remove = within(dialog).getByRole('button', { name: 'Remover' });
    remove.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(remove).toHaveFocus();
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    await waitFor(() => expect(screen.getByLabelText('Resultado')).toHaveTextContent('false'));

    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    await act(async () => { fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Fechar' })); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('keeps line breaks of multi-line messages', () => {
    render(<Harness options={{ message: 'Atualizar 2 equipamentos?\n\nstatus: INACTIVE' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
    expect(screen.getByRole('alertdialog').querySelectorAll('br')).toHaveLength(2);
  });

  it('has English text for the dialog chrome and the replaced confirm messages', () => {
    expect(translateLegacyText('en-US', 'Confirmar eliminação')).toBe('Confirm deletion');
    expect(translateLegacyText('en-US', 'Existem alterações por guardar. Queres sair sem guardar?')).toBe('There are unsaved changes. Leave without saving?');
    expect(translateLegacyText('en-US', 'Eliminar a regra NAT web-dnat?')).toBe('Delete the NAT rule web-dnat?');
    expect(translateLegacyText('en-US', 'Importar 3 prefixo(s) como subnets deste Site?')).toBe('Import 3 prefix(es) as subnets of this Site?');
    expect(translateLegacyText('en-US', 'Eliminar o bastidor “R1”? Os bastidores seguintes serão deslocados uma posição para a esquerda.')).toBe('Delete the rack “R1”? The following racks will move one position to the left.');
  });
});
