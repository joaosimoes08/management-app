'use client';

import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useState } from 'react';
import { EquipmentTypeIcon } from './equipment-type-icon';
import type { Device, DeviceInterface, PortLayout, RackFace } from '../types';
import { deviceFaceImage, formatPortTooltipTitle, getInterfaceSubnets, getInterfaceVlans, normalizePortLayout, normalizedPortLayoutPorts, primaryPortFace } from '../utils';
import { AssetImage } from './asset-image';
import { useI18n } from '@/lib/i18n';
import { useUiText } from '@/components/ui/use-ui-text';

interface DeviceImageFrameProps {
  device: Device;
  interfaces: DeviceInterface[];
  /** Face to draw; defaults to the face that carries the mapped ports. */
  face?: RackFace;
}

/** Device face image with clickable port hotspots, VLAN tooltips and IPAM cross-links. */
export function DeviceImageFrame({ device, interfaces, face: requestedFace }: DeviceImageFrameProps) {
  const ui = useUiText();
  const { t } = useI18n();
  const [activePort, setActivePort] = useState('');
  const face = requestedFace ?? primaryPortFace(device.model);
  const image = deviceFaceImage(device, face);
  const layout: Partial<PortLayout> = normalizePortLayout(device.model?.portLayout)[face] ?? {};
  const ports = normalizedPortLayoutPorts(device, face);
  const width = Number(layout.imageWidth) || 1000;
  const height = Number(layout.imageHeight) || 300;
  /** Rack-unit faces are wide and short: lay the no-image placeholder out in one line so it fits the frame. */
  const shortFace = height / width < 0.3;
  const missingLabel = face === 'rear' ? t('device.noRearImage') : t('device.noFrontImage');
  /** Mapped ports fill a short face, so the "no image" note goes in a caption below the frame instead of over a port. */
  const noteBelow = !image && shortFace && ports.length > 0;
  const byPort = (port: { portKey: string }) => interfaces.find((item) => item.portKey === port.portKey || item.name === port.portKey);
  const activeLayoutPort = ports.find((port) => port.portKey === activePort);
  useEscapeClose(() => setActivePort(''), Boolean(activeLayoutPort));
  const activeInterface = activeLayoutPort ? byPort(activeLayoutPort) : null;
  const activeVlans = getInterfaceVlans(activeInterface);

  return <>
  <div className="device-image-frame" data-face={face} style={{ aspectRatio: `${width} / ${height}` }}>
    {image ? <AssetImage asset={image} alt={ui('infra.imageOf', undefined, { name: device.name })} /> : noteBelow ? <div className="switch-face-fallback switch-face-fallback--inline" data-has-ports="true" aria-hidden="true" /> : <div className={`switch-face-fallback${shortFace ? ' switch-face-fallback--inline' : ''}`} data-has-ports={ports.length > 0 || undefined}><EquipmentTypeIcon type={device.type} alt={ui('infra.typeIconOf', undefined, { type: device.type })} className="equipment-type-icon-large"/><strong>{device.name}</strong><small>{missingLabel}</small></div>}
    {ports.map((port) => {
      const item = byPort(port);
      const allowedVlans = (item?.allowedVlans ?? []).map((x) => x?.vlan?.vlanId ?? x?.vlanId).filter(Boolean);
      const subnets = getInterfaceSubnets(item);
      const vlanSummary = item?.accessVlan
        ? ui('infra.vlanAccess', undefined, { id: item.accessVlan.vlanId })
        : item?.nativeVlan
          ? ui('infrastructure.deviceImageFrame.nativeVlan', undefined, { id: item.nativeVlan.vlanId })
          : allowedVlans.length
            ? `Allowed: ${allowedVlans.join(', ')}`
            : ui('infrastructure.deviceImageFrame.noConfiguredVlan');
      return <div key={port.portKey} role="button" tabIndex={0} onClick={() => setActivePort(activePort === port.portKey ? '' : port.portKey)} onKeyDown={(event) => event.key === 'Enter' && setActivePort(activePort === port.portKey ? '' : port.portKey)} className={`rack-port-hotspot ${item?.operUp ? 'up' : ''}`} style={{ left: `${Number(port.x || 0) * 100}%`, top: `${Number(port.y || 0) * 100}%`, width: `${Number(port.width || .03) * 100}%`, height: `${Number(port.height || .3) * 100}%` }} aria-label={ui('infra.portNamed', undefined, { port: port.label || port.portKey })}>
        <span>{port.label || port.portKey}</span>
        <b className="rack-port-tooltip"><strong>{formatPortTooltipTitle(item, port, ui)}</strong><small>{item?.mode || ui('infrastructure.deviceImageFrame.noMode')} · {item?.operUp ? 'UP' : 'DOWN'}</small><small>{vlanSummary}</small>{item?.accessVlan && allowedVlans.length ? <small>Allowed: {allowedVlans.join(', ')}</small> : null}<small>{subnets.length ? `Subnet: ${subnets.join(', ')}` : ui('infrastructure.deviceImageFrame.noSubnet')}</small></b>
      </div>;
    })}
    {activeLayoutPort && <div className="rack-port-popover" role="dialog" aria-label={ui('infra.portNamed', undefined, { port: activeLayoutPort.label || activeLayoutPort.portKey })} style={{ left: `${(Number(activeLayoutPort.x || 0) + Number(activeLayoutPort.width || .03) / 2) * 100}%`, top: `calc(${(Number(activeLayoutPort.y || 0) + Number(activeLayoutPort.height || .3)) * 100}% + 8px)` }}><strong>{formatPortTooltipTitle(activeInterface, activeLayoutPort)}</strong>{activeVlans.map((linked) => <div key={linked.id}><span>VLAN {linked.vlanId} · {linked.name}</span>{linked.subnets?.length ? linked.subnets.map((network) => <a key={network.id} href={`/ipam?siteId=${encodeURIComponent(linked.siteId || network.siteId || '')}&vlanId=${encodeURIComponent(linked.id)}&subnetId=${encodeURIComponent(network.id)}&fromDeviceId=${encodeURIComponent(device.id)}&fromInterfaceId=${encodeURIComponent(activeInterface?.id || '')}`}>{network.cidr}</a>) : <a href={`/ipam?siteId=${encodeURIComponent(linked.siteId || '')}&vlanId=${encodeURIComponent(linked.id)}&fromDeviceId=${encodeURIComponent(device.id)}&fromInterfaceId=${encodeURIComponent(activeInterface?.id || '')}`}>{ui('infrastructure.deviceImageFrame.openVlanInIpam')}</a>}</div>)}{!activeVlans.length && <small>{ui('infrastructure.deviceImageFrame.noLinkedVlan')}</small>}</div>}
  </div>
  {noteBelow && <p className="device-image-frame-note">{missingLabel}</p>}
  </>;
}
