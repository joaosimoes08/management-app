import type { DiscoveryJob } from './api';

/** Discovery P0: words shown for a run's status. The API keeps the English enum; the screen never shows it raw. */
export const discoveryStatusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  RUNNING: 'Em execução',
  COMPLETED: 'Concluída',
  FAILED: 'Falhada',
  CANCELLED: 'Cancelada',
  QUEUED: 'Na fila',
};

export function discoveryStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return discoveryStatusLabels[status.trim().toUpperCase()] ?? status;
}

/** "1 resultado", "0 resultados", "12 resultados". */
export function formatResultCount(count: number): string {
  return count === 1 ? '1 resultado' : `${count} resultados`;
}

/**
 * Why a run failed, in words. The worker stores a code in `errorMessage` (policy codes, network error codes, or
 * DISCOVERY_EXECUTION_FAILED); unknown codes are shown as they are so nothing is hidden.
 */
const failureReasons: Record<string, string> = {
  DISCOVERY_TARGET_NOT_ALLOWED: 'A subnet não está nas redes autorizadas para Discovery. Um administrador pode acrescentá-la nas Definições.',
  DISCOVERY_TARGET_FORBIDDEN: 'A subnet pertence a uma rede especial que não pode ser analisada.',
  DISCOVERY_CIDR_INVALID: 'O CIDR da subnet não é válido.',
  DISCOVERY_IPV6_UNSUPPORTED: 'A descoberta ainda não suporta subnets IPv6.',
  DISCOVERY_CONFIGURATION_INVALID: 'Configuração inválida: escolhe pelo menos um método e, para TCP, pelo menos uma porta.',
  DISCOVERY_PORT_LIMIT: 'Foram pedidas mais portas TCP do que o máximo permitido (64).',
  DISCOVERY_JOB_NOT_FOUND: 'A execução deixou de existir.',
  DISCOVERY_QUEUE_UNAVAILABLE: 'A fila de descoberta não estava disponível. Confirma que o worker e o Redis estão a correr.',
  DISCOVERY_EXECUTION_FAILED: 'O worker falhou durante a análise depois de esgotar as tentativas.',
  ECONNRESET: 'A ligação à base de dados ou à fila foi interrompida.',
  ECONNREFUSED: 'A base de dados ou a fila recusou a ligação.',
  ETIMEDOUT: 'A ligação à base de dados ou à fila excedeu o tempo limite.',
};

/** A stored error code in words; unknown codes come back unchanged. */
export function describeDiscoveryError(code: string): string {
  const trimmed = code.trim();
  return failureReasons[trimmed] ?? stopReasons[trimmed] ?? trimmed;
}

/** Schedules store how the last scheduled run stopped in `lastError` too. */
const stopReasons: Record<string, string> = {
  CANCELLED: 'A execução foi cancelada.',
  LIMIT_DURATION: 'A execução parou no limite de duração.',
  LIMIT_PROBES: 'A execução parou no limite de sondas.',
};

export function discoveryFailureReason(job: Pick<DiscoveryJob, 'status' | 'errorMessage'>): string | null {
  if (job.status !== 'FAILED') return null;
  const code = job.errorMessage?.trim();
  if (!code) return 'A execução falhou sem indicar o motivo.';
  return describeDiscoveryError(code);
}

/** Share of addresses already scanned, 0–100, or null when the run has no known size yet. */
export function discoveryProgressPercent(job: Pick<DiscoveryJob, 'totalCount' | 'processedCount'>): number | null {
  if (!job.totalCount || job.totalCount <= 0) return null;
  const done = Math.min(Math.max(job.processedCount ?? 0, 0), job.totalCount);
  return Math.floor((done / job.totalCount) * 100);
}

export function isActiveDiscoveryJob(job: Pick<DiscoveryJob, 'status'>): boolean {
  return job.status === 'RUNNING' || job.status === 'PENDING';
}
