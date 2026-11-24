'use client';

import { useState } from 'react';
import { Check, RadioTower } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { useUiText } from '@/components/ui/use-ui-text';
import { SnmpSetupWizard } from '@/features/snmp/snmp-setup-wizard';
import type { DeviceForm } from './forms';
import type { DeviceModel } from './types';

/**
 * D-P1b: a discovery result promoted to a device. The discovery page links here with
 * `?promote=discovery&ip=…&hostname=…&name=…&ipAddressId=…&model=…&serial=…` (see features/discovery/discovery-promote).
 */
export type DiscoveryPromotionRequest = { ip: string; hostname: string; name: string; ipAddressId: string; model: string; serial: string };

const PROMOTION_KEYS = ['promote', 'ip', 'hostname', 'name', 'ipAddressId', 'model', 'serial'] as const;

export function readDiscoveryPromotion(search: string): DiscoveryPromotionRequest | null {
  const query = new URLSearchParams(search);
  const ip = query.get('ip')?.trim() ?? '';
  if (query.get('promote') !== 'discovery' || !ip) return null;
  const text = (key: string) => query.get(key)?.trim() ?? '';
  return { ip, hostname: text('hostname'), name: text('name') || ip, ipAddressId: text('ipAddressId'), model: text('model'), serial: text('serial') };
}

/** The same URL without the promotion keys, so a reload does not open the form again. */
export function withoutDiscoveryPromotion(search: string): string {
  const query = new URLSearchParams(search);
  for (const key of PROMOTION_KEYS) query.delete(key);
  const rest = query.toString();
  return rest ? `?${rest}` : '';
}

/** The catalogue model whose name matches the SNMP model (with or without the manufacturer), when exactly one does. */
export function matchDeviceModel(models: DeviceModel[], snmpModel: string): DeviceModel | null {
  const wanted = snmpModel.trim().toLowerCase();
  if (!wanted) return null;
  const matches = models.filter((model) => model.model.trim().toLowerCase() === wanted || `${model.manufacturer} ${model.model}`.trim().toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : null;
}

/** New-device form prefilled from the promotion; everything stays editable in the existing editor. */
export function promotionDeviceForm(base: DeviceForm, promotion: DiscoveryPromotionRequest, models: DeviceModel[]): DeviceForm {
  const model = matchDeviceModel(models, promotion.model);
  return {
    ...base,
    name: promotion.name,
    hostname: promotion.hostname,
    managementIp: promotion.ip,
    managementIpAddressId: promotion.ipAddressId,
    ...(model ? { modelId: model.id, ...(model.type ? { type: String(model.type) } : {}) } : {}),
    ...(promotion.serial ? { serialNumber: promotion.serial } : {}),
  };
}

type Props = {
  device: { id: string; name: string };
  /** The SNMP wizard saves credentials and config, which the API keeps for ADMIN. */
  canConfigureSnmp: boolean;
  close: () => void;
  onConfigured?: () => void;
};

/** After a promoted device is created: offer the existing SNMP setup wizard for it (ADMIN), or say who can. */
export function DiscoveryPromotionSnmpOffer({ device, canConfigureSnmp, close, onConfigured }: Props) {
  const t = useUiText();
  const [wizard, setWizard] = useState(false);
  if (wizard) return <SnmpSetupWizard deviceId={device.id} deviceName={device.name} close={close} onDone={onConfigured} />;
  return <Modal title={t('discoveryPromote.createdTitle')} close={close} className="discovery-promotion-offer">
    <div className="modal-form">
      <p className="form-help" role="status"><Check size={14} aria-hidden="true" /> {t('discoveryPromote.created', undefined, { name: device.name })}</p>
      <p className="form-help">{canConfigureSnmp ? t('discoveryPromote.snmpOffer') : t('discoveryPromote.snmpAdminOnly')}</p>
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={close}>{t('discoveryPromote.later')}</button>
        {canConfigureSnmp && <button type="button" className="primary-button" onClick={() => setWizard(true)}><RadioTower size={14} aria-hidden="true" /> {t('discoveryPromote.configureSnmp')}</button>}
      </div>
    </div>
  </Modal>;
}
