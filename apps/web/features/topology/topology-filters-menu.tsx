'use client';

import { EquipmentTypeIcon } from '@/features/infrastructure/components/equipment-type-icon';
import { topologySeverityColor } from './alerts';
import { activeTopologyFilterCount, emptyTopologyFilters, topologyLegendSeverities, topologyProblemOptions, type TopologyFilterOption, type TopologyFilters, type TopologyProblemFilter } from './filters';

type FiltersProps = {
  filters: TopologyFilters;
  onChange: (filters: TopologyFilters) => void;
  types: TopologyFilterOption[];
  locations: TopologyFilterOption[];
  /** Alerts failed to load: the problem filter cannot be trusted. */
  alertsUnavailable?: boolean;
};

/** Toolbar dropdown with the map filters (device type, location, problem state). */
export function TopologyFiltersMenu({ filters, onChange, types, locations, alertsUnavailable = false }: FiltersProps) {
  const active = activeTopologyFilterCount(filters);
  return <details className="topology-topbar-menu"><summary>{active ? `Filtros (${active})` : 'Filtros'}</summary><div className="topology-topbar-form">
    <strong>Filtrar mapa</strong>
    <label>Tipo de equipamento<select aria-label="Filtrar por tipo de equipamento" value={filters.type} onChange={(event) => onChange({ ...filters, type: event.target.value })}><option value="">Todos os tipos</option>{types.map((option) => <option key={option.value} value={option.value}>{`${option.label} (${option.count})`}</option>)}</select></label>
    <label>Localização<select aria-label="Filtrar por localização" value={filters.location} onChange={(event) => onChange({ ...filters, location: event.target.value })}><option value="">Todas as localizações</option>{locations.map((option) => <option key={option.value} value={option.value}>{`${option.label} (${option.count})`}</option>)}</select></label>
    <label>Estado de problemas<select aria-label="Filtrar por estado de problemas" value={filters.problem} disabled={alertsUnavailable} onChange={(event) => onChange({ ...filters, problem: event.target.value as TopologyProblemFilter })}>{topologyProblemOptions.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}</select></label>
    {alertsUnavailable && <small>Alertas indisponíveis: o filtro de problemas está desativado.</small>}
    <button type="button" className="secondary-button" disabled={!active} onClick={() => onChange(emptyTopologyFilters)}>Limpar filtros</button>
  </div></details>;
}

/** Toolbar dropdown explaining node icons and alert badge colours. */
export function TopologyLegend({ types }: { types: TopologyFilterOption[] }) {
  return <details className="topology-topbar-menu"><summary>Legenda</summary><div className="topology-topbar-form" role="group" aria-label="Legenda do mapa">
    <strong>Tipos de equipamento</strong>
    {types.length ? <div className="snmp-chart-legend">{types.map((option) => <span key={option.value}><EquipmentTypeIcon type={option.value} alt="" />{`${option.label} · ${option.count}`}</span>)}</div> : <small>Sem equipamentos no mapa.</small>}
    <strong>Alertas ativos</strong>
    <div className="snmp-chart-legend">{topologyLegendSeverities.map(([severity, label]) => <span key={severity}><i style={{ background: topologySeverityColor(severity) }} />{label}</span>)}</div>
    <small>Os equipamentos com alertas ativos mostram um selo com o número de alertas, na cor da severidade mais alta.</small>
  </div></details>;
}
