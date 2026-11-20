'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Plug } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/lib/auth';
import { EQUIPMENT_TYPES } from '../../utils';
import { deviceImageFields, devicePowerFields, type DeviceForm } from '../../forms';
import type { AssetFile, DeviceModel, IpAddress, Rack } from '../../types';
import {
  DEVICE_EDITOR_TABS, deviceEditorTabLabel, evaluateDeviceRequirements, isPlacementChange, satisfiedFeatureConfigs, saveSendsPower, useRequiredConfigRegistry,
  type DeviceEditorTab, type MappedFieldError,
} from '../../device-requirements';
import { usePowerDefaults } from '../../use-power-defaults';
import { AssetPicker, FormError } from './editor-shared';
import { DevicePowerFields } from './device-power-fields';
import { AssetImage } from '../asset-image';

export interface DeviceEditorProps {
  close: () => void;
  editingId: string;
  animateEntry?: boolean;
  form: DeviceForm;
  setForm: React.Dispatch<React.SetStateAction<DeviceForm>>;
  racks: Rack[];
  models: DeviceModel[];
  assets: AssetFile[];
  ips: IpAddress[];
  save: (path: string, body: Record<string, unknown>, method?: string) => Promise<void>;
  formError?: string;
  /** Field errors from the API's last 400, already mapped onto editor fields. */
  fieldErrors?: MappedFieldError[];
  /** Tab to open on (deep link from an alert). */
  initialTab?: DeviceEditorTab;
  onDevicePower?: () => void;
}

const LEGACY_HINT = 'Configuração em falta: este equipamento é anterior a este requisito. Podes guardar outras alterações e completar mais tarde.';
const POWER_AUTO_NOTE = 'Ao guardar, as fichas são ligadas automaticamente a tomadas livres da PDU do bastidor. Podes ajustá-las depois em “Ligações elétricas”.';

/**
 * Device create/edit form split into tabs (Geral, Localização, Rede, Imagens, Energia). The body scrolls inside the
 * active tab while the footer stays put. Required fields come from device-requirements.ts: Guardar is blocked while a
 * blocking one is missing, and a save attempt jumps to the first one.
 */
