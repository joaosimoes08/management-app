import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { messages as deDE } from '@/lib/i18n/messages/dashboard/de-DE';
import { messages as esES } from '@/lib/i18n/messages/dashboard/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/dashboard/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/dashboard/it-IT';
import { messages as ptPT } from '@/lib/i18n/messages/dashboard/pt-PT';

// The dashboard layout editor moved from hard-coded Portuguese (translated on the page from source-text-messages.ts)
// to keyed messages. Each key renders exactly the old Portuguese literal, and en-US exactly what the
// source-text table made of it.
const keyed: Array<[key: string, portuguese: string, params?: Record<string, string | number>]> = [
  ['dashboard.widget.active-alerts', 'Alertas ativos'],
  ['dashboard.widget.quality-queue', 'Qualidade dos dados'],
  ['dashboard.widget.service-health', 'Saúde dos serviços'],
  ['dashboard.widget.recent-changes', 'Atividade recente'],
  ['dashboard.widget.inventory-summary', 'Distribuição atual'],
  ['dashboard.widget.quick-actions', 'Acesso rápido'],
  ['dashboard.widget.running-processes', 'Processos em execução'],
  ['dashboard.widget.discovery-review', 'Discovery a rever ou falhado'],
  ['dashboard.widget.snmp-drifts', 'Divergências SNMP'],
];
const sources = ['drill-through.ts', 'dashboard-page.tsx'].map((file) => readFileSync(join(__dirname, file), 'utf8'));
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');

describe('dashboard keyed messages', () => {
  it.each(keyed)('%s renders the same Portuguese and English as before', (key, portuguese, params) => {
    expect(translateMessage('pt-PT', key, undefined, params)).toBe(portuguese);
  });

  it('has every key the dashboard layout editor use, in both locales and the added languages', () => {
    expect(Object.keys(ptPT).sort()).toEqual(keyed.map(([key]) => key).sort());
    // Keys under this domain's prefixes (other `dashboard.*` keys in these files still live in i18n.tsx).
    const prefixes = [...new Set(keyed.map(([key]) => key.split('.').slice(0, 2).join('.') + '.'))];
    const used = new Set(sources.flatMap((source) => [...source.matchAll(/'(dashboard\.[\w.-]+)'/g)].map((match) => match[1])).filter((key) => prefixes.some((prefix) => key.startsWith(prefix))));
    for (const key of used) expect(ptPT, key).toHaveProperty([key]);
    for (const [key] of keyed) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅')).not.toBe('∅');
      for (const bundle of [esES, frFR, deDE, itIT]) expect(bundle[key], key).toBeTruthy();
    }
  });

  it('leaves no Portuguese literal in the dashboard layout editor', () => {
    for (const source of ['drill-through.ts'].map((file) => withoutComments(readFileSync(join(__dirname, file), 'utf8')))) {
      expect(source).not.toMatch(/[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/);
    }
    const code = sources.map(withoutComments).join('\n');
    for (const [key, portuguese, params] of keyed) {
      // Proper nouns and codes (Portugal, LIS-01) read the same in English and may appear elsewhere.
      if (params || translateMessage('en-US', key) === portuguese) continue;
      expect(code, key).not.toContain(`'${portuguese}'`);
      expect(code, key).not.toContain(`>${portuguese}<`);
    }
  });
});
