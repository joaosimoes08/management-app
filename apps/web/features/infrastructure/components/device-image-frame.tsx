'use client';

import { useState } from 'react';
import { EquipmentTypeIcon } from './equipment-type-icon';
import type { Device, DeviceInterface, PortLayout } from '../types';
import { formatPortTooltipTitle, getInterfaceSubnets, getInterfaceVlans, normalizedPortLayoutPorts } from '../utils';
import { AssetImage } from './asset-image';

interface DeviceImageFrameProps {
  device: Device;
  interfaces: DeviceInterface[];
}

/** Device front image with clickable port hotspots, VLAN tooltips and IPAM cross-links. */
export function DeviceImageFrame({ device, interfaces }: DeviceImageFrameProps) {
  const [activePort, setActivePort] = useState('');
  const image = device.frontAsset || device.model?.frontAsset;
  const layout: Partial<PortLayout> = device.model && typeof device.model.portLayout === 'object' && device.model.portLayout ? device.model.portLayout : {};
  const ports = normalizedPortLayoutPorts(device);
  const width = Number(layout.imageWidth) || 1000;
  const height = Number(layout.imageHeight) || 300;
  const byPort = (port: { portKey: string }) => interfaces.find((item) => item.portKey === port.portKey || item.name === port.portKey);
  const activeLayoutPort = ports.find((port) => port.portKey === activePort);
  const activeInterface = activeLayoutPort ? byPort(activeLayoutPort) : null;
  const activeVlans = getInterfaceVlans(activeInterface);

  return <div className="device-image-frame" style={{ aspectRatio: `${width} / ${height}` }}>
    {image ? <AssetImage asset={image} alt={`Imagem de ${device.name}`} /> : <div className="switch-face-fallback"><EquipmentTypeIcon type={device.type} alt={`Ícone de ${device.type}`} className="equipment-type-icon-large"/><strong>{device.name}</strong></div>}
    {ports.map((port) => {
      const item = byPort(port);
      const allowedVlans = (item?.allowedVlans ?? []).map((x) => x?.vlan?.vlanId ?? x?.vlanId).filter(Boolean);
      const subnets = getInterfaceSubnets(item);
      const vlanSummary = item?.accessVlan
        ? `VLAN access ${item.accessVlan.vlanId}`
        : item?.nativeVlan
          ? `VLAN nativa ${item.nativeVlan.vlanId}`
          : allowedVlans.length
            ? `Allowed: ${allowedVlans.join(', ')}`
            : 'Sem VLAN configurada';
      return <div key={port.portKey} role="button" tabIndex={0} onClick={() => setActivePort(activePort === port.portKey ? '' : port.portKey)} onKeyDown={(event) => event.key === 'Enter' && setActivePort(activePort === port.portKey ? '' : port.portKey)} className={`rack-port-hotspot ${item?.operUp ? 'up' : ''}`} style={{ left: `${Number(port.x || 0) * 100}%`, top: `${Number(port.y || 0) * 100}%`, width: `${Number(port.width || .03) * 100}%`, height: `${Number(port.height || .3) * 100}%` }} aria-label={`Porta ${port.label || port.portKey}`}>
        <span>{port.label || port.portKey}</span>
        <b className="rack-port-tooltip"><strong>{formatPortTooltipTitle(item, port)}</strong><small>{item?.mode || 'sem modo'} · {item?.operUp ? 'UP' : 'DOWN'}</small><small>{vlanSummary}</small>{item?.accessVlan && allowedVlans.length ? <small>Allowed: {allowedVlans.join(', ')}</small> : null}<small>{subnets.length ? `Subnet: ${subnets.join(', ')}` : 'Sem subnet'}</small></b>
      </div>;
    })}
    {activeLayoutPort && <div className="rack-port-popover" role="dialog" aria-label={`Porta ${activeLayoutPort.label || activeLayoutPort.portKey}`} style={{ left: `${(Number(activeLayoutPort.x || 0) + Number(activeLayoutPort.width || .03) / 2) * 100}%`, top: `calc(${(Number(activeLayoutPort.y || 0) + Number(activeLayoutPort.height || .3)) * 100}% + 8px)` }}><strong>{formatPortTooltipTitle(activeInterface, activeLayoutPort)}</strong>{activeVlans.map((linked) => <div key={linked.id}><span>VLAN {linked.vlanId} · {linked.name}</span>{linked.subnets?.length ? linked.subnets.map((network) => <a key={network.id} href={`/ipam?siteId=${encodeURIComponent(linked.siteId || network.siteId || '')}&vlanId=${encodeURIComponent(linked.id)}&subnetId=${encodeURIComponent(network.id)}&fromDeviceId=${encodeURIComponent(device.id)}&fromInterfaceId=${encodeURIComponent(activeInterface?.id || '')}`}>{network.cidr}</a>) : <a href={`/ipam?siteId=${encodeURIComponent(linked.siteId || '')}&vlanId=${encodeURIComponent(linked.id)}&fromDeviceId=${encodeURIComponent(device.id)}&fromInterfaceId=${encodeURIComponent(activeInterface?.id || '')}`}>Abrir VLAN no IPAM</a>}</div>)}{!activeVlans.length && <small>Sem VLAN associada.</small>}</div>}
  </div>;
}
