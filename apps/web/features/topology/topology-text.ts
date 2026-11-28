import { translateMessage } from '@/lib/i18n/i18n';

/** The t() shape of useUiText(), for topology helpers that run outside a component. */
export type TopologyText = (key: string, fallback?: string, params?: Record<string, string | number>) => string;
export const portugueseText: TopologyText = (key, fallback, params) => translateMessage('pt-PT', key, fallback, params);
