export interface MissingConfigDevice {
  id: string;
  name: string;
  siteId?: string | null;
  /** Required config keys the device lacks, as the API registry names them (e.g. rearImage, powerPlugCount). */
  missing: string[];
}

export interface TopbarAlert {
  id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  detail: string;
  href: string;
  occurredAt: string;
  persistent?: boolean;
  /** DEVICE_MISSING_CONFIG: one grouped alert for every device missing a required config; clears itself when fixed. */
  kind?: string;
  /** Affected devices (may be a first page; `count` is the total). */
  devices?: MissingConfigDevice[];
  count?: number;
}

export const MISSING_CONFIG_ALERT_KIND = 'DEVICE_MISSING_CONFIG';

/** A missing-config alert is persistent: "Limpar todos" never hides it, fixing the devices does. */
export function isMissingConfigAlert(alert: Pick<TopbarAlert, 'id' | 'kind'>): boolean {
  return alert.kind === MISSING_CONFIG_ALERT_KIND || alert.id.startsWith('device-missing-config');
}

export interface TopbarState {
  environment: {
    state: 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE';
    setup?: { completed: boolean; completedAt?: string | null };
    services: { key: string; label: string; state: string }[];
  };
  alerts: TopbarAlert[];
  processes: { id: string; label: string; detail: string; state: string; href: string }[];
  updatedAt: string;
}

/** Fallback state when GET /dashboard/topbar-state fails. */
export const unavailableTopbarState = (): TopbarState => ({
  environment: {
    state: 'UNAVAILABLE',
    services: [
      { key: 'api', label: 'API', state: 'UNAVAILABLE' },
      { key: 'postgres', label: 'PostgreSQL', state: 'UNKNOWN' },
      { key: 'redis', label: 'Redis / BullMQ', state: 'UNKNOWN' },
    ],
  },
  alerts: [{
    id: 'environment-unavailable',
    severity: 'CRITICAL',
    title: 'Ambiente indisponível',
    detail: 'Não foi possível obter o estado dos serviços.',
    href: '/definicoes?tab=system',
    occurredAt: new Date().toISOString(),
  }],
  processes: [],
  updatedAt: new Date().toISOString(),
});
