import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { snmpTrapCategoryLabel, snmpTrapCategoryLabels, snmpTrapStatusLabel, snmpTrapStatusLabels } from './snmp-trap-labels';

const schema = readFileSync(resolve(process.cwd(), '../../packages/database/prisma/schema.prisma'), 'utf8');
const catalog = readFileSync(resolve(process.cwd(), '../../packages/snmp-core/src/trap-catalog.ts'), 'utf8');

describe('SNMP trap kind and status badges', () => {
  it('turns raw codes into PT words, never VENDOR or PROCESSED', () => {
    expect(snmpTrapCategoryLabel('VENDOR')).toBe('Trap de fabricante');
    expect(snmpTrapStatusLabel('PROCESSED')).toBe('Processada');
    expect(snmpTrapStatusLabel('UNMATCHED')).toBe('Sem correspondência');
    expect(snmpTrapCategoryLabel(null)).toBeNull();
    expect(snmpTrapStatusLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('covers every trap status in the database enum and every category in the trap catalog', () => {
    const statuses = schema.match(/enum SnmpTrapStatus \{([\s\S]*?)\}/)?.[1].split('\n').map((line) => line.trim()).filter((line) => /^[A-Z_]+$/.test(line)) ?? [];
    expect(statuses.length).toBeGreaterThan(5);
    expect(statuses.filter((status) => !(status in snmpTrapStatusLabels))).toEqual([]);
    const categories = [...new Set([...catalog.matchAll(/category: '([A-Z_]+)'/g)].map((match) => match[1]))];
    expect(categories).toContain('VENDOR');
    expect(categories.filter((category) => !(category in snmpTrapCategoryLabels))).toEqual([]);
  });

  it('has an English translation for every PT label', () => {
    expect(translateSourceText('en-US', 'Trap de fabricante')).toBe('Vendor trap');
    expect(translateSourceText('en-US', 'Processada')).toBe('Processed');
    for (const label of [...Object.values(snmpTrapCategoryLabels), ...Object.values(snmpTrapStatusLabels)]) {
      expect(translateSourceText('en-US', label), label).not.toBe(label);
      expect(translateSourceText('pt-PT', label)).toBe(label);
    }
  });
});