export function DeviceEditor({ close, editingId, animateEntry = false, form, setForm, racks, models, assets, ips, save, formError = '', fieldErrors, initialTab, onDevicePower }: DeviceEditorProps) {
  const { hasRole } = useAuth();
  const admin = hasRole('ADMIN');
  const isNew = !editingId;
  const [tab, setTab] = useState<DeviceEditorTab>(initialTab ?? 'geral');
  const [attempted, setAttempted] = useState(false);
  const [pendingFocus, setPendingFocus] = useState('');
  const [apiErrors, setApiErrors] = useState<MappedFieldError[]>([]);
  const tabRefs = useRef<Partial<Record<DeviceEditorTab, HTMLButtonElement | null>>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const registry = useRequiredConfigRegistry();
  const defaults = usePowerDefaults();
  const model = models.find((item) => item.id === form.modelId) ?? null;
  const siteId = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('siteId');
  // Existing device as opened: baseline for clearing a filled config and for placement changes (rack in/move, un-retire, 0→n plugs).
  const [openedForm] = useState(form);
  const openedModel = isNew ? null : models.find((item) => item.id === openedForm.modelId) ?? null;
  const baseContext = { model, siteId, defaultPlugCount: defaults?.powerPlugCount ?? null, isNew, opened: isNew ? null : openedForm, openedModel };
  const sendsPower = saveSendsPower(form, baseContext);
  const context = { ...baseContext, sendsPower };
  // Existing device: FEATURE configs it satisfied when opened. Clearing one of those blocks; other gaps are legacy hints unless the save places the device.
  const satisfiedAtOpen = useMemo(() => (isNew ? new Set<string>() : satisfiedFeatureConfigs(registry, openedForm, { model: models.find((item) => item.id === openedForm.modelId) ?? null, siteId, defaultPlugCount: defaults?.powerPlugCount ?? null, isNew, sendsPower: false })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the baseline is the device as opened (recomputed once the registry arrives).
    [registry, isNew, openedForm, models]);
  const missing = evaluateDeviceRequirements(registry, form, context, { isNew, satisfiedAtOpen });
  const blocking = missing.filter((item) => item.blocking);

  useEffect(() => {
    if (!fieldErrors?.length) return;
    setApiErrors(fieldErrors);
    setTab(fieldErrors[0].tab);
    setPendingFocus(fieldErrors[0].fieldId);
  }, [fieldErrors]);

  useEffect(() => {
    if (!pendingFocus) return;
    document.getElementById(pendingFocus)?.focus();
    setPendingFocus('');
  }, [pendingFocus, tab]);

  /** Error text for a field: a blocking requirement (after a save attempt) or the API's message for it. */
  const errorFor = (fieldId: string) => {
    const api = apiErrors.find((item) => item.fieldId === fieldId);
    if (api) return api.message;
    if (!attempted) return undefined;
    return blocking.find((item) => item.fieldId === fieldId)?.config.missingMessage;
  };
  const hintFor = (fieldId: string) => { const gap = missing.find((item) => !item.blocking && item.fieldId === fieldId); return gap ? `${LEGACY_HINT} ${gap.config.missingMessage}` : undefined; };
  const tabErrorCount = (key: DeviceEditorTab) => {
    const ids = new Set([...blocking.filter((item) => item.tab === key).map((item) => item.fieldId), ...apiErrors.filter((item) => item.tab === key).map((item) => item.fieldId)]);
    return ids.size;
  };
  const tabHasHint = (key: DeviceEditorTab) => missing.some((item) => !item.blocking && item.tab === key);
  const totalErrors = DEVICE_EDITOR_TABS.reduce((sum, key) => sum + tabErrorCount(key), 0);

  const update = (patch: Partial<DeviceForm>, ...fieldIds: string[]) => {
    setForm((current) => ({ ...current, ...patch }));
    if (fieldIds.length) setApiErrors((current) => current.filter((item) => !fieldIds.includes(item.fieldId)));
  };
  const goTo = (key: DeviceEditorTab, focusField?: string) => {
    setTab(key);
    if (focusField) setPendingFocus(focusField);
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = DEVICE_EDITOR_TABS.indexOf(tab);
    const next = event.key === 'ArrowRight' ? DEVICE_EDITOR_TABS[(index + 1) % DEVICE_EDITOR_TABS.length]
      : event.key === 'ArrowLeft' ? DEVICE_EDITOR_TABS[(index - 1 + DEVICE_EDITOR_TABS.length) % DEVICE_EDITOR_TABS.length]
        : event.key === 'Home' ? DEVICE_EDITOR_TABS[0]
          : event.key === 'End' ? DEVICE_EDITOR_TABS[DEVICE_EDITOR_TABS.length - 1] : null;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    const firstError = DEVICE_EDITOR_TABS.flatMap((key) => [
      ...blocking.filter((item) => item.tab === key).map((item) => item.fieldId),
      ...apiErrors.filter((item) => item.tab === key).map((item) => item.fieldId),
    ])[0];
    if (firstError) {
      const owner = blocking.find((item) => item.fieldId === firstError)?.tab ?? apiErrors.find((item) => item.fieldId === firstError)?.tab ?? tab;
      goTo(owner, firstError);
      return;
    }
    // Remaining native checks (SNMP credentials, number ranges) live on fields that may sit in a hidden tab.
    const invalid = formRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>('input:invalid, select:invalid');
    if (invalid) {
      const panelTab = invalid.closest<HTMLElement>('[role="tabpanel"]')?.dataset.tab as DeviceEditorTab | undefined;
      if (panelTab) setTab(panelTab);
      window.setTimeout(() => { invalid.focus(); invalid.reportValidity?.(); }, 0);
      return;
    }
    persist();
  };

  const persist = () => {
    const { snmpEnabled, snmpVersion, snmpReadUsername, snmpReadCommunity, snmpReadAuthKey, snmpReadPrivKey, snmpTrapEnabled, snmpTrapUsername, snmpTrapCommunity, snmpTrapAuthKey, snmpTrapPrivKey, snmpAuthProtocol, snmpPrivProtocol, snmpCompatibilitySha1, snmpPort, snmpIntervalMinutes, snmpTimeoutMs, snmpRetries, ...devicePayload } = form;
    if (isNew && snmpEnabled) {
      const version = snmpVersion ?? 'V3'; const protocols = { authProtocol: snmpAuthProtocol ?? 'SHA256', privProtocol: snmpPrivProtocol ?? 'AES128' };
      const readCredential = version === 'V2C' ? { version, community: snmpReadCommunity } : { version, username: snmpReadUsername, authKey: snmpReadAuthKey, privKey: snmpReadPrivKey, ...protocols };
      const trapCredential = !snmpTrapEnabled ? undefined : version === 'V2C' ? { version, community: snmpTrapCommunity } : { version, username: snmpTrapUsername, authKey: snmpTrapAuthKey, privKey: snmpTrapPrivKey, ...protocols };
      void save('/api/v1/snmp/onboarding/devices', { siteId: new URLSearchParams(location.search).get('siteId'), name: devicePayload.name, type: devicePayload.type, hostname: devicePayload.hostname || undefined, managementIp: devicePayload.managementIp, modelId: devicePayload.modelId || undefined, frontAssetId: form.frontAssetId || undefined, backAssetId: form.backAssetId || undefined, rackId: devicePayload.rackId || undefined, rackUnitStart: devicePayload.rackId && devicePayload.rackUnitStart ? Number(devicePayload.rackUnitStart) : undefined, rackUnitSize: devicePayload.rackId ? Number(devicePayload.rackUnitSize || 1) : undefined, config: { enabled: true, port: Number(snmpPort || 161), intervalMinutes: Number(snmpIntervalMinutes || 15), timeoutMs: Number(snmpTimeoutMs || 5000), retries: Number(snmpRetries || 2), compatibilitySha1: !!snmpCompatibilitySha1 }, readCredential, trapCredential }, 'POST');
      return;
    }
    // Image overrides go through deviceImageFields so an edit never clears an image it did not change.
    const deviceBody: Record<string, unknown> = { ...devicePayload };
    delete deviceBody.savedAssetIds; delete deviceBody.frontAssetId; delete deviceBody.backAssetId;
    // Power overrides follow the same rule: send only what changed (null = back to the model / default).
    delete deviceBody.powerPlugCount; delete deviceBody.estimatedWatts; delete deviceBody.savedPower;
    delete deviceBody.savedRackId; delete deviceBody.requiredMissing;
    // Landing in a rack (new or moved) sends `power`: the API connects the plugs to free PDU outlets in the same save.
    const powerFields = devicePowerFields(form);
    void save(editingId ? `/api/v1/devices/${editingId}` : '/api/v1/devices', {
      ...deviceBody,
      siteId: new URLSearchParams(location.search).get('siteId'),
      rackId: form.rackId || null,
      rackUnitStart: form.rackUnitStart ? Number(form.rackUnitStart) : null,
      rackUnitSize: Number(form.rackUnitSize),
      modelId: form.modelId || null,
      managementIpAddressId: form.managementIpAddressId || null,
      ...deviceImageFields(form),
      ...powerFields,
      ...(sendsPower ? { power: {} } : {}),
    });
  };

  const note = (fieldId: string) => {
    const error = errorFor(fieldId);
    const hint = error ? undefined : hintFor(fieldId);
    if (error) return <small id={`${fieldId}-note`} className="form-error field-error">{error}</small>;
    if (hint) return <small id={`${fieldId}-note`} className="form-warning">{hint}</small>;
    return null;
  };
  const a11y = (fieldId: string) => ({ id: fieldId, 'aria-invalid': errorFor(fieldId) ? true : undefined, 'aria-describedby': errorFor(fieldId) || hintFor(fieldId) ? `${fieldId}-note` : undefined });
  const requiredMark = <span className="device-editor-required" aria-hidden="true"> *</span>;
  const rearRequired = !!form.rackId && form.status !== 'RETIRED';
  /** Decorative preview of the chosen (or inherited) image; the picker below carries the label. */
  const imagePreview = (assetId: string | undefined, fallback: AssetFile | null | undefined) => {
    const asset = assets.find((item) => item.id === assetId) ?? fallback;
    return <div className="device-editor-image-preview" aria-hidden="true">{asset ? <AssetImage asset={asset} alt="" /> : <span>Sem imagem</span>}</div>;
  };

  const panel = (key: DeviceEditorTab, children: React.ReactNode) => <section role="tabpanel" id={`device-panel-${key}`} aria-labelledby={`device-tab-${key}`} data-tab={key} hidden={tab !== key} tabIndex={0} className="device-editor-panel">{children}</section>;

  return <Modal title={isNew ? 'Novo equipamento' : 'Gerir equipamento'} close={close} entryMotion={!isNew && animateEntry} className="device-editor-modal">
    <form ref={formRef} className="modal-form device-editor-form" noValidate onSubmit={submit}>
      {!isNew && form.name && <p className="device-editor-subtitle">{form.name}</p>}
      <div role="tablist" aria-label="Definições do equipamento" className="device-editor-tabs">
        {DEVICE_EDITOR_TABS.map((key) => {
          const errors = tabErrorCount(key);
          const hint = !errors && tabHasHint(key);
          return <button key={key} ref={(node) => { tabRefs.current[key] = node; }} type="button" role="tab" id={`device-tab-${key}`} aria-controls={`device-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} className="device-editor-tab" data-state={errors ? 'error' : hint ? 'hint' : undefined} onClick={() => setTab(key)} onKeyDown={onTabKeyDown}>
            {deviceEditorTabLabel(key, registry)}
            {errors > 0 && <span className="device-editor-tab-badge" data-testid={`tab-errors-${key}`}><span aria-hidden="true">{errors}</span><span className="topology-sr-only">{errors === 1 ? ' · 1 campo obrigatório em falta' : ` · ${errors} campos obrigatórios em falta`}</span></span>}
            {hint && <span className="device-editor-tab-hint" data-testid={`tab-hint-${key}`}><span aria-hidden="true">!</span><span className="topology-sr-only"> · configuração em falta</span></span>}
          </button>;
        })}
      </div>

      <div className="device-editor-body">
        {panel('geral', <>
          <label htmlFor="device-name">Nome{requiredMark}<input {...a11y('device-name')} required aria-required="true" value={form.name} onChange={(event) => update({ name: event.target.value }, 'device-name')} /></label>
          {note('device-name')}
          <div className="form-row">
            <label htmlFor="device-type">Tipo<select id="device-type" value={form.type} onChange={(event) => update({ type: event.target.value }, 'device-type')}>{EQUIPMENT_TYPES.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label htmlFor="device-status">Estado<select id="device-status" value={form.status} onChange={(event) => update({ status: event.target.value }, 'device-status')}>{['UNKNOWN', 'ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED'].map((option) => <option key={option}>{option}</option>)}</select></label>
          </div>
          <label htmlFor="device-model">Modelo (opcional)<select id="device-model" value={form.modelId} onChange={(event) => update({ modelId: event.target.value }, 'device-model')}><option value="">Sem modelo — usar ícone genérico</option>{models.filter((item) => item.type === form.type).map((item) => <option key={item.id} value={item.id}>{item.manufacturer} {item.model}</option>)}</select></label>
          <small className="form-help">O modelo fornece imagens, fichas e consumo por omissão.</small>
          <label className="checkbox-label"><input type="checkbox" checked={form.isCritical} onChange={(event) => update({ isCritical: event.target.checked })} /> Ativo crítico · requer confirmação semanal</label>
        </>)}

        {panel('localizacao', <>
          <label htmlFor="device-rack">Bastidor<select {...a11y('device-rack')} value={form.rackId} onChange={(event) => update({ rackId: event.target.value }, 'device-rack')}><option value="">Por localizar</option>{racks.map((rack) => <option key={rack.id} value={rack.id}>{rack.room?.name} / {rack.name}</option>)}</select></label>
          {note('device-rack')}
          <div className="form-row">
            <label htmlFor="device-rack-unit-start">U inicial<input {...a11y('device-rack-unit-start')} type="number" min="1" value={form.rackUnitStart} onChange={(event) => update({ rackUnitStart: event.target.value }, 'device-rack-unit-start')} /></label>
            <label htmlFor="device-rack-unit-size">Tamanho U<input {...a11y('device-rack-unit-size')} type="number" min="1" value={form.rackUnitSize} onChange={(event) => update({ rackUnitSize: event.target.value }, 'device-rack-unit-size')} /></label>
          </div>
          {note('device-rack-unit-start')}{note('device-rack-unit-size')}
          <small className="form-help">Num bastidor, o equipamento precisa de imagem traseira e de fichas ligadas à PDU.</small>
        </>)}

        {panel('rede', <>
          <label htmlFor="device-hostname">Hostname<input {...a11y('device-hostname')} value={form.hostname} onChange={(event) => update({ hostname: event.target.value }, 'device-hostname')} /></label>
          {note('device-hostname')}
          <div className="form-row">
            <label htmlFor="device-management-ip">IP de gestão{form.snmpEnabled && requiredMark}<input {...a11y('device-management-ip')} required={!!form.snmpEnabled} value={form.managementIp} onChange={(event) => update({ managementIp: event.target.value }, 'device-management-ip')} /></label>
            <label htmlFor="device-ipam">IPAM<select id="device-ipam" value={form.managementIpAddressId} onChange={(event) => update({ managementIpAddressId: event.target.value }, 'device-ipam')}><option value="">Sem associação</option>{ips.map((ip) => <option key={ip.id} value={ip.id}>{ip.address} · {ip.hostname || 'sem hostname'}</option>)}</select></label>
          </div>
          {note('device-management-ip')}
          {admin && isNew && <fieldset className="snmp-onboarding-section"><legend>SNMP (opcional)</legend>
            <label className="checkbox-label"><input type="checkbox" checked={!!form.snmpEnabled} onChange={(event) => update({ snmpEnabled: event.target.checked })} /> Configurar polling e credenciais SNMP</label>
            {form.snmpEnabled && <><p className="form-help">READ é obrigatória; TRAP é opcional e tem de usar um segredo diferente.</p>
              <div className="form-row"><label>Versão<select value={form.snmpVersion ?? 'V3'} onChange={(event) => update({ snmpVersion: event.target.value as 'V2C' | 'V3' })}><option value="V3">SNMPv3 authPriv</option><option value="V2C">SNMPv2c</option></select></label><label>Porta<input type="number" min="1" max="65535" value={form.snmpPort ?? '161'} onChange={(event) => update({ snmpPort: event.target.value })} /></label></div>
              <div className="form-row"><label>Intervalo (min)<input type="number" min="5" value={form.snmpIntervalMinutes ?? '15'} onChange={(event) => update({ snmpIntervalMinutes: event.target.value })} /></label><label>Timeout (ms)<input type="number" min="500" value={form.snmpTimeoutMs ?? '5000'} onChange={(event) => update({ snmpTimeoutMs: event.target.value })} /></label></div>
              <label>Retries<input type="number" min="0" max="5" value={form.snmpRetries ?? '2'} onChange={(event) => update({ snmpRetries: event.target.value })} /></label>
              {form.snmpVersion === 'V2C' ? <label>Comunidade READ<input required minLength={8} type="password" value={form.snmpReadCommunity ?? ''} onChange={(event) => update({ snmpReadCommunity: event.target.value })} autoComplete="new-password" /></label> : <><div className="form-row"><label>Auth<select value={form.snmpAuthProtocol ?? 'SHA256'} onChange={(event) => update({ snmpAuthProtocol: event.target.value as DeviceForm['snmpAuthProtocol'] })}><option>SHA256</option><option>SHA384</option><option>SHA512</option>{form.snmpCompatibilitySha1 && <option>SHA1</option>}</select></label><label>Privacidade<select value={form.snmpPrivProtocol ?? 'AES128'} onChange={(event) => update({ snmpPrivProtocol: event.target.value as DeviceForm['snmpPrivProtocol'] })}><option>AES128</option><option>AES256</option></select></label></div><label className="checkbox-label"><input type="checkbox" checked={!!form.snmpCompatibilitySha1} onChange={(event) => update({ snmpCompatibilitySha1: event.target.checked, snmpAuthProtocol: event.target.checked ? form.snmpAuthProtocol : form.snmpAuthProtocol === 'SHA1' ? 'SHA256' : form.snmpAuthProtocol })} /> Permitir compatibilidade SHA-1</label><label>Username READ<input required value={form.snmpReadUsername ?? ''} onChange={(event) => update({ snmpReadUsername: event.target.value })} /></label><label>Auth key READ<input required minLength={8} type="password" value={form.snmpReadAuthKey ?? ''} onChange={(event) => update({ snmpReadAuthKey: event.target.value })} autoComplete="new-password" /></label><label>Privacy key READ<input required minLength={8} type="password" value={form.snmpReadPrivKey ?? ''} onChange={(event) => update({ snmpReadPrivKey: event.target.value })} autoComplete="new-password" /></label></>}
              <label className="checkbox-label"><input type="checkbox" checked={!!form.snmpTrapEnabled} onChange={(event) => update({ snmpTrapEnabled: event.target.checked })} /> Configurar também credencial TRAP distinta</label>
              {form.snmpTrapEnabled && (form.snmpVersion === 'V2C' ? <label>Comunidade TRAP<input required minLength={8} type="password" value={form.snmpTrapCommunity ?? ''} onChange={(event) => update({ snmpTrapCommunity: event.target.value })} autoComplete="new-password" /></label> : <><label>Username TRAP<input required value={form.snmpTrapUsername ?? ''} onChange={(event) => update({ snmpTrapUsername: event.target.value })} /></label><label>Auth key TRAP<input required minLength={8} type="password" value={form.snmpTrapAuthKey ?? ''} onChange={(event) => update({ snmpTrapAuthKey: event.target.value })} autoComplete="new-password" /></label><label>Privacy key TRAP<input required minLength={8} type="password" value={form.snmpTrapPrivKey ?? ''} onChange={(event) => update({ snmpTrapPrivKey: event.target.value })} autoComplete="new-password" /></label></>)}
            </>}
          </fieldset>}
        </>)}

        {panel('imagens', <>
          <div className="device-editor-images">
            <div className="device-editor-image">
              {imagePreview(form.frontAssetId, model?.frontAsset)}
              <AssetPicker id="device-front-image" invalid={!!errorFor('device-front-image')} describedBy={errorFor('device-front-image') ? 'device-front-image-note' : undefined} label="Imagem frontal (substitui a do modelo)" emptyLabel="Usar a imagem do modelo" value={form.frontAssetId} assets={assets} onChange={(value) => update({ frontAssetId: value }, 'device-front-image')} />
              {note('device-front-image')}
            </div>
            <div className="device-editor-image">
              {imagePreview(form.backAssetId, model?.backAsset)}
              <AssetPicker id="device-rear-image" invalid={!!errorFor('device-rear-image')} describedBy={errorFor('device-rear-image') || hintFor('device-rear-image') ? 'device-rear-image-note' : undefined} required={rearRequired && isPlacementChange(form, baseContext) && !(model?.backAssetId || model?.backAsset)} label={rearRequired ? 'Imagem traseira (obrigatória no bastidor)' : 'Imagem traseira (substitui a do modelo)'} emptyLabel={model?.backAssetId || model?.backAsset ? 'Usar a imagem do modelo' : 'Sem imagem'} value={form.backAssetId ?? ''} assets={assets} onChange={(value) => update({ backAssetId: value }, 'device-rear-image')} />
              {note('device-rear-image')}
            </div>
          </div>
        </>)}

        {panel('energia', <>
          <DevicePowerFields form={form} models={models} onChange={(patch) => update(patch, 'device-power-plugs', 'device-power-watts')}
            errors={{ plugs: errorFor('device-power-plugs'), watts: errorFor('device-power-watts') }}
            hints={{ plugs: errorFor('device-power-plugs') ? undefined : hintFor('device-power-plugs'), watts: errorFor('device-power-watts') ? undefined : hintFor('device-power-watts') }} />
          {sendsPower && <small className="form-help device-power-auto">{POWER_AUTO_NOTE}</small>}
          {onDevicePower && editingId && form.rackId && <button type="button" className="secondary-button device-power-open" onClick={onDevicePower}><Plug size={14} /> Ligações elétricas</button>}
        </>)}
      </div>

      <div className="device-editor-footer">
        <FormError message={formError} />
        <div className="modal-actions">
          {totalErrors > 0 && <span className="device-editor-missing" role="status">{totalErrors === 1 ? '1 campo obrigatório em falta' : `${totalErrors} campos obrigatórios em falta`}</span>}
          <button type="button" className="secondary-button" onClick={close}>Cancelar</button>
          <button className="primary-button" aria-disabled={totalErrors > 0 || undefined} data-blocked={totalErrors > 0 || undefined}><Check size={14} /> Guardar</button>
        </div>
      </div>
    </form>
  </Modal>;
}
