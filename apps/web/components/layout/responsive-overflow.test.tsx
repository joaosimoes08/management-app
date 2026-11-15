import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ResponsiveOverflowMenu, ResponsiveToolbarActions, visibleActionIndexes, visibleEqualSlotIndexes, visibleOverflowIndexes } from './responsive-overflow';

afterEach(cleanup);

describe('responsive shell overflow priorities', () => {
  it('keeps the active tab visible and moves trailing tabs to the overflow menu', () => {
    expect(visibleOverflowIndexes([70, 80, 90, 100], 2, 220)).toEqual([0, 2]);
  });

  it('keeps every tab directly visible when the navigation fits', () => {
    expect(visibleOverflowIndexes([70, 80, 90], 1, 250)).toEqual([0, 1, 2]);
  });

  it('never sends the active tab into the overflow menu', () => {
    expect(visibleOverflowIndexes([100, 80], 0, 80)).toEqual([0]);
  });

  it('accounts for navigation gaps, horizontal padding, and the overflow control at the fit boundary', () => {
    const widths = [70, 70, 70];
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(215);
    expect(visibleOverflowIndexes(widths, 0, 215, 36, 6, 6, 4)).toEqual([0, 1]);
    expect(visibleOverflowIndexes(widths, 0, 228, 36, 6, 6, 4)).toEqual([0, 1, 2]);
  });

  it('moves tabs into overflow before equal-width slots become narrower than their labels', () => {
    const labelWidths = [56, 69.7, 60, 48, 59, 40, 54];
    expect(visibleEqualSlotIndexes(labelWidths, 0, 394, 36, 4, 6, 4)).toEqual([0, 1, 2, 3]);
    expect(visibleEqualSlotIndexes(labelWidths, 0, 410, 36, 4, 6, 4)).toEqual([0, 1, 2, 3]);
    expect(visibleEqualSlotIndexes(labelWidths, 0, 411, 36, 4, 6, 4)).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps a wider active label visible when earlier tabs must move to overflow', () => {
    const labelWidths = [56, 69.7, 60, 48, 59, 40, 54];
    expect(visibleEqualSlotIndexes(labelWidths, 1, 394, 36, 4, 6, 4)).toContain(1);
  });

  it('includes restored tab icons in each equal-slot minimum width at the boundary', () => {
    const labelAndIconWidths = [74, 87, 78, 66, 76, 57, 71];
    const atFiveSlotBoundary = 5 * 87 + 4 * 4 + 6 + 36 + 4;
    expect(visibleEqualSlotIndexes(labelAndIconWidths, 0, atFiveSlotBoundary - 1, 36, 4, 6, 4)).toEqual([0, 1, 2, 3]);
    expect(visibleEqualSlotIndexes(labelAndIconWidths, 0, atFiveSlotBoundary, 36, 4, 6, 4)).toEqual([0, 1, 2, 3, 4]);
  });

  it('preserves primary toolbar actions and moves secondary actions into the menu first', () => {
    expect(visibleActionIndexes([60, 70, 90], [false, true, false], 150)).toEqual([1]);
  });

  it('keeps the primary Dashboard discovery action visible ahead of secondary actions when space is tight', () => {
    const widths = [92, 74, 82, 116, 145];
    const primary = [false, false, false, true, false];
    expect(visibleActionIndexes(widths, primary, 155)).toEqual([3]);
  });

  it('keeps Dashboard discovery visible and operable in a narrow 360px actions row', async () => {
    const discovery = vi.fn();
    const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.classList.contains('responsive-toolbar-actions') ? 360 : 0; } });
    HTMLElement.prototype.getBoundingClientRect = function () {
      const measured = this.classList.contains('responsive-overflow-measure-item');
      const control = this.firstElementChild as HTMLElement | null;
      const widths: Record<string, number> = { Refresh: 92, Settings: 74, 'Nova descoberta': 145, 'Mais ações': 50 };
      const width = measured && control ? widths[control.textContent?.trim() ?? ''] ?? 120 : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 36, width, height: 36, toJSON: () => ({}) } as DOMRect;
    };
    try {
      render(<div style={{ width: 360 }}><ResponsiveToolbarActions>{[
        <button key="refresh" className="secondary-button">Refresh</button>,
        <button key="settings" className="secondary-button">Settings</button>,
        <button key="discovery" className="primary-button" onClick={discovery}>Nova descoberta</button>,
        <button key="add" className="secondary-button">Adicionar equipamento</button>,
      ]}</ResponsiveToolbarActions></div>);
      const actions = document.querySelector('.responsive-toolbar-actions') as HTMLElement;
      await waitFor(() => expect(within(actions).getByRole('button', { name: 'Nova descoberta' })).toBeVisible());
      fireEvent.click(within(actions).getByRole('button', { name: 'Nova descoberta' }));
      expect(discovery).toHaveBeenCalledOnce();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      if (originalClientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidth);
      else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
  });

  it('keeps all toolbar actions inline when they fit', () => {
    expect(visibleActionIndexes([60, 70, 90], [false, true, false], 240)).toEqual([0, 1, 2]);
  });

  it('preserves child button semantics, invokes its action, and closes with Escape', () => {
    const action = vi.fn();
    render(<ResponsiveOverflowMenu label="Mais secções" onSelect={() => {}}>{[<button key="devices" onClick={action}>Equipamentos</button>]}</ResponsiveOverflowMenu>);
    const trigger = screen.getByRole('button', { name: 'Mais secções' });
    fireEvent.click(trigger);
    expect(screen.getByRole('group', { name: 'Mais secções' })).toBeInTheDocument();
    const actionButton = screen.getByRole('button', { name: 'Equipamentos' });
    expect(actionButton).not.toHaveAttribute('role');
    fireEvent.click(actionButton);
    expect(action).toHaveBeenCalledOnce();
    expect(screen.queryByRole('group', { name: 'Mais secções' })).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('group', { name: 'Mais secções' }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Mais secções' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('supports arrow, Home, and End navigation without changing native child roles', () => {
    render(<ResponsiveOverflowMenu label="Mais ações" onSelect={() => {}}>{[
      <button key="one">First</button>,
      <a key="two" href="/second">Second</a>,
      <button key="three" role="switch" aria-checked="false">Third</button>,
    ]}</ResponsiveOverflowMenu>);
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    const first = screen.getByRole('button', { name: 'First' });
    const second = screen.getByRole('link', { name: 'Second' });
    const third = screen.getByRole('switch', { name: 'Third' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second, { key: 'ArrowDown' });
    expect(third).toHaveFocus();
    fireEvent.keyDown(third, { key: 'Home' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'End' });
    expect(third).toHaveFocus();
  });

  it('keeps the overflow open while a nested native select is operated', () => {
    const onSelect = vi.fn();
    render(<ResponsiveOverflowMenu label="Mais ações" onSelect={onSelect}>{[
      <label key="workspace">Workspace<select aria-label="Workspace"><option value="one">One</option><option value="two">Two</option></select></label>,
    ]}</ResponsiveOverflowMenu>);
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações' }));
    const select = screen.getByRole('combobox', { name: 'Workspace' });
    fireEvent.change(select, { target: { value: 'two' } });
    expect(select).toHaveValue('two');
    expect(screen.getByRole('group', { name: 'Mais ações' })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
