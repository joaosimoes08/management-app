'use client';

import { translateMessage, useOptionalI18n } from '@/lib/i18n/i18n';
import type { ChangeEntityType, ChangeStatus, CheckItemResult, CloseStatus, ConflictWarning } from './api';

type Params = Record<string, string | number>;
/** `t(key, params)` for the change-plans screens; `params.count` picks the `.one` / `.other` form. */
export type ChangeT = (key: string, params?: Params, fallback?: string) => string;

/** The app's t(), or Portuguese (the source language) when rendered outside I18nProvider, as in unit tests. */
export function useChangeT(): ChangeT {
  const i18n = useOptionalI18n();
  return (key, params, fallback) => (i18n ? i18n.t(key, fallback, params) : translateMessage('pt-PT', key, fallback, params));
}

/** Labels of the shared label maps in workspace.ts, in the app language (an unknown value falls back to itself). */
export const statusText = (t: ChangeT, status: ChangeStatus) => t(`changePlans.status.${status}`, undefined, status);
export const statusTabText = (t: ChangeT, status: ChangeStatus) => t(`changePlans.statusTab.${status}`, undefined, status);
export const typeText = (t: ChangeT, type: ChangeEntityType) => t(`changePlans.type.${type}`, undefined, type);
export const closeText = (t: ChangeT, status: CloseStatus) => t(`changePlans.close.${status}`, undefined, status);
export const checkText = (t: ChangeT, result: CheckItemResult) => t(`changePlans.check.${result}`, undefined, result);
export const warningText = (t: ChangeT, code: ConflictWarning['code']) => t(`changePlans.warning.${code}`, undefined, code);
