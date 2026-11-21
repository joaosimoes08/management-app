import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyTopologyFilters } from './filters';
import { TopologyFiltersMenu, TopologyLegend } from './topology-filters-menu';

afterEach(cleanup);
const types = [{ value: 'SWITCH', label: 'Switch', count: 2 }, { value: 'ROUTER', label: 'Router', count: 1 }];
const locations = [{ value: 'Sede · Sala 1', label: 'Sede · Sala 1', count: 3 }];

describe('topology filters menu', () => {
  it('changes each filter and clears them', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TopologyFiltersMenu filters={emptyTopologyFilters} onChange={onChange} types={types} locations={locations} />);
    expect(screen.getByText('Filtros')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Switch (2)' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filtrar por tipo de equipamento'), { target: { value: 'ROUTER' } });
    expect(onChange).toHaveBeenLastCalledWith({ type: 'ROUTER', location: '', problem: '' });
    fireEvent.change(screen.getByLabelText('Filtrar por localização'), { target: { value: 'Sede · Sala 1' } });
    expect(onChange).toHaveBeenLastCalledWith({ type: '', location: 'Sede · Sala 1', problem: '' });
    fireEvent.change(screen.getByLabelText('Filtrar por estado de problemas'), { target: { value: 'problem' } });
    expect(onChange).toHaveBeenLastCalledWith({ type: '', location: '', problem: 'problem' });
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeDisabled();

    rerender(<TopologyFiltersMenu filters={{ type: 'ROUTER', location: '', problem: 'problem' }} onChange={onChange} types={types} locations={locations} />);
    expect(screen.getByText('Filtros (2)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(onChange).toHaveBeenLastCalledWith(emptyTopologyFilters);
  });

  it('disables the problem filter when alerts are unavailable', () => {
    render(<TopologyFiltersMenu filters={emptyTopologyFilters} onChange={vi.fn()} types={types} locations={locations} alertsUnavailable />);
    expect(screen.getByLabelText('Filtrar por estado de problemas')).toBeDisabled();
  });

  it('renders the legend with type counts and alert severities', () => {
    render(<TopologyLegend types={types} />);
    const legend = screen.getByRole('group', { name: 'Legenda do mapa' });
    expect(within(legend).getByText('Switch · 2')).toBeInTheDocument();
    expect(within(legend).getByText('Crítico')).toBeInTheDocument();
    expect(within(legend).getByText('Baixo / informativo')).toBeInTheDocument();
  });
});
