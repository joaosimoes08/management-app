import { translateMessage, useOptionalI18n } from '@/lib/i18n/i18n';

type UiText = (key: string, fallback?: string, params?: Record<string, string | number>) => string;
const portugueseText: UiText = (key, fallback, params) => translateMessage('pt-PT', key, fallback, params);

/**
 * t() for shared UI (dialogs, toasts, menus, paging). It follows the active language inside
 * I18nProvider and falls back to the Portuguese copy outside it, so the shared components keep
 * their labels when rendered alone. It imports the i18n module directly, not the '@/lib/i18n'
 * entry, so page tests that stub useI18n with keys still see real labels here.
 */
export function useUiText(): UiText {
  return useOptionalI18n()?.t ?? portugueseText;
}
