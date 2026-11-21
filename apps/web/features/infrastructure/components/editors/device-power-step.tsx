'use client';

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { useI18n } from '@/lib/i18n';
import { assignOutlets, defaultPduName, defaultPlugRows, deviceIsConnected, existingPlugRows, rackHasUps, sortedPdus, takenOutlets, type PlugRow } from '../../power';
import type { DevicePowerInput, Rack } from '../../types';
import { FormError } from './editor-shared';

export interface DevicePowerStepProps {
  device: { id: string; name: string };
  /** Plugs of the device (0–8). 0 = nothing to connect. */
  plugs: number;
  /** The device's rack with its PDUs and their connections. */
  rack: Pick<Rack, 'id' | 'name' | 'pdus'>;
  /** The device just moved here from another rack (its old connections were removed). */
  moved?: boolean;
  onSave: (input: DevicePowerInput) => Promise<void>;
  onSkip: () => void;
  error?: string;
}

/** Plug rows as typed: `requested` is the PDU the user picked, kept so a full PDU can be explained. */
interface StepRow extends PlugRow { requested: string }

/**
 * Power step after placing a device in a rack: one row per plug with its PDU (or "Não ligado") and outlet. Defaults: every
 * plug on the supplier PDU, or alternating supplier / UPS (plug 1 on the supplier) when the rack has a UPS, each on the
 * next free outlet. Warnings never block saving.
 */
export function DevicePowerStep({ device, plugs, rack, moved = false, onSave, onSkip, error = '' }: DevicePowerStepProps) {
  const { t } = useI18n();
  const pdus = useMemo(() => sortedPdus(rack), [rack]);
  const [rows, setRows] = useState<StepRow[]>(() => {
    if (!moved && deviceIsConnected(pdus, device.id)) return existingPlugRows(plugs, pdus, device.id).map((row) => ({ ...row, requested: row.pduId }));
    // Remember the default PDU of each plug so a plug left unplugged because that PDU is full can say so.
    const supplier = pdus.find((pdu) => pdu.source === 'SUPPLIER');
    const ups = pdus.find((pdu) => pdu.source === 'UPS');
    return defaultPlugRows(plugs, pdus, device.id).map((row) => ({ ...row, requested: (ups && row.plugIndex % 2 === 0 ? ups : supplier ?? ups)?.id ?? '' }));
  });
  const [saving, setSaving] = useState(false);
  const pduName = (id: string) => {
    const pdu = pdus.find((item) => item.id === id);
    return pdu ? pdu.name?.trim() || defaultPduName(pdu.source) : '';
  };

  const update = (index: number, patch: Partial<StepRow>) => setRows((current) => {
    const next = current.map((row, position) => (position === index ? { ...row, ...patch } : row));
    const assigned = assignOutlets(next, pdus, device.id);
    return assigned.map((row, position) => ({ ...row, requested: next[position].requested }));
  });
  /** Free outlets on a PDU for one row: not used by other devices nor by this device's other rows. */
  const freeFor = (pduId: string, index: number) => {
    const pdu = pdus.find((item) => item.id === pduId);
    if (!pdu) return [];
    const taken = takenOutlets(pdu, device.id);
    rows.forEach((row, position) => { if (position !== index && row.pduId === pduId && row.outletIndex != null) taken.add(row.outletIndex); });
    return Array.from({ length: pdu.outletCount }, (_, outlet) => outlet + 1).filter((outlet) => !taken.has(outlet));
  };

  const unplugged = rows.filter((row) => !row.pduId).length;
  const fullPdus = [...new Set(rows.filter((row) => row.requested && !row.pduId).map((row) => row.requested))];
  const noRedundancy = plugs > 1 && !rackHasUps(rack);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({ plugs: rows.map((row) => ({ plugIndex: row.plugIndex, pduId: row.pduId || null, outletIndex: row.pduId ? row.outletIndex : null })) });
    } finally {
      setSaving(false);
    }
  };

  return <Modal title={t('power.step.title', 'Ligações elétricas · {device}', { device: device.name })} close={onSkip}>
    <form className="modal-form power-step" onSubmit={(event) => void submit(event)} aria-label={t('power.step.open', 'Ligações elétricas')}>
      {moved && <p className="ipam-alert warning">{t('power.step.moved', 'O equipamento mudou de bastidor: as ligações anteriores foram removidas.')}</p>}
      {plugs === 0
        ? <p className="form-help">{t('power.step.noPower', 'Sem alimentação: este equipamento não tem fichas.')}</p>
        : <>
          <p className="form-help">{t('power.step.intro', 'Escolhe a PDU de cada ficha. A tomada livre seguinte é atribuída automaticamente.')}</p>
          <ol className="power-step-rows">
            {rows.map((row, index) => {
              const free = freeFor(row.pduId, index);
              return <li key={row.plugIndex} className="power-step-row" data-testid={`plug-row-${row.plugIndex}`}>
                <strong>{t('power.step.plug', 'Ficha {index}', { index: row.plugIndex })}</strong>
                <label>{t('power.step.pdu', 'PDU')}
                  <select value={row.pduId} aria-label={`${t('power.step.plug', 'Ficha {index}', { index: row.plugIndex })} · ${t('power.step.pdu', 'PDU')}`} onChange={(event) => update(index, { pduId: event.target.value, requested: event.target.value, outletIndex: null })}>
                    {pdus.map((pdu) => <option key={pdu.id} value={pdu.id}>{pduName(pdu.id)} · {t('power.step.free', '{count} livres', { count: freeFor(pdu.id, index).length })}</option>)}
                    <option value="">{t('power.step.unplugged', 'Não ligado')}</option>
                  </select>
                </label>
                <label>{t('power.step.outlet', 'Tomada')}
                  <select value={row.outletIndex ?? ''} disabled={!row.pduId} aria-label={`${t('power.step.plug', 'Ficha {index}', { index: row.plugIndex })} · ${t('power.step.outlet', 'Tomada')}`} onChange={(event) => update(index, { outletIndex: event.target.value ? Number(event.target.value) : null })}>
                    {!row.pduId && <option value="">—</option>}
                    {free.map((outlet) => <option key={outlet} value={outlet}>{outlet}</option>)}
                  </select>
                </label>
              </li>;
            })}
          </ol>
          <div className="power-step-notes" aria-live="polite">
            {fullPdus.map((id) => <p key={id} className="ipam-alert warning">{t('power.step.full', 'Sem tomadas livres em {pdu}: a ficha fica “Não ligado”.', { pdu: pduName(id) })}</p>)}
            {unplugged > 0 && <p className="ipam-alert warning">{t('power.step.unpluggedWarning', '{count} ficha(s) sem ligação. Podes guardar na mesma.', { count: unplugged })}</p>}
            {noRedundancy && <p className="form-help">{t('power.step.noRedundancy', 'Este bastidor não tem UPS: o equipamento não tem alimentação redundante.')}</p>}
          </div>
        </>}
      <FormError message={error} />
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onSkip}>{t('power.step.skip', 'Agora não')}</button>
        {plugs > 0 && <button className="primary-button" disabled={saving}><Check size={14} /> {saving ? t('power.step.saving', 'A guardar…') : t('power.step.save', 'Guardar ligações')}</button>}
      </div>
    </form>
  </Modal>;
}
