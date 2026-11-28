import { translateMessage } from '@/lib/i18n/i18n';

/** The t() shape of useUiText(), for infrastructure helpers that run outside a component. */
export type InfrastructureText = (key: string, fallback?: string, params?: Record<string, string | number>) => string;

/** Portuguese copy: the default of the helpers, so callers outside the provider keep the old labels. */
export const portugueseText: InfrastructureText = (key, fallback, params) => translateMessage('pt-PT', key, fallback, params);
