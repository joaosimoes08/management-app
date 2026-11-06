'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { getDeviceRetirementReview, retireDevice, type DeviceRetirementReview } from '../../api';

export function RetirementReviewModal({ deviceId, close, retired }: { deviceId: string; close: () => void; retired: () => void }) {
  const [review, setReview] = useState<DeviceRetirementReview | null>(null);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void getDeviceRetirementReview(deviceId).then(setReview).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a revisão.')); }, [deviceId]);
  const submit = async () => { setSaving(true); try { await retireDevice(deviceId); retired(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível retirar o equipamento.'); setSaving(false); } };
  return <Modal title={`Revisão de retirada · ${review?.device.name ?? 'Equipamento'}`} close={close}>
    {error && <div className="ipam-alert error">{error}</div>}
    {!review ? <p>A carregar interfaces, IPs e referências a mapas…</p> : <div className="modal-form">
      <h3>Interfaces ({review.interfaces.length})</h3>{review.interfaces.length ? review.interfaces.map((item) => <div key={item.id}>{item.name}</div>) : <p>Sem interfaces associadas.</p>}
      <h3>Endereços IP ({review.ipAddresses.length})</h3>{review.ipAddresses.length ? review.ipAddresses.map((ip) => <div key={ip.id}>{ip.address} · {ip.subnet.cidr}{ip.interface ? ` · ${ip.interface.name}` : ''}</div>) : <p>Sem endereços IP associados.</p>}
      <h3>Referências em mapas ({review.mapReferences.length})</h3>{review.mapReferences.length ? review.mapReferences.map((map) => <div key={map.id}>{map.name} · {map.type}</div>) : <p>Sem referências em mapas.</p>}
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> Confirmo que revi as interfaces, os endereços IP e as referências a mapas antes de retirar este equipamento.</label>
      <button type="button" className="danger-button" disabled={!confirmed || saving} onClick={() => void submit()}>{saving ? 'A retirar…' : 'Confirmar retirada'}</button>
    </div>}
  </Modal>;
}
