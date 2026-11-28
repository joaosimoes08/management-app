import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { snmpTrapCategoryLabel, snmpTrapCategoryLabels, snmpTrapStatusLabel, snmpTrapStatusLabels } from './snmp-trap-labels';
import { translateMessage } from '@/lib/i18n/i18n';
const pt = (key: string, fallback?: string, params?: Record<string, string | number>) => translateMessage('pt-PT', key, fallback, params);
const en = (key: string, fallback?: string, params?: Record<string, string | number>) => translateMessage('en-US', key, fallback, params);

const schema = readFileSync(resolve(process.cwd(), '../../packages/database/prisma/schema.prisma'), 'utf8');
const catalog = readFileSync(resolve(process.cwd(), '../../packages/snmp-core/src/trap-catalog.ts'), 'utf8');

describe('SNMP trap kind and status badges', () => {
  it('turns raw codes into PT words, never VENDOR or PROCESSED', () => {
    expect(snmpTrapCategoryLabel(pt, 'VENDOR')).toBe('Trap de fabricante');
    expect(snmpTrapStatusLabel(pt, 'PROCESSED')).toBe('Processada');
    expect(snmpTrapStatusLabel(pt, 'UNMATCHED')).toBe('Sem correspondência');
    expect(snmpTrapCategoryLabel(pt, null)).toBeNull();
    expect(snmpTrapStatusLabel(pt, 'SOMETHING_NEW')).toBe('SOMETHING_NEW');
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
    expect(snmpTrapCategoryLabel(en, 'VENDOR')).toBe('Vendor trap');
    expect(snmpTrapStatusLabel(en, 'PROCESSED')).toBe('Processed');
    for (const key of [...Object.values(snmpTrapCategoryLabels), ...Object.values(snmpTrapStatusLabels)]) {
      expect(en(key), key).not.toBe(pt(key));
      expect(en(key)).toBe(translateSourceText('en-US', pt(key)));
    }
  });
});
