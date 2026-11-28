import { describe, expect, it } from 'vitest';
import { translateMessage, type AppLocale } from './i18n';
import { loadLocaleBundle } from './locales/loader';
import { messages as deDE } from './messages/server/de-DE';
import { messages as enUS } from './messages/server/en-US';
import { messages as esES } from './messages/server/es-ES';
import { messages as frFR } from './messages/server/fr-FR';
import { messages as itIT } from './messages/server/it-IT';
import { messages as ptPT } from './messages/server/pt-PT';
import { localizeServerText, localizeServerTextFor, localizeServerTextList, type ServerTextTranslate } from './server-text';

const tFor = (locale: AppLocale): ServerTextTranslate => (key, fallback, params) => translateMessage(locale, key, fallback, params);
const en = tFor('en-US');
const pt = tFor('pt-PT');
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

// Every templated server text, with values filled in as the API sends them.
const templated: Array<[key: keyof typeof ptPT, api: string, english: string]> = [
  ['server.requiredConfig.rearImageAlertMany', '4 dispositivos sem imagem traseira', '4 devices without a rear image'],
  ['server.inventory.detail.trunkNoVlans', 'core-sw-01 · Gi1/0/24 não tem VLANs permitidas.', 'core-sw-01 · Gi1/0/24 has no allowed VLANs.'],
  ['server.inventory.detail.staleSnmp', 'edge-fw-02 não é observado por SNMP há mais de 30 dias.', 'edge-fw-02 has not been observed by SNMP for more than 30 days.'],
  ['server.snmp.fleetMaxDevices', 'deviceIds aceita no máximo 200 equipamentos.', 'deviceIds accepts at most 200 devices.'],
  ['server.snmp.observedBy', 'Dispositivo observado por LLDP', 'Device observed by LLDP'],
  ['server.snmp.trap.utilization', 'utilização 93%', 'usage 93%'],
  ['server.snmp.trap.threshold', 'limiar 80%', 'threshold 80%'],
];

describe('server text tables', () => {
  it('has the same keys and placeholders in every locale', () => {
    for (const table of [enUS, esES, frFR, deDE, itIT] as Array<Record<string, string>>) {
      expect(Object.keys(table).sort()).toEqual(Object.keys(ptPT).sort());
      for (const [key, text] of Object.entries(ptPT)) expect(placeholders(table[key]), key).toEqual(placeholders(text));
    }
  });

  it('lists every templated text in this test', () => {
    const withParams = Object.entries(ptPT).filter(([, text]) => placeholders(text).length).map(([key]) => key).sort();
    expect(templated.map(([key]) => key).sort()).toEqual(withParams);
  });
});

describe('localizeServerText', () => {
  it.each(Object.entries(ptPT).filter(([, text]) => !placeholders(text).length))('translates the exact text of %s', (key, api) => {
    expect(localizeServerText(pt, api)).toBe(api);
    expect(localizeServerText(en, api)).toBe(enUS[key as keyof typeof enUS]);
  });

  it.each(templated)('fills %s with the values the API sent', (key, api, english) => {
    expect(localizeServerText(pt, api)).toBe(api);
    expect(localizeServerText(en, api)).toBe(english);
    const calls: Array<Parameters<ServerTextTranslate>> = [];
    localizeServerText((...args) => { calls.push(args); return ''; }, api);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(key);
    expect(Object.keys(calls[0][2] ?? {}).sort()).toEqual(placeholders(ptPT[key]));
  });

  it('passes the exact parameters of a templated text', () => {
    const calls: Array<Record<string, string | number> | undefined> = [];
    localizeServerText((_key, _fallback, params) => { calls.push(params); return ''; }, 'core-sw-01 · Gi1/0/24 não tem VLANs permitidas.');
    expect(calls).toEqual([{ device: 'core-sw-01', interface: 'Gi1/0/24' }]);
  });

  it('keeps the whitespace around a known text', () => {
    expect(localizeServerText(en, '  O pedido não é válido.\n')).toBe(`  ${enUS['server.status.400']}\n`);
  });

  it('returns unknown text unchanged, including near matches and data values', () => {
    for (const text of ['core-sw-01', 'O pedido não é válido', 'O pedido não é válido. Tenta de novo.', 'utilização', 'utilização %', 'Equipamento · Lisboa', 'Host · sem hostname']) {
      expect(localizeServerText(en, text)).toBe(text);
    }
    expect(localizeServerText(en, '')).toBe('');
    expect(localizeServerText(en, null)).toBe('');
    expect(localizeServerText(en, undefined)).toBe('');
  });

  it('shows English API errors and other English text as sent', () => {
    expect(localizeServerText(en, 'Session expired')).toBe('Session expired');
    expect(localizeServerTextFor('es-ES', 'Request failed with status 500')).toBe('Request failed with status 500');
  });
});

describe('localizeServerTextList', () => {
  it('translates each part of a " · " list on its own', () => {
    expect(localizeServerTextList(en, 'Interface em baixo · utilização 93% · estado down')).toBe(`${enUS['server.snmp.trap.linkDown']} · usage 93% · estado down`);
    expect(localizeServerTextList(en, '')).toBe('');
  });
});

describe('localizeServerTextFor', () => {
  it('uses the server tables of the given locale', async () => {
    expect(localizeServerTextFor('pt-PT', 'O recurso não foi encontrado.')).toBe('O recurso não foi encontrado.');
    expect(localizeServerTextFor('en-US', 'O recurso não foi encontrado.')).toBe(enUS['server.status.404']);
    await loadLocaleBundle('es-ES');
    expect(localizeServerTextFor('es-ES', 'O recurso não foi encontrado.')).toBe(esES['server.status.404']);
    expect(localizeServerTextFor('es-ES', 'limiar 80%')).toBe('umbral 80%');
    expect(localizeServerTextFor('en-US', 'desconhecido')).toBe('desconhecido');
  });
});

// Review L3: API texts that main's on-page rewriter translated as whole texts. The values are what main 0715e74d showed per locale.
const mainWholeTexts: Array<[api: string, shown: Record<Exclude<AppLocale, 'pt-PT'>, string>]> = [
  ['Equipamento', { 'en-US': 'Equipment', 'es-ES': 'Dispositivo', 'fr-FR': 'Équipement', 'de-DE': 'Gerät', 'it-IT': 'Dispositivo' }],
  ['sem hostname', { 'en-US': 'no hostname', 'es-ES': 'sin hostname', 'fr-FR': 'sans nom d’hôte', 'de-DE': 'kein Hostname', 'it-IT': 'nessun hostname' }],
  ['traseira', { 'en-US': 'rear', 'es-ES': 'trasera', 'fr-FR': 'arrière', 'de-DE': 'Rückseite', 'it-IT': 'retro' }],
  ['modelo', { 'en-US': 'model', 'es-ES': 'modelo', 'fr-FR': 'modèle', 'de-DE': 'Modell', 'it-IT': 'modello' }],
  ['descoberta', { 'en-US': 'discovery', 'es-ES': 'descubrimiento', 'fr-FR': 'découverte', 'de-DE': 'Discovery', 'it-IT': 'rilevamento' }],
];

describe('API texts main translated as whole texts', () => {
  it.each(mainWholeTexts)('shows %s as main did in every locale', async (api, shown) => {
    expect(localizeServerText(pt, api)).toBe(api);
    for (const [locale, text] of Object.entries(shown) as Array<[Exclude<AppLocale, 'pt-PT'>, string]>) {
      if (locale !== 'en-US') await loadLocaleBundle(locale);
      expect(localizeServerText(tFor(locale), api), locale).toBe(text);
    }
  });
});
