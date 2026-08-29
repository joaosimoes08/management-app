export interface TopbarState {
  environment: {
    state: 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE';
    setup?: { completed: boolean; completedAt?: string | null };
    services: { key: string; label: string; state: string }[];
  };
  alerts: { id: string; severity: 'CRITICAL' | 'WARNING' | 'INFO'; title: string; detail: string; href: string; occurredAt: string }[];
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
