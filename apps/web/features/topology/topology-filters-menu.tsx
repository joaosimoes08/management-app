'use client';

import { EquipmentTypeIcon } from '@/features/infrastructure/components/equipment-type-icon';
import { topologySeverityColor } from './alerts';
import { activeTopologyFilterCount, emptyTopologyFilters, topologyLegendSeverities, topologyProblemOptions, type TopologyFilterOption, type TopologyFilters, type TopologyProblemFilter } from './filters';
import { useUiText } from '@/components/ui/use-ui-text';

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
  const ui = useUiText();
  const active = activeTopologyFilterCount(filters);
  return <details className="topology-topbar-menu"><summary>{active ? `Filtros (${active})` : ui('topology.filtersMenu.filters')}</summary><div className="topology-topbar-form">
    <strong>{ui('topology.filtersMenu.filterMap')}</strong>
    <label>{ui('topology.filtersMenu.deviceType')}<select aria-label={ui('topology.filtersMenu.filterByDeviceType')} value={filters.type} onChange={(event) => onChange({ ...filters, type: event.target.value })}><option value="">{ui('topology.filtersMenu.allTypes')}</option>{types.map((option) => <option key={option.value} value={option.value}>{`${option.label} (${option.count})`}</option>)}</select></label>
    <label>{ui('topology.filtersMenu.location')}<select aria-label={ui('topology.filtersMenu.filterByLocation')} value={filters.location} onChange={(event) => onChange({ ...filters, location: event.target.value })}><option value="">{ui('topology.filtersMenu.allLocations')}</option>{locations.map((option) => <option key={option.value} value={option.value}>{`${option.label} (${option.count})`}</option>)}</select></label>
    <label>{ui('topology.filtersMenu.problemState')}<select aria-label={ui('topology.filtersMenu.filterByProblemState')} value={filters.problem} disabled={alertsUnavailable} onChange={(event) => onChange({ ...filters, problem: event.target.value as TopologyProblemFilter })}>{topologyProblemOptions.map(([value, label]) => <option key={value || 'all'} value={value}>{ui(label)}</option>)}</select></label>
    {alertsUnavailable && <small>{ui('topology.filtersMenu.alertsUnavailableTheProblemFilter')}</small>}
    <button type="button" className="secondary-button" disabled={!active} onClick={() => onChange(emptyTopologyFilters)}>{ui('topology.filtersMenu.clearFilters')}</button>
  </div></details>;
}

/** Toolbar dropdown explaining node icons and alert badge colours. */
export function TopologyLegend({ types }: { types: TopologyFilterOption[] }) {
  const ui = useUiText();
  return <details className="topology-topbar-menu topology-legend-menu"><summary>{ui('topology.filtersMenu.legend')}</summary><div className="topology-topbar-form" role="group" aria-label={ui('topology.filtersMenu.mapLegend')}>
    <strong>{ui('topology.filtersMenu.deviceTypes')}</strong>
    {types.length ? <div className="snmp-chart-legend">{types.map((option) => <span key={option.value}><EquipmentTypeIcon type={option.value} alt="" />{`${option.label} · ${option.count}`}</span>)}</div> : <small>{ui('topology.filtersMenu.noDevicesOnTheMap')}</small>}
    <strong>{ui('topology.filtersMenu.activeAlerts')}</strong>
    <div className="snmp-chart-legend">{topologyLegendSeverities.map(([severity, label]) => <span key={severity}><i style={{ background: topologySeverityColor(severity) }} />{ui(label)}</span>)}</div>
    <small>{ui('topology.filtersMenu.devicesWithActiveAlertsShow')}</small>
  </div></details>;
}
