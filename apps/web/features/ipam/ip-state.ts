const stateLabels = new Map([
  ['FREE', 'Livre'],
  ['OCCUPIED', 'Ocupado'],
  ['RESERVED', 'Reservado'],
  ['EXCLUDED', 'Excluído'],
  ['UNKNOWN', 'Desconhecido'],
  ['REACHABLE', 'Acessível'],
  ['UNREACHABLE', 'Inacessível'],
]);

export function ipStateLabel(state?: string | null): string {
  return state ? stateLabels.get(state) ?? 'Desconhecido' : '—';
}

const hostStatusLabels = new Map([
  ['UNKNOWN', 'Desconhecido'],
  ['ACTIVE', 'Ativo'],
  ['INACTIVE', 'Inativo'],
  ['MAINTENANCE', 'Manutenção'],
  ['RETIRED', 'Retirado'],
]);

/** Manual status of a Host (the value stored in the API; labels only for display). */
export function hostStatusLabel(status?: string | null): string {
  return status ? hostStatusLabels.get(status) ?? 'Desconhecido' : '—';
}

const observedStatusLabels = new Map([
  ...stateLabels,
  ['OPEN', 'Aberto'],
  ['CLOSED', 'Fechado'],
  ['DEGRADED', 'Degradado'],
  ['DISABLED', 'Desativado'],
  ['ACTIVE', 'Ativo'],
]);

/** Observed or manual status of a Host service or observed Host status. */
export function observedStatusLabel(status?: string | null): string {
  return status ? observedStatusLabels.get(status) ?? 'Desconhecido' : '—';
}

const sourceLabels = new Map([
  ['MANUAL', 'Manual'],
  ['DISCOVERY', 'Descoberta'],
  ['SNMP', 'SNMP'],
  ['IMPORT', 'Importação'],
]);

/** Where a Host or service record came from. Unknown sources read as "Outra origem". */
export function sourceLabel(source?: string | null): string {
  return source ? sourceLabels.get(source) ?? 'Outra origem' : '—';
}
