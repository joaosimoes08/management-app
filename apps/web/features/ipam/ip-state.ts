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
