import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FilterChipBar, FilterChips } from './filter-chips';

afterEach(cleanup);

const options = [
  { value: 'ACTIVE', label: 'Ativo', count: 12 },
  { value: 'RETIRED', label: 'Retirado', count: 0 },
  { value: 'UNKNOWN', label: 'Desconhecido', count: undefined },
];

describe('FilterChips', () => {
  it('renders a named group with an "all" chip and one pressed chip per value, with counts', () => {
    render(<FilterChipBar><FilterChips label="Estado" value="ACTIVE" options={options} total={20} onChange={() => {}} /></FilterChipBar>);
    expect(screen.getByRole('group', { name: 'Filtros rápidos' })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Estado' });
    expect(within(group).getByRole('button', { name: /Todos\s*20/ })).toHaveAttribute('aria-pressed', 'false');
    expect(within(group).getByRole('button', { name: /Ativo\s*12/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: /Desconhecido\s*…/ })).toBeEnabled();
  });

  it('disables empty chips unless selected', () => {
    const { rerender } = render(<FilterChips label="Estado" value="" options={options} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Retirado/ })).toBeDisabled();
    rerender(<FilterChips label="Estado" value="RETIRED" options={options} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /Retirado/ })).toBeEnabled();
  });

  it('selects a chip, toggles it off, and "all" clears the filter', () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterChips label="Estado" value="" options={options} onChange={onChange} allLabel="Todas" />);
    fireEvent.click(screen.getByRole('button', { name: /Ativo/ }));
    expect(onChange).toHaveBeenLastCalledWith('ACTIVE');
    rerender(<FilterChips label="Estado" value="ACTIVE" options={options} onChange={onChange} allLabel="Todas" />);
    fireEvent.click(screen.getByRole('button', { name: /Ativo/ }));
    expect(onChange).toHaveBeenLastCalledWith('');
    fireEvent.click(screen.getByRole('button', { name: /Todas/ }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });
});
