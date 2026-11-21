import { afterEach, describe, expect, it } from 'vitest';
import { setFormatLocale } from '@/lib/format/date';
import { formatIpamPercent } from './utilization';
import { hostStatusLabel, ipStateLabel, observedStatusLabel, sourceLabel } from './ip-state';

afterEach(() => setFormatLocale('pt-PT'));

describe('IPAM labels never show raw enums', () => {
  it('translates IP states, including RESERVED and FREE', () => {
    expect(ipStateLabel('RESERVED')).toBe('Reservado');
    expect(ipStateLabel('FREE')).toBe('Livre');
  });

  it('translates Host manual status, observed status and source', () => {
    expect(hostStatusLabel('ACTIVE')).toBe('Ativo');
    expect(hostStatusLabel('MAINTENANCE')).toBe('Manutenção');
    expect(observedStatusLabel('OPEN')).toBe('Aberto');
    expect(observedStatusLabel('DISABLED')).toBe('Desativado');
    expect(sourceLabel('MANUAL')).toBe('Manual');
    expect(sourceLabel('SOMETHING_NEW')).toBe('Outra origem');
  });

  it('uses a decimal comma for pt-PT utilisation percentages', () => {
    setFormatLocale('pt-PT');
    expect(formatIpamPercent(0.39)).toBe('0,39%');
    setFormatLocale('en-US');
    expect(formatIpamPercent(0.39)).toBe('0.39%');
  });
});
