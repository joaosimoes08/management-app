import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceForm } from './forms';
import type { DeviceModel } from './types';
import { DiscoveryPromotionSnmpOffer, matchDeviceModel, promotionDeviceForm, readDiscoveryPromotion, withoutDiscoveryPromotion } from './discovery-promotion';

const locale = vi.hoisted(() => ({ current: 'pt-PT' as 'pt-PT' | 'en-US' }));
vi.mock('@/lib/i18n/i18n', async () => {
  const real = await vi.importActual<typeof import('@/lib/i18n/i18n')>('@/lib/i18n/i18n');
  return { ...real, useOptionalI18n: () => ({ locale: locale.current, t: (key: string, fallback?: string, params?: Record<string, string | number>) => real.translateMessage(locale.current, key, fallback, params) }) };
});
vi.mock('@/features/snmp/snmp-setup-wizard', () => ({
  SnmpSetupWizard: ({ deviceId, deviceName }: { deviceId: string; deviceName: string }) => <div role="dialog" aria-label="SNMP wizard">{deviceId}:{deviceName}</div>,
}));

const models: DeviceModel[] = [
  { id: 'm1', manufacturer: 'Cisco', model: 'C9300-48P', type: 'SWITCH' },
  { id: 'm2', manufacturer: 'Fortinet', model: 'FG-100F', type: 'FIREWALL' },
  { id: 'm3', manufacturer: 'Acme', model: 'Twin' },
  { id: 'm4', manufacturer: 'Other', model: 'twin' },
];
const base = { name: '', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', modelId: '' } as DeviceForm;

beforeEach(() => { locale.current = 'pt-PT'; });
afterEach(cleanup);

describe('discovery promotion link', () => {
  it('reads the promotion keys and ignores other links', () => {
    expect(readDiscoveryPromotion('?siteId=s&promote=discovery&ip=10.0.0.5&name=sw-a&model=C9300-48P&serial=FOC1')).toEqual({ ip: '10.0.0.5', hostname: '', name: 'sw-a', ipAddressId: '', model: 'C9300-48P', serial: 'FOC1' });
    expect(readDiscoveryPromotion('?promote=discovery&ip=10.0.0.5')).toMatchObject({ name: '10.0.0.5' });
    expect(readDiscoveryPromotion('?promote=discovery')).toBeNull();
    expect(readDiscoveryPromotion('?siteId=s&ip=10.0.0.5')).toBeNull();
  });

  it('drops only the promotion keys from the URL', () => {
    expect(withoutDiscoveryPromotion('?siteId=s&tab=devices&promote=discovery&ip=1&hostname=h&name=n&ipAddressId=i&model=m&serial=x')).toBe('?siteId=s&tab=devices');
    expect(withoutDiscoveryPromotion('?promote=discovery&ip=1')).toBe('');
  });

  it('matches one catalogue model by name, with or without the manufacturer', () => {
    expect(matchDeviceModel(models, 'c9300-48p')?.id).toBe('m1');
    expect(matchDeviceModel(models, 'Fortinet FG-100F')?.id).toBe('m2');
    expect(matchDeviceModel(models, 'Twin')).toBeNull();
    expect(matchDeviceModel(models, 'unknown')).toBeNull();
    expect(matchDeviceModel(models, '')).toBeNull();
  });

  it('prefills the new-device form', () => {
    const promotion = { ip: '10.0.0.5', hostname: 'fw.lab', name: 'fw', ipAddressId: 'ip-5', model: 'FG-100F', serial: 'FGT123' };
    expect(promotionDeviceForm(base, promotion, models)).toMatchObject({ name: 'fw', hostname: 'fw.lab', managementIp: '10.0.0.5', managementIpAddressId: 'ip-5', modelId: 'm2', type: 'FIREWALL', serialNumber: 'FGT123' });
    const plain = promotionDeviceForm(base, { ...promotion, model: '', serial: '' }, models);
    expect(plain).toMatchObject({ modelId: '', type: 'SWITCH' });
    expect(plain).not.toHaveProperty('serialNumber');
  });
});

describe('SNMP offer after the promoted device is created', () => {
  it('lets an administrator open the existing SNMP wizard for the new device', () => {
    const close = vi.fn();
    render(<DiscoveryPromotionSnmpOffer device={{ id: 'dev-1', name: 'sw-a' }} canConfigureSnmp close={close} />);
    expect(screen.getByRole('dialog', { name: 'Equipamento criado' })).toHaveTextContent('sw-a foi criado a partir do resultado da discovery.');
    fireEvent.click(screen.getByRole('button', { name: 'Configurar SNMP' }));
    expect(screen.getByRole('dialog', { name: 'SNMP wizard' })).toHaveTextContent('dev-1:sw-a');
  });

  it('tells other roles that an administrator sets SNMP up, and closes', () => {
    locale.current = 'en-US';
    const close = vi.fn();
    render(<DiscoveryPromotionSnmpOffer device={{ id: 'dev-1', name: 'sw-a' }} canConfigureSnmp={false} close={close} />);
    expect(screen.getByRole('dialog', { name: 'Device created' })).toHaveTextContent('An administrator sets up SNMP');
    expect(screen.queryByRole('button', { name: 'Set up SNMP' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(close).toHaveBeenCalled();
  });
});
