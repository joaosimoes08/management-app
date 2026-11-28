'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { getDeviceRetirementReview, retireDevice, type DeviceRetirementReview } from '../../api';
import { useUiText } from '@/components/ui/use-ui-text';

const PREPARE_ERROR = 'infrastructure.retirementReviewModal.couldNotPrepareTheReview';

export function RetirementReviewModal({ deviceId, close, retired }: { deviceId: string; close: () => void; retired: () => void }) {
  const ui = useUiText();
  const [review, setReview] = useState<DeviceRetirementReview | null>(null);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { void getDeviceRetirementReview(deviceId).then(setReview).catch((cause) => setError(cause instanceof Error ? cause.message : PREPARE_ERROR)); }, [deviceId]);
  const submit = async () => { setSaving(true); try { await retireDevice(deviceId); retired(); } catch (cause) { setError(cause instanceof Error ? cause.message : ui('infrastructure.retirementReviewModal.couldNotRetireTheDevice')); setSaving(false); } };
  return <Modal title={ui('infra.retirement.title', undefined, { name: review?.device.name ?? ui('infra.retirement.device') })} close={close}>
    {error && <div className="ipam-alert error">{error === PREPARE_ERROR ? ui(PREPARE_ERROR) : error}</div>}
    {!review ? <p>{ui('infrastructure.retirementReviewModal.loadingInterfacesIpsAndMap')}</p> : <div className="modal-form">
      <h3>Interfaces ({review.interfaces.length})</h3>{review.interfaces.length ? review.interfaces.map((item) => <div key={item.id}>{item.name}</div>) : <p>{ui('infrastructure.retirementReviewModal.noLinkedInterfaces')}</p>}
      <h3>{ui('infra.retirement.ipAddresses', undefined, { count: review.ipAddresses.length })}</h3>{review.ipAddresses.length ? review.ipAddresses.map((ip) => <div key={ip.id}>{ip.address} · {ip.subnet.cidr}{ip.interface ? ` · ${ip.interface.name}` : ''}</div>) : <p>{ui('infrastructure.retirementReviewModal.noLinkedIpAddresses')}</p>}
      <h3>{ui('infra.retirement.mapReferences', undefined, { count: review.mapReferences.length })}</h3>{review.mapReferences.length ? review.mapReferences.map((map) => <div key={map.id}>{map.name} · {map.type}</div>) : <p>{ui('infrastructure.retirementReviewModal.noMapReferences')}</p>}
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> {ui('infrastructure.retirementReviewModal.iConfirmThatIReviewed')}</label>
      <button type="button" className="danger-button" disabled={!confirmed || saving} onClick={() => void submit()}>{saving ? ui('infrastructure.retirementReviewModal.retiring') : ui('infrastructure.retirementReviewModal.confirmRetirement')}</button>
    </div>}
  </Modal>;
}
