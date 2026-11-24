'use client';

import { FormEvent, useId, useState } from 'react';
import { Check, Info, RotateCcw } from 'lucide-react';
import { useUiText } from '@/components/ui/use-ui-text';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { formatDateTime, formatNumber } from '@/lib/format/date';
import { LIMIT_FIELDS, LIMIT_RULES, bodyFromDraft, draftFrom, type DeviceHealthThresholds, type LimitDraft, type LimitError, type LimitField, type Limits, type SiteHealthThresholds } from './thresholds-api';

type UiText = ReturnType<typeof useUiText>;
type Data = SiteHealthThresholds | DeviceHealthThresholds;

const isDevice = (data: Data): data is DeviceHealthThresholds => 'deviceId' in data;
const ownOverride = (data: Data) => (isDevice(data) ? data.device : data.site);

/** "90%", "5 min", "60 °C", "10/min"; null = the limit is off. */
export function formatLimit(t: UiText, field: LimitField, value: number | null | undefined) {
  if (value === null || value === undefined) return t('healthLimits.off');
  const unit = LIMIT_RULES[field].unit;
  const number = formatNumber(value, { maximumFractionDigits: 1 });
  return unit === '%' || unit === '/min' ? `${number}${unit}` : `${number} ${unit}`;
}

/** What a field falls back to when it is left empty: the Site override (device scope only), then the default. */
function inheritedValue(data: Data, field: LimitField): { value: number | null; source: 'SITE' | 'DEFAULT' } {
  if (isDevice(data) && data.site && data.site[field] !== null) return { value: data.site[field], source: 'SITE' };
  return { value: data.defaults[field], source: 'DEFAULT' };
}

function ReadOnlyNote() {
  const t = useUiText();
  return <p className="panel-description alert-readonly-note" role="note"><Info size={13} aria-hidden="true" /> {t('healthLimits.readOnly')}</p>;
}

export const healthThresholdsEditorKey = (data: Data) => `${isDevice(data) ? data.deviceId : data.siteId}:${ownOverride(data)?.updatedAt ?? 'none'}`;

/** Read-only table: limit, value in effect, where it comes from, and the default beside it. */
function LimitsTable({ data }: { data: Data }) {
  const t = useUiText();
  return <div className="health-limits-table-wrap"><table className="health-limits-table">
    <thead><tr><th scope="col">{t('healthLimits.col.limit')}</th><th scope="col">{t('healthLimits.col.effective')}</th><th scope="col">{t('healthLimits.col.source')}</th><th scope="col">{t('healthLimits.col.default')}</th></tr></thead>
    <tbody>{LIMIT_FIELDS.map((field) => <tr key={field}>
      <th scope="row">{t(`healthLimits.field.${field}`)}</th>
      <td>{formatLimit(t, field, data.effective[field])}</td>
      <td>{t(`healthLimits.source.${data.sources[field]}`)}</td>
      <td>{formatLimit(t, field, data.defaults[field])}</td>
    </tr>)}</tbody>
  </table></div>;
}

const errorText = (t: UiText, error: LimitError) => error.key === 'range'
  ? t('healthLimits.error.range', undefined, { min: formatNumber(LIMIT_RULES[error.field].min), max: formatNumber(LIMIT_RULES[error.field].max) })
  : t(`healthLimits.error.${error.key}`);

/**
 * Health alert limits for one Site or one device (PR #174 contract). An empty field inherits; Joao's defaults are shown
 * next to every field, each field has its own "Repor predefinição", and the whole override can be cleared (PUT {}).
 * Users who may not edit get the same values as a table and the read-only note. Render it with
 * `key={healthThresholdsEditorKey(data)}` so a new target or a saved override starts a fresh draft.
 */
