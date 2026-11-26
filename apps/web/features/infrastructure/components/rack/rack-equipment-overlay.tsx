'use client';

import { useEffect } from 'react';
import { EquipmentTypeIcon } from '../equipment-type-icon';
import { deviceFaceImage, RACK_UNITS, RACK_VIEWPORT, rackUnitBox, rackUnitFromDrop } from '../../utils';
import type { Rack, RackFace } from '../../types';
import { AssetImage } from '../asset-image';
import { useUiText } from '@/components/ui/use-ui-text';
import { badgeStatus, snmpHealthDescription, snmpHealthStatusLabel } from '@/features/snmp/health/health-badge';
import { isSnmpNetworkDevice, type SnmpHealthSummaryItem } from '@/features/snmp/health/health-api';
import { clearActiveRackCard, clearActiveRackCards, RackDeviceHoverCard, setActiveRackCard, useActiveRackCard } from './rack-device-hover-card';

export interface RackEquipmentOverlayProps {
  rack: Rack;
  onSelect: (deviceId: string) => void;
  onDropDevice: (deviceId: string, rackUnitStart: number) => void;
  draggingDeviceId: string;
  onDragging: (deviceId: string) => void;
  canEdit: boolean;
  pendingDeviceId?: string;
  /** Face drawn by this overlay; placement is shared because devices are full depth. */
  face?: RackFace;
  /** Devices the power summary marks near the limit (warn / over); they get an amber / red outline. */
  powerLevels?: ReadonlyMap<string, 'warn' | 'over' | 'ok'>;
  /** SNMP Phase 2 step 10: health per device id; network equipment gets a dot, the hover card and the name a status. */
  health?: ReadonlyMap<string, SnmpHealthSummaryItem>;
}

