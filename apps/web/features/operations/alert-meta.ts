/**
 * Plain-language meaning of alert severities and sources, shared by the dashboard card,
 * the /alertas list and the rule form. Codes stay as secondary text so operators can still
 * match them with rules and logs.
 */
import { entityHref } from '@/components/data-table/entity-link';

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
  SNMP_INTERFACE: 'Estado de interface',
  SNMP_POLL: 'Recolha SNMP',
  SNMP_DRIFT: 'Diferença de configuração',
  CAPACITY: 'Capacidade',
  DISCOVERY: 'Descoberta',
  INVENTORY_QUALITY: 'Qualidade do inventário',
  SYSTEM_HEALTH: 'Saúde do sistema',
};

export const alertSourceLabel = (source: string) => alertSourceLabels[source] ?? source;

/** The one next step for each kind of alert. */
const nextSteps: Record<string, string> = {
  SNMP_TRAP: 'Abre o equipamento e confirma o evento que enviou.',
  SNMP_INTERFACE: 'Verifica a interface e a ligação física no equipamento.',
  SNMP_POLL: 'Confirma que o equipamento responde a SNMP e que as credenciais estão certas.',
  SNMP_DRIFT: 'Compara a configuração recolhida com o inventário e aceita ou corrige a diferença.',
  CAPACITY: 'Revê a utilização e planeia a expansão antes de esgotar.',
  DISCOVERY: 'Revê os resultados da descoberta e importa ou ignora o que foi encontrado.',
  INVENTORY_QUALITY: 'Abre a fila de qualidade e corrige os dados em falta.',
  SYSTEM_HEALTH: 'Verifica o estado dos serviços em Sistema.',
};
export const DEFAULT_NEXT_STEP = 'Abre o alerta e revê o detalhe.';

export const alertNextStep = (source?: string | null) => (source && nextSteps[source]) || DEFAULT_NEXT_STEP;

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
