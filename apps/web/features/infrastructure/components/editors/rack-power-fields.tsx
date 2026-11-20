'use client';

import { useI18n } from '@/lib/i18n';
import { DEFAULT_PDU_BUDGET_WATTS, DEFAULT_PDU_OUTLETS, defaultPduName } from '../../power';
import type { PduDraft, RackPowerDraft } from '../../forms';
import type { PowerConflictDevice, PowerFeedSource, RackPowerMode } from '../../types';

export interface RackPowerFieldsProps {
  value: RackPowerDraft;
  onChange: (next: RackPowerDraft) => void;
  /** Devices that stop the change (still plugged into the UPS PDU, or into outlets that would disappear). */
  blocked?: { kind: 'ups' | 'outlets'; devices: PowerConflictDevice[] } | null;
  /** "Desligar todos da UPS": frees every UPS outlet, then the save can go through. */
  onDisconnectAllUps?: () => void;
  disconnecting?: boolean;
}

const MODES: { mode: RackPowerMode; key: string; fallback: string }[] = [
  { mode: 'SUPPLIER_ONLY', key: 'power.mode.supplier', fallback: 'Só rede elétrica' },
  { mode: 'SUPPLIER_AND_UPS', key: 'power.mode.supplierUps', fallback: 'Rede + UPS' },
];

/** Rack form "Alimentação": supplier only (default) or supplier + UPS, with collapsed per-PDU settings. */
export function RackPowerFields({ value, onChange, blocked, onDisconnectAllUps, disconnecting = false }: RackPowerFieldsProps) {
  const { t } = useI18n();
  const sources: PowerFeedSource[] = value.mode === 'SUPPLIER_AND_UPS' ? ['SUPPLIER', 'UPS'] : ['SUPPLIER'];
  const setPdu = (source: PowerFeedSource, patch: Partial<PduDraft>) => {
    const key = source === 'UPS' ? 'ups' : 'supplier';
    onChange({ ...value, [key]: { ...value[key], ...patch } });
  };
  return <fieldset className="power-mode">
    <legend>{t('power.mode', 'Alimentação')}</legend>
    <div className="power-mode-options" role="radiogroup" aria-label={t('power.mode', 'Alimentação')}>
      {MODES.map((option) => <label key={option.mode}>
        <input type="radio" name="rack-power-mode" value={option.mode} checked={value.mode === option.mode} onChange={() => onChange({ ...value, mode: option.mode })} />
        {t(option.key, option.fallback)}
      </label>)}
    </div>
    {sources.map((source) => {
      const draft = source === 'UPS' ? value.ups : value.supplier;
      const name = draft.name.trim() || defaultPduName(source);
      const id = `rack-pdu-${source.toLowerCase()}`;
      return <details key={source} className="power-pdu-settings" data-source={source}>
        <summary>{t('power.pduSettings', 'Definições da {name}', { name })}</summary>
        <div>
          <label htmlFor={`${id}-name`}>{t('power.pduName', 'Nome')}<input id={`${id}-name`} maxLength={80} placeholder={defaultPduName(source)} value={draft.name} onChange={(event) => setPdu(source, { name: event.target.value })} /></label>
          <div className="form-row">
            <label htmlFor={`${id}-outlets`}>{t('power.pduOutlets', 'Tomadas')}<input id={`${id}-outlets`} type="number" min={1} max={96} required placeholder={String(DEFAULT_PDU_OUTLETS)} value={draft.outletCount} onChange={(event) => setPdu(source, { outletCount: event.target.value })} /></label>
            <label htmlFor={`${id}-budget`}>{t('power.pduBudget', 'Potência máxima (W)')}<input id={`${id}-budget`} type="number" min={0} max={100000} step={10} placeholder={String(DEFAULT_PDU_BUDGET_WATTS)} value={draft.budgetWatts} onChange={(event) => setPdu(source, { budgetWatts: event.target.value })} /></label>
          </div>
          <p className="form-help">{t('power.pduBudgetHelp', 'Por omissão 3680 W (16 A / 230 V). Os valores são estimativas e nunca bloqueiam a gravação.')}</p>
        </div>
      </details>;
    })}
    {blocked && blocked.devices.length > 0 && <div className="power-blocked" role="alert">
      <span>{blocked.kind === 'ups' ? t('power.upsBlocked', 'Não é possível remover a UPS: estes equipamentos ainda estão ligados à PDU UPS.') : t('power.conflict', 'A alteração deixaria equipamentos sem tomada. Desliga-os ou muda-os para tomadas livres primeiro.')}</span>
      <ul>{blocked.devices.map((device) => <li key={device.deviceId}>{device.deviceName} · {device.outlets.join(', ')}</li>)}</ul>
      {blocked.kind === 'ups' && onDisconnectAllUps && <button type="button" className="secondary-button" disabled={disconnecting} onClick={onDisconnectAllUps}>{disconnecting ? t('power.disconnectingAll', 'A desligar…') : t('power.disconnectAllUps', 'Desligar todos da UPS')}</button>}
    </div>}
  </fieldset>;
}