export function HealthThresholdsEditor({ data, canEdit, onSave, formId: fixedFormId, actionsInToolbar = false }: { data: Data; canEdit: boolean; onSave: (body: Partial<Limits>) => Promise<void>; formId?: string; actionsInToolbar?: boolean }) {
  const t = useUiText();
  const generatedId = useId();
  const formId = fixedFormId ?? generatedId;
  const { confirm, confirmDialog } = useConfirm();
  const override = ownOverride(data);
  const [draft, setDraft] = useState<LimitDraft>(() => draftFrom(override));
  const [errors, setErrors] = useState<LimitError[]>([]);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const device = isDevice(data);

  if (!canEdit) return <div className="health-limits">
    <ReadOnlyNote />
    <LimitsTable data={data} />
    {override && <p className="panel-description">{t('healthLimits.updated', undefined, { date: formatDateTime(override.updatedAt) })}</p>}
  </div>;

  const saved = draftFrom(override);
  const dirty = LIMIT_FIELDS.some((field) => draft[field].trim() !== saved[field]);

  const run = async (body: Partial<Limits>) => {
    setSaving(true); setFailure('');
    try { await onSave(body); } catch (cause) { setFailure(cause instanceof Error ? cause.message : t('healthLimits.saveError')); } finally { setSaving(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = bodyFromDraft(draft);
    setErrors(result.errors);
    if (result.errors.length) return;
    await run(result.body);
  };
  const resetAll = async () => {
    if (!await confirm({ message: t(device ? 'healthLimits.resetConfirmDevice' : 'healthLimits.resetConfirmSite'), confirmLabel: t('healthLimits.resetAll') })) return;
    setErrors([]);
    await run({});
  };

  // Settings puts its saves in the utility bar (outside the form, hence form=); Device 360 keeps them under the fields.
  const actions = <>
    {override && <button type="button" className="secondary-button" disabled={saving} onClick={() => void resetAll()}><RotateCcw size={14} aria-hidden="true" /> {t('healthLimits.resetAll')}</button>}
    <button type="submit" form={formId} className="primary-button" disabled={saving || !dirty}><Check size={14} aria-hidden="true" /> {saving ? t('healthLimits.saving') : t('healthLimits.save')}</button>
  </>;

  return <form id={formId} className="health-limits" onSubmit={submit} noValidate>
    <p className="panel-description">{t(device ? 'healthLimits.deviceHint' : 'healthLimits.siteHint')}</p>
    {failure && <div className="ipam-alert error" role="alert">{failure}</div>}
    {errors.length > 0 && <p className="ipam-scope-note" role="alert">{t('healthLimits.fixErrors')}</p>}
    <div className="health-limits-grid">
      {LIMIT_FIELDS.map((field) => {
        const rule = LIMIT_RULES[field];
        const inherited = inheritedValue(data, field);
        const error = errors.find((item) => item.field === field);
        const hintId = `${formId}-${field}-hint`; const errorId = `${formId}-${field}-error`;
        const label = t(`healthLimits.field.${field}`);
        return <div className="health-limit-row" key={field} data-field={field}>
          <label htmlFor={`${formId}-${field}`}>{label} <span className="health-limit-unit">({rule.unit})</span></label>
          <div className="health-limit-control">
            <input id={`${formId}-${field}`} type="number" inputMode="decimal" min={rule.min} max={rule.max} step={rule.step} value={draft[field]}
              placeholder={t('healthLimits.inherit', undefined, { value: formatLimit(t, field, inherited.value) })}
              aria-invalid={error ? true : undefined} aria-describedby={error ? `${hintId} ${errorId}` : hintId}
              onChange={(event) => { setDraft({ ...draft, [field]: event.target.value }); setErrors((current) => current.filter((item) => item.field !== field)); }} />
            {draft[field].trim() !== '' && <button type="button" className="text-button health-limit-reset" aria-label={t('healthLimits.resetFieldLabel', undefined, { field: label })} onClick={() => { setDraft({ ...draft, [field]: '' }); setErrors((current) => current.filter((item) => item.field !== field)); }}><RotateCcw size={12} aria-hidden="true" /> {t('healthLimits.resetField')}</button>}
          </div>
          <small id={hintId} className="health-limit-hint">
            {t('healthLimits.default', undefined, { value: formatLimit(t, field, data.defaults[field]) })}
            {device && data.site && data.site[field] !== null && <> · {t('healthLimits.siteValue', undefined, { value: formatLimit(t, field, data.site[field]) })}</>}
            {' · '}{t('healthLimits.effective', undefined, { value: formatLimit(t, field, data.effective[field]), source: t(`healthLimits.source.${data.sources[field]}`) })}
          </small>
          {error && <small id={errorId} className="health-limit-error">{errorText(t, error)}</small>}
        </div>;
      })}
    </div>
    <p className="panel-description health-limits-note">{t('healthLimits.temperatureNote')}</p>
    {override && <p className="panel-description">{t('healthLimits.updated', undefined, { date: formatDateTime(override.updatedAt) })}</p>}
    {actionsInToolbar ? <PageToolbarPortal>{actions}</PageToolbarPortal> : <div className="form-actions health-limits-actions">{actions}</div>}
    {confirmDialog}
  </form>;
}