/** Interactive overlay over the 42U rack picture in the rack detail view. */
export function RackEquipmentOverlay({ rack, onSelect, onDropDevice, draggingDeviceId, onDragging, canEdit, pendingDeviceId, face = 'front', powerLevels, health }: RackEquipmentOverlayProps) {
  const t = useUiText();
  const text = { name: t(`infra.ports.${face}.tab`).toLocaleLowerCase(), missing: t(`infra.rack.noImage.${face}`) };
  // One card at a time across the front and rear overlays: the store is shared, keyed by face and device.
  const active = useActiveRackCard();
  const cardKey = (id: string) => `${face}:${id}`;
  const show = (id: string, anchor: HTMLElement) => setActiveRackCard({ key: cardKey(id), anchor });
  const hide = (id: string) => clearActiveRackCard(cardKey(id));
  useEffect(() => () => clearActiveRackCards(`${face}:`), [face]);
  const isFocusVisible = (element: HTMLElement) => {
    try { return element.matches(':focus-visible'); } catch { return true; }
  };
  const placed = (rack.devices ?? []).filter((device) => {
    const start = Number(device.rackUnitStart);
    const size = Math.max(1, Number(device.rackUnitSize) || 1);
    return Number.isFinite(start) && start >= 1 && start + size - 1 <= RACK_UNITS;
  });

  return <div className={`rack-overlay-area${canEdit ? ' equipment-drop-zone' : ''}`} style={{ left: `${RACK_VIEWPORT.left * 100}%`, top: `${RACK_VIEWPORT.top * 100}%`, width: `${RACK_VIEWPORT.width * 100}%`, height: `${RACK_VIEWPORT.height * 100}%` }} onDragOver={(event) => {
    if (canEdit) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  }} onDrop={(event) => {
    if (!canEdit) return;
    event.preventDefault();
    const id = event.dataTransfer.getData('application/x-device-id') || event.dataTransfer.getData('text/plain');
    const size = Number(event.dataTransfer.getData('application/x-device-size')) || 1;
    if (id) void onDropDevice(id, rackUnitFromDrop(event, rack.units ?? RACK_UNITS, size));
    onDragging('');
  }}>
    {placed.map((device) => {
      const start = Number(device.rackUnitStart);
      const size = Math.max(1, Number(device.rackUnitSize) || 1);
      const end = start + size - 1;
      const { top, height } = rackUnitBox(start, size);
      const visual = deviceFaceImage(device, face);
      const cardId = `rack-device-card-${face}-${device.id}`;
      const showCard = active?.key === cardKey(device.id) && !draggingDeviceId;
      const healthItem = health && isSnmpNetworkDevice(device.type) ? health.get(device.id) ?? null : undefined;
      return <button type="button" key={device.id} draggable={canEdit} className={`rack-overlay rack-${String(device.type || 'other').toLowerCase()}${draggingDeviceId === device.id ? ' moving' : ''}${pendingDeviceId === device.id ? ' pending-placement' : ''}`} style={{ top: `${top}%`, height: `${height}%` }} data-power-level={powerLevels?.get(device.id)} aria-describedby={showCard ? cardId : undefined} onMouseEnter={(event) => show(device.id, event.currentTarget)} onMouseLeave={() => hide(device.id)} onFocus={(event) => {
        if (isFocusVisible(event.currentTarget)) show(device.id, event.currentTarget);
      }} onBlur={() => hide(device.id)} onKeyDown={(event) => {
        if (event.key === 'Escape') { hide(device.id); return; }
        if (!canEdit) return;
        if (event.key === 'ArrowUp') { event.preventDefault(); void onDropDevice(device.id, start + 1); }
        if (event.key === 'ArrowDown') { event.preventDefault(); void onDropDevice(device.id, start - 1); }
      }} onDragStart={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const offset = Math.max(0, Math.min(size - 1, Math.floor(((event.clientY - bounds.top) / bounds.height) * size)));
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', device.id);
        event.dataTransfer.setData('application/x-device-id', device.id);
        event.dataTransfer.setData('application/x-device-size', String(size));
        event.dataTransfer.setData('application/x-rack-offset', String(offset));
        hide(device.id);
        onDragging(device.id);
      }} onDragEnd={() => window.setTimeout(() => onDragging(''), 0)} onClick={() => {
        hide(device.id);
        if (!draggingDeviceId) onSelect(device.id);
      }} data-face={face} aria-label={[t(canEdit ? 'infra.rack.dragOrOpenDevice' : 'infra.rack.openDevice', undefined, { name: device.name, units: size > 1 ? t('infra.rack.unitRange', undefined, { start, end }) : `U${start}`, face: text.name }), healthItem !== undefined ? snmpHealthDescription(t, healthItem) : ''].filter(Boolean).join(', ')}>
      <span className={`rack-device-media${visual ? '' : ' rack-device-media-missing'}`}>{visual ? <AssetImage asset={visual} alt={t(`infra.rack.faceImageOf.${face}`, undefined, { name: device.name })} /> : <><EquipmentTypeIcon type={device.type} alt={t('infra.typeIconOf', undefined, { type: device.type })} className="rack-device-type-icon" /><span className="rack-device-missing-face">{text.missing}</span></>}</span>
      {showCard && active && <RackDeviceHoverCard id={cardId} anchor={active.anchor}><strong>{device.name}</strong><span><small>{t('infra.rack.card.location')}</small><b>{rack.name}</b></span><span><small>U:</small><b>{size > 1 ? `U${start}–U${end}` : `U${start}`}</b></span><span><small>IP Management:</small><b>{device.managementIp || t('infra.rack.card.notSet')}</b></span><span><small>Status:</small><b>{String(device.status || 'unknown').toLowerCase()}</b></span>{healthItem !== undefined && <span><small>{t('snmpHealth.column')}:</small><b>{snmpHealthStatusLabel(t, healthItem?.status)}{healthItem?.issueCount ? ` · ${t('snmpHealth.issues', undefined, { count: healthItem.issueCount })}` : ''}</b></span>}{!visual && <span><small>{t('infra.rack.card.image')}</small><b>{text.missing}</b></span>}</RackDeviceHoverCard>}
      {healthItem !== undefined && <span className="rack-equipment-health" data-health={badgeStatus(healthItem?.status)} aria-hidden="true" />}
    </button>;
    })}
  </div>;
}
