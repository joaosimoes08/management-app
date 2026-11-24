import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeviceList } from '@/features/infrastructure/components/devices/device-list';
import { RackEquipmentOverlay } from '@/features/infrastructure/components/rack/rack-equipment-overlay';
import { setActiveRackCard } from '@/features/infrastructure/components/rack/rack-device-hover-card';
import type { Device, Rack } from '@/features/infrastructure/types';
import type { SnmpHealthSummaryItem } from './health-api';

vi.mock('@/features/infrastructure/components/asset-image', () => ({ AssetImage: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }));
afterEach(() => { cleanup(); setActiveRackCard(null); });

const item = (deviceId: string, status: SnmpHealthSummaryItem['status'], issueCount = 0): SnmpHealthSummaryItem => ({ deviceId, status, issueCount, observedAt: '2026-11-24T10:00:00.000Z', rebootDetectedAt: null, stale: false });
const health = new Map([['sw', item('sw', 'DEGRADED', 2)], ['rtr', item('rtr', null)]]);

describe('SNMP health on the device list', () => {
  const devices = [
    { id: 'sw', name: 'Core switch', type: 'SWITCH', status: 'ACTIVE' },
    { id: 'rtr', name: 'Edge router', type: 'ROUTER', status: 'ACTIVE' },
    { id: 'srv', name: 'App server', type: 'SERVER', status: 'ACTIVE' },
  ] as Device[];

  it('shows a badge on network rows only, from the shared Site map', () => {
    const { container } = render(<DeviceList devices={devices} health={health} search="" onSelect={vi.fn()} onEdit={vi.fn()} onNew={vi.fn()} onRetire={vi.fn()} canRetire={false} canEdit={false} />);
    const rows = [...container.querySelectorAll<HTMLElement>('.infra-device-row')];
    expect(within(rows[0]).getByRole('img', { name: /Saúde SNMP: Degradado/ })).toHaveTextContent('Degradado · 2');
    expect(within(rows[1]).getByRole('img', { name: /Saúde SNMP: Sem dados/ })).toBeInTheDocument();
    expect(rows[2].querySelector('.snmp-health-badge')).toBeNull();
  });

  it('shows no badge when the user cannot read SNMP (no map passed)', () => {
    const { container } = render(<DeviceList devices={devices} search="" onSelect={vi.fn()} onEdit={vi.fn()} onNew={vi.fn()} onRetire={vi.fn()} canRetire={false} canEdit={false} />);
    expect(container.querySelector('.snmp-health-badge')).toBeNull();
  });
});

describe('SNMP health on the rack', () => {
  const rack: Rack = {
    id: 'rack-a', name: 'Core cabinet', roomId: 'room-1', units: 42,
    devices: [
      { id: 'sw', name: 'Core switch', type: 'SWITCH', status: 'ACTIVE', rackId: 'rack-a', rackUnitStart: 42, rackUnitSize: 1, managementIp: '10.0.0.1' } as Device,
      { id: 'srv', name: 'App server', type: 'SERVER', status: 'ACTIVE', rackId: 'rack-a', rackUnitStart: 40, rackUnitSize: 1 } as Device,
    ],
  };

  it('adds the health to the accessible name, a status dot and the hover card', () => {
    const { container } = render(<div className="rack-stage-wrap"><div className="rack-frame"><RackEquipmentOverlay rack={rack} health={health} face="front" onSelect={vi.fn()} onDropDevice={vi.fn()} draggingDeviceId="" onDragging={vi.fn()} canEdit={false} /></div></div>);
    const sw = screen.getByRole('button', { name: /Core switch.*Saúde SNMP: Degradado\. 2 problemas/ });
    expect(sw.querySelector('.rack-equipment-health')).toHaveAttribute('data-health', 'DEGRADED');
    expect(screen.getByRole('button', { name: /App server/ }).getAttribute('aria-label')).not.toMatch(/Saúde/);
    expect(container.querySelectorAll('.rack-equipment-health')).toHaveLength(1);
    fireEvent.mouseEnter(sw);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Saúde:Degradado · 2 problemas/);
  });
});
