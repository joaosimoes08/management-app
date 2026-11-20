'use client';

import { useI18n } from '@/lib/i18n';
import { inheritedPlugCount, inheritedWatts, MAX_POWER_PLUGS } from '../../power';
import type { DeviceForm } from '../../forms';
import type { DeviceModel, WattsSource } from '../../types';

export interface DevicePowerFieldsProps {
  form: Pick<DeviceForm, 'type' | 'modelId' | 'powerPlugCount' | 'estimatedWatts'>;
  models: DeviceModel[];
  onChange: (patch: Pick<DeviceForm, 'powerPlugCount' | 'estimatedWatts'>) => void;
}

/**
 * Device form "Fontes / fichas" and "Consumo estimado (W)". Empty fields inherit from the model, then from the defaults;
 * the placeholder shows the inherited value and the chip says where the value in use comes from.
 */
export function DevicePowerFields({ form, models, onChange }: DevicePowerFieldsProps) {
  const { t } = useI18n();
  const model = models.find((item) => item.id === form.modelId) ?? null;
  const plugs = form.powerPlugCount ?? '';
  const watts = form.estimatedWatts ?? '';
  const inherited = inheritedWatts(form.type, model);
  const source: WattsSource = watts.trim() !== '' ? 'manual' : inherited.source;
  const sourceLabel = (value: WattsSource) => t(`power.source.${value}`, value === 'manual' ? 'manual' : value === 'model' ? 'modelo' : 'padrão');
  return <div className="form-row device-power-fields">
    <label htmlFor="device-power-plugs">{t('power.plugs', 'Fontes / fichas')}
      <input id="device-power-plugs" type="number" min={0} max={MAX_POWER_PLUGS} step={1} placeholder={String(inheritedPlugCount(model))} value={plugs} aria-describedby="device-power-plugs-help" onChange={(event) => onChange({ powerPlugCount: event.target.value, estimatedWatts: watts })} />
      <small id="device-power-plugs-help" className="form-help">{t('power.plugsHelp', '0 a 8. 0 = sem alimentação (ex.: patch panel).')}</small>
    </label>
    <label htmlFor="device-power-watts">
      <span>{t('power.watts', 'Consumo estimado (W)')}<span className="power-source-chip" data-source={source} data-testid="watts-source">{sourceLabel(source)}</span>
        {source === 'manual' && <button type="button" className="power-watts-reset" onClick={() => onChange({ powerPlugCount: plugs, estimatedWatts: '' })}>{t('power.resetWatts', 'Usar valor do {source}', { source: sourceLabel(inherited.source) })}</button>}
      </span>
      <input id="device-power-watts" type="number" min={0} max={100000} step={1} placeholder={String(inherited.watts)} value={watts} onChange={(event) => onChange({ powerPlugCount: plugs, estimatedWatts: event.target.value })} />
    </label>
  </div>;
}
