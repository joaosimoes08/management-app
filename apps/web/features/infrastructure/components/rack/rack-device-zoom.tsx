'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDevice } from '../../api';
import type { Device, RackFace } from '../../types';
import { normalizedPortLayoutPorts, primaryPortFace } from '../../utils';
import { DeviceImageFrame } from '../device-image-frame';
import { useUiText } from '@/components/ui/use-ui-text';

interface RackDeviceZoomProps {
  deviceId: string;
  onBack: () => void;
  onInterfaces: (device: Device) => void;
  onEditDevice?: (device: Device) => void;
  /** Face to show, chosen in the rack: the utility-bar view, or in "Ambas" the face the device was clicked on. */
  face: RackFace;
}

/** Modal zoom of a rack device with its port layout and management details. */
export function RackDeviceZoom({ deviceId, onBack, onInterfaces, onEditDevice, face }: RackDeviceZoomProps) {
  const ui = useUiText();
  const [closing, setClosing] = useState(false);
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

  if (loading) return <div className={wrapperClass} onMouseDown={requestClose}><div className="rack-focus-loading" onMouseDown={(event) => event.stopPropagation()}>{ui('infrastructure.rackDeviceZoom.loadingDevice')}</div></div>;
  if (!device) return <div className={wrapperClass} onMouseDown={requestClose}><div className="rack-focus-loading" onMouseDown={(event) => event.stopPropagation()}>{ui('infrastructure.rackDeviceZoom.couldNotLoadTheDevice')}</div></div>;

  const portFace = primaryPortFace(device.model);
  const portsElsewhere = face !== portFace && !normalizedPortLayoutPorts(device, face).length && normalizedPortLayoutPorts(device, portFace).length > 0;

  return <div className={wrapperClass} onMouseDown={requestClose}><div className="rack-focus-backdrop" /><div className="rack-device-focus-content" onMouseDown={(event) => event.stopPropagation()}><div className="rack-device-focus-stage" data-face={face}>{portsElsewhere && <div className="rack-device-focus-bar"><small role="status">{portFace === 'rear' ? ui('infrastructure.rackDeviceZoom.portsAreMappedOnThe') : ui('infrastructure.rackDeviceZoom.portsAreMappedOnThe2')}</small></div>}<DeviceImageFrame device={device} interfaces={device.interfaces ?? []} face={face} /></div><aside className="rack-device-info"><h2>{device.name}</h2><dl><div><dt>Hostname</dt><dd>{device.hostname || ui('infrastructure.rackDeviceZoom.notSet')}</dd></div><div><dt>{ui('infrastructure.rackDeviceZoom.managementIp')}</dt><dd>{device.managementIp || ui('infrastructure.rackDeviceZoom.notSet')}</dd></div><div><dt>{ui('infrastructure.rackDeviceZoom.model')}</dt><dd>{device.model ? `${device.model.manufacturer} ${device.model.model}` : ui('infrastructure.rackDeviceZoom.notSet')}</dd></div><div><dt>Uptime</dt><dd>{ui('infrastructure.rackDeviceZoom.unavailableRequiresSnmpAgent')}</dd></div></dl><div className="button-row"><button className="secondary-button" onClick={requestClose}>{ui('infrastructure.rackDeviceZoom.backToRack')}</button>{onEditDevice && <button className="secondary-button" onClick={() => onEditDevice(device)}>{ui('infrastructure.rackDeviceZoom.editEquipment')}</button>}<button className="primary-button" onClick={() => onInterfaces(device)}>{ui('infrastructure.rackDeviceZoom.openFullRecord')}</button></div></aside></div></div>;
}
