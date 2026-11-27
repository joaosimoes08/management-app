/**
 * Plain-language meaning of alert severities and sources, shared by the dashboard card,
 * the /alertas list and the rule form. Codes stay as secondary text so operators can still
 * match them with rules and logs.
 */
import { entityHref } from '@/lib/routes';

export const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'WARNING', 'INFO'] as const;

export const alertStatusLabels: Record<string, string> = { OPEN: 'Aberto', ACKNOWLEDGED: 'Reconhecido', SNOOZED: 'Adiado', RESOLVED: 'Resolvido' };

export const severityNames: Record<string, string> = { CRITICAL: 'Crítico', HIGH: 'Alto', MEDIUM: 'Médio', WARNING: 'Aviso', LOW: 'Baixo', INFO: 'Info' };

/** What each severity means for the operator, in one line. */
export const severityMeanings: Record<string, string> = {
  CRITICAL: 'Serviço em baixo ou em risco imediato. Atuar já.',
  HIGH: 'Degradação com impacto provável. Tratar hoje.',
  WARNING: 'Sinal a acompanhar, sem impacto imediato.',
  INFO: 'Apenas informativo. Não requer ação.',
};

export const severityName = (severity: string) => severityNames[severity.toUpperCase()] ?? severity;

/** Portuguese name of each source the back end raises. Unknown sources show their code. */
export const alertSourceLabels: Record<string, string> = {
  SNMP_TRAP: 'Trap SNMP recebido',
  SNMP_TRAP_SOURCE: 'Traps SNMP não aceites',
  SNMP_INTERFACE: 'Estado de interface',
  SNMP_POLL: 'Recolha SNMP e equipamento inacessível',
  SNMP_DRIFT: 'Diferença de configuração',
  CAPACITY: 'Capacidade',
  DISCOVERY: 'Descoberta',
  INVENTORY_QUALITY: 'Qualidade do inventário',
  SYSTEM_HEALTH: 'Saúde do sistema',
  SNMP_HEALTH: 'Saúde do equipamento',
};

export const alertSourceLabel = (source: string) => alertSourceLabels[source] ?? source;

/** The one next step for each kind of alert. */
const nextSteps: Record<string, string> = {
  SNMP_TRAP: 'Abre o equipamento e confirma o evento que enviou.',
  SNMP_TRAP_SOURCE: 'Confirma que o IP de origem é o IP de gestão de um equipamento e que a credencial TRAP (SNMPv3) e o Engine ID batem certo.',
  SNMP_INTERFACE: 'Verifica a interface e a ligação física no equipamento.',
  SNMP_POLL: 'Confirma que o equipamento responde a SNMP e que as credenciais estão certas.',
  SNMP_DRIFT: 'Compara a configuração recolhida com o inventário e aceita ou corrige a diferença.',
  CAPACITY: 'Revê a utilização e planeia a expansão antes de esgotar.',
  DISCOVERY: 'Revê os resultados da descoberta e importa ou ignora o que foi encontrado.',
  INVENTORY_QUALITY: 'Abre a fila de qualidade e corrige os dados em falta.',
  SYSTEM_HEALTH: 'Verifica o estado dos serviços em Sistema.',
  SNMP_HEALTH: 'Abre o equipamento e revê os valores de saúde SNMP (CPU, memória, temperatura, fontes e ventoinhas).',
};
export const DEFAULT_NEXT_STEP = 'Abre o alerta e revê o detalhe.';

/**
 * Alerts that share a source but need a different next step. The device-unreachable alert (#145) is an SNMP_POLL
 * alert whose dedup key is `snmp:unreachable:<deviceId>`; alert rules still match it as SNMP_POLL.
 */
export const UNREACHABLE_DEDUP_PREFIX = 'snmp:unreachable:';
type Kinded = { source?: string | null; dedupKey?: string | null };
export const isUnreachableAlert = (alert: Kinded) => alert.source === 'SNMP_POLL' && Boolean(alert.dedupKey?.startsWith(UNREACHABLE_DEDUP_PREFIX));
const UNREACHABLE_LABEL = 'Equipamento inacessível';
const UNREACHABLE_NEXT_STEP = 'Confirma que o equipamento está ligado e alcançável a partir do servidor, e que a credencial SNMP está certa. Resolve-se sozinho no próximo poll com sucesso.';

/** Plain label for one alert: its source, or the more specific kind (Equipamento inacessível). */
export const alertKindLabel = (alert: Kinded & { source: string }) => (isUnreachableAlert(alert) ? UNREACHABLE_LABEL : alertSourceLabel(alert.source));

/** Next step for a source, or for one alert when given the alert (so the unreachable alert gets its own). */
export function alertNextStep(alert?: string | Kinded | null): string {
  if (!alert) return DEFAULT_NEXT_STEP;
  if (typeof alert === 'string') return nextSteps[alert] || DEFAULT_NEXT_STEP;
  if (isUnreachableAlert(alert)) return UNREACHABLE_NEXT_STEP;
  return (alert.source && nextSteps[alert.source]) || DEFAULT_NEXT_STEP;
}

type Linkable = { source?: string | null; actionHref?: string | null; href?: string | null; relatedDeviceId?: string | null; siteId?: string | null };

/**
 * Where the alert title leads. Trap alerts, and alerts with no link of their own, open the
 * device (Device 360) when it is known; other alerts keep their own, more specific link
 * (a drift, a job). A trap from an unknown device keeps its link (usually /snmp).
 */
export function alertTargetHref(alert: Linkable): string | null {
  const own = alert.actionHref ?? alert.href ?? null;
  if (alert.relatedDeviceId && (alert.source === 'SNMP_TRAP' || !own)) return deviceHref(alert.relatedDeviceId, alert.siteId);
  return own;
}

export const deviceHref = (deviceId: string, siteId?: string | null) => entityHref({ kind: 'device', id: deviceId, siteId: siteId ?? undefined });

/** Snooze choices offered by the row and bulk actions. */
export const SNOOZE_CHOICES = [
  { hours: 1, label: '1 hora' },
  { hours: 4, label: '4 horas' },
  { hours: 24, label: '24 horas' },
] as const;
