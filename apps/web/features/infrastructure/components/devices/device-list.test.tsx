import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceList, getPopoverAlignment } from './device-list';
import type { Device } from '../../types';

vi.mock('../asset-image', () => ({ AssetImage: ({ alt, className }: { alt: string; className: string }) => <img alt={alt} className={className} /> }));

const devices = [
  { id: 'one', name: 'Router one', type: 'ROUTER', status: 'ACTIVE' },
  { id: 'two', name: 'Switch two', type: 'SWITCH', status: 'ACTIVE' },
] as Device[];

function renderDeviceList(visibleDevices = devices) {
  return render(<DeviceList devices={visibleDevices} search="" onSelect={vi.fn()} onEdit={vi.fn()} onNew={vi.fn()} onRetire={vi.fn()} canRetire={false} canEdit />);
}

describe('Infrastructure device toolbar', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  it('places the visible-selection dropdown before the primary add action', () => {
    const { container } = renderDeviceList();
    const toolbar = container.querySelector('.device-list-toolbar');
    expect(toolbar).not.toBeNull();
    const labels = within(toolbar as HTMLElement).getAllByRole('button').map((button) => button.textContent?.trim());
    expect(labels[0]).toContain('Selecionar visíveis');
    expect(labels.at(-1)).toContain('Adicionar equipamento');
    expect(toolbar?.querySelector('.device-toolbar-spacer')).toBeNull();
  });

  it('keeps individual selection and exposes bulk edit in a floating popover instead of a toolbar row', () => {
    const { container } = renderDeviceList();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Router one' }));
    const toolbar = container.querySelector('.device-list-toolbar');
    const children = Array.from((toolbar as HTMLElement).children);
    expect(children.findIndex((child) => child.classList.contains('device-selection-dropdown'))).toBeLessThan(children.findIndex((child) => child.classList.contains('primary-button')));
    expect(container.querySelector('.device-list-toolbar > .device-bulk-toolbar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar equipamentos visíveis' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar 1 selecionado' }));
    expect(screen.getByRole('dialog', { name: 'Alterar 1 equipamentos selecionados' })).toBeInTheDocument();
    expect(container.querySelector('.device-list-toolbar > .device-bulk-toolbar')).not.toBeInTheDocument();
  });

  it('keeps the device edit action keyboard-accessible and only requests entry motion for pointer clicks', () => {
    const onEdit = vi.fn();
    render(<DeviceList devices={devices} search="" onSelect={vi.fn()} onEdit={onEdit} onNew={vi.fn()} onRetire={vi.fn()} canRetire={false} canEdit />);
    const edit = screen.getByRole('button', { name: 'Editar Router one' });
    edit.focus();
    expect(edit).toHaveFocus();
    fireEvent.click(edit, { detail: 0 });
    expect(onEdit).toHaveBeenLastCalledWith(devices[0], false);
    fireEvent.click(edit, { detail: 1 });
    expect(onEdit).toHaveBeenLastCalledWith(devices[0], true);
  });

  it('keeps the current device row exposed as current without changing bulk checkbox selection', () => {
    const { container } = render(<DeviceList devices={devices} search="" onSelect={vi.fn()} onEdit={vi.fn()} onNew={vi.fn()} onRetire={vi.fn()} canRetire={false} canEdit selectedId="one" />);
    const currentRow = container.querySelector('.infra-device-row.selected');
    expect(currentRow).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('checkbox', { name: 'Selecionar Router one' })).not.toBeChecked();
  });

  it('uses equal equipment image frames and an inset trailing action group', () => {
    const { container } = renderDeviceList();
    const rows = Array.from(container.querySelectorAll('.infra-device-row'));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.querySelector('.equipment-type-icon-frame')).toBeInTheDocument();
      expect(row.querySelector('.equipment-type-icon-frame img')).toHaveClass('catalog-icon');
      expect(row.querySelector('.infra-device-row > input[type="checkbox"]')).toBeInTheDocument();
      expect(row.querySelector('.row-actions button[aria-label^="Editar"]')).toBeInTheDocument();
    }
    expect(rows[0].querySelector('.row-actions')).toContainElement(screen.getByRole('button', { name: 'Editar Router one' }));
  });

  it('renders the configured front asset when available and still opens device details on row click', () => {
    const onSelect = vi.fn();
    const deviceWithAsset = { ...devices[0], frontAsset: { id: 'asset-one', filename: 'router.png', mimeType: 'image/png', sizeBytes: 1024, kind: 'FRONT' } } as Device;
    const { container } = render(<DeviceList devices={[deviceWithAsset]} search="" onSelect={onSelect} onEdit={vi.fn()} onNew={vi.fn()} onRetire={vi.fn()} canRetire canEdit />);
    const row = container.querySelector('.infra-device-row');
    expect(row?.querySelector('.equipment-type-icon-frame img')).toHaveAttribute('alt', 'Router one — imagem frontal');
    expect(row?.querySelector('.equipment-type-icon-frame img')).toHaveClass('catalog-icon');

    fireEvent.click(screen.getByText('Router one'));
    expect(onSelect).toHaveBeenCalledWith(deviceWithAsset);
  });

  it('aligns anchored selection popovers to the left when right alignment would overflow', () => {
    expect(getPopoverAlignment({ left: 900, right: 1024 }, 1024, 260)).toBe('right');
    expect(getPopoverAlignment({ left: 300, right: 380 }, 1024, 260)).toBe('left');
    expect(getPopoverAlignment({ left: 280, right: 370 }, 390, 440)).toBe('right');
  });

  it('selects visible devices then opens the animated bulk editor and supports keyboard/outside dismissal', async () => {
    const { container } = renderDeviceList();
    const trigger = screen.getByRole('button', { name: 'Selecionar equipamentos visíveis' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Opções de seleção de equipamentos' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(menu.parentElement).toBe(container.querySelector('.device-selection-dropdown'));
    expect(container.querySelector('.device-bulk-toolbar')).not.toBeInTheDocument();
    const selectAllOption = within(menu).getByRole('menuitem', { name: 'Selecionar todos os visíveis' });
    const deselectOption = within(menu).getByRole('menuitem', { name: 'Desselecionar visíveis' });
    expect(selectAllOption).toHaveFocus();
    fireEvent.keyDown(selectAllOption, { key: 'ArrowDown' });
    expect(deselectOption).toHaveFocus();
    fireEvent.keyDown(deselectOption, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Selecionar todos os visíveis' }));
    const bulkPopover = screen.getByRole('dialog', { name: 'Alterar 2 equipamentos selecionados' });
    expect(bulkPopover).toBeInTheDocument();
    expect(bulkPopover.querySelector('select')).toHaveFocus();
    expect(container.querySelector('.device-list-toolbar > .device-bulk-toolbar')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Selecionar Router one' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Selecionar Switch two' })).toBeChecked();

    fireEvent.keyDown(bulkPopover.querySelector('select') as HTMLSelectElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alterar 2 equipamentos selecionados' })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Opções de seleção de equipamentos' })).not.toBeInTheDocument());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('applies bulk changes through the existing callback and clears selection from the popover', async () => {
    const onBulkUpdate = vi.fn(async (ids: string[]) => ({ updated: ids.length, updatedIds: ids, failed: [], auditFailed: [], batchAuditFailed: false }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DeviceList devices={devices} search="" onSelect={vi.fn()} onEdit={vi.fn()} onNew={vi.fn()} onRetire={vi.fn()} canRetire={false} canEdit onBulkUpdate={onBulkUpdate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar equipamentos visíveis' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Selecionar todos os visíveis' }));
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'INACTIVE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar alterações' }));
    await waitFor(() => expect(onBulkUpdate).toHaveBeenCalledWith(['one', 'two'], { status: 'INACTIVE' }));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alterar 2 equipamentos selecionados' })).not.toBeInTheDocument());
    expect(screen.getByText('2 guardado(s).')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Router one' }));
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar equipamentos visíveis' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Editar 1 selecionado' }));
    fireEvent.click(screen.getByRole('button', { name: 'Limpar seleção' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alterar 1 equipamentos selecionados' })).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Selecionar Router one' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Selecionar Switch two' })).not.toBeChecked();
  });

  it('deselects visible devices without clearing selections outside the current view', async () => {
    const view = renderDeviceList();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Router one' }));
    view.rerender(<DeviceList devices={[devices[1]]} search="Switch" onSelect={vi.fn()} onEdit={vi.fn()} onNew={vi.fn()} onRetire={vi.fn()} canRetire={false} canEdit />);
    const trigger = screen.getByRole('button', { name: 'Selecionar equipamentos visíveis' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Selecionar todos os visíveis' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Alterar 2 equipamentos selecionados' }).querySelector('select') as HTMLSelectElement, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Alterar 2 equipamentos selecionados' })).not.toBeInTheDocument());
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Desselecionar visíveis' }));
    expect(screen.getByRole('checkbox', { name: 'Selecionar Switch two' })).not.toBeChecked();
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Opções de seleção de equipamentos' })).not.toBeInTheDocument());
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Editar 1 selecionado' })).toBeInTheDocument();
  });
});
