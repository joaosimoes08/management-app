'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDevice } from '../../api';
import type { Device, RackFace } from '../../types';
import { normalizedPortLayoutPorts, primaryPortFace } from '../../utils';
import { DeviceImageFrame } from '../device-image-frame';
import { RackFaceToggle } from './rack-face-toggle';

const FACE_OPTIONS: { value: RackFace; label: string }[] = [{ value: 'front', label: 'Frente' }, { value: 'rear', label: 'Traseira' }];

interface RackDeviceZoomProps {
  deviceId: string;
  onBack: () => void;
  onInterfaces: (device: Device) => void;
  onEditDevice?: (device: Device) => void;
  /** Face shown by the rack when the device was opened; otherwise the face with mapped ports. */
  initialFace?: RackFace;
}

/** Modal zoom of a rack device with its port layout and management details. */
export function RackDeviceZoom({ deviceId, onBack, onInterfaces, onEditDevice, initialFace }: RackDeviceZoomProps) {
  const [closing, setClosing] = useState(false);
  const [chosenFace, setChosenFace] = useState<RackFace | null>(initialFace ?? null);
  const requestClose = () => setClosing(true);
  const { data: device, isLoading: loading } = useQuery({
    queryKey: ['infrastructure', 'device', deviceId],
    queryFn: () => getDevice(deviceId),
    enabled: Boolean(deviceId),
  });

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === 'Escape' && requestClose();
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onBack, 240);
    return () => window.clearTimeout(timer);
  }, [closing, onBack]);

  const wrapperClass = `rack-device-focus${closing ? ' rack-device-focus-closing' : ''}`;

  if (loading) return <div className={wrapperClass} onMouseDown={requestClose}><div className="rack-focus-loading" onMouseDown={(event) => event.stopPropagation()}>A carregar dispositivo…</div></div>;
  if (!device) return <div className={wrapperClass} onMouseDown={requestClose}><div className="rack-focus-loading" onMouseDown={(event) => event.stopPropagation()}>Não foi possível carregar o dispositivo.</div></div>;

  const face = chosenFace ?? primaryPortFace(device.model);
  const portFace = primaryPortFace(device.model);
  const portsElsewhere = face !== portFace && !normalizedPortLayoutPorts(device, face).length && normalizedPortLayoutPorts(device, portFace).length > 0;

  return <div className={wrapperClass} onMouseDown={requestClose}><div className="rack-focus-backdrop" /><div className="rack-device-focus-content" onMouseDown={(event) => event.stopPropagation()}><div className="rack-device-focus-stage"><div className="rack-device-focus-bar"><RackFaceToggle label="Face do equipamento" value={face} options={FACE_OPTIONS} onChange={setChosenFace} />{portsElsewhere && <small role="status">{portFace === 'rear' ? 'As portas estão mapeadas na traseira.' : 'As portas estão mapeadas na frente.'}</small>}</div><DeviceImageFrame device={device} interfaces={device.interfaces ?? []} face={face} /></div><aside className="rack-device-info"><span className="section-kicker">EQUIPAMENTO</span><h2>{device.name}</h2><dl><div><dt>Hostname</dt><dd>{device.hostname || 'Não definido'}</dd></div><div><dt>IP de gestão</dt><dd>{device.managementIp || 'Não definido'}</dd></div><div><dt>Modelo</dt><dd>{device.model ? `${device.model.manufacturer} ${device.model.model}` : 'Não definido'}</dd></div><div><dt>Uptime</dt><dd>Não disponível — requer SNMP/agente</dd></div></dl><div className="button-row"><button className="secondary-button" onClick={requestClose}>Voltar ao bastidor</button>{onEditDevice && <button className="secondary-button" onClick={() => onEditDevice(device)}>Editar equipamento</button>}<button className="primary-button" onClick={() => onInterfaces(device)}>Abrir ficha completa</button></div></aside></div></div>;
}
