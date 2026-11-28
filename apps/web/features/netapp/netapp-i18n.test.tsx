import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { messages as deDE } from '@/lib/i18n/messages/netapp/de-DE';
import { messages as esES } from '@/lib/i18n/messages/netapp/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/netapp/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/netapp/it-IT';

const files = ['netapp-page.tsx', 'netapp-capacity.tsx'];

// The NetApp screens moved from hard-coded Portuguese (translated on the page from source-text-messages.ts)
// to keyed messages. Each key renders exactly the old Portuguese, and en-US what the page showed before.
// Two English values are corrections: today the source-text table leaves "CONFIGURADO" and the " em "
// between user and endpoint in Portuguese. Texts that used to be split into several DOM fragments
// ("A última atualização falhou (" + code + "). …") compare with the English of those fragments joined.
type Expected = string | (() => string);
const keyed: Array<[key: string, portuguese: string, params?: Record<string, string | number>, english?: Expected]> = [
  ['netapp.operationFailed', "A operação NetApp falhou."],
  ['netapp.notice.saved', "A configuração foi guardada."],
  ['netapp.notice.refreshed', "Snapshot atualizado a partir do ONTAP."],
  ['netapp.refresh', "Atualizar"],
  ['netapp.snapshot.querying', "A consultar…"],
  ['netapp.snapshot.refresh', "Atualizar snapshot"],
  ['netapp.description', "Inventário de storage, capacidade e saúde, isolado ao Site selecionado."],
  ['netapp.site.loading', "A carregar o Site…"],
  ['netapp.site.select', "Seleciona um Site para continuar"],
  ['netapp.site.scopeNote', "Os dados e a configuração NetApp são consultados apenas para o Site ativo."],
  ['netapp.site.selected', "Site selecionado"],
  ['netapp.status.lastRefreshFailed', "ÚLTIMA ATUALIZAÇÃO COM FALHA"],
  ['netapp.status.configured', "CONFIGURADO", undefined, 'CONFIGURED'],
  ['netapp.status.noSnapshot', "SEM SNAPSHOT"],
  ['netapp.status.notConfigured', "NÃO CONFIGURADO"],
  ['netapp.status.loading', "A CARREGAR"],
  ['netapp.loadingIntegration', "A carregar a configuração e o último snapshot deste Site…"],
  ['netapp.loadError.title', "Não foi possível carregar os dados NetApp deste Site."],
  ['netapp.loadError.retry', "Usa “Atualizar” na barra superior para tentar novamente."],
  ['netapp.missing.title', "Este Site ainda não tem integração NetApp"],
  ['netapp.missing.description', "Um administrador pode configurar o endereço HTTPS do ONTAP e uma conta apenas de leitura. Não serão enviados comandos de alteração ao storage."],
  ['netapp.config.update', "Atualizar configuração"],
  ['netapp.config.setup', "Configurar integração"],
  ['netapp.config.secretNote', "O segredo nunca é devolvido ao browser. Para substituir a configuração, introduz a nova palavra-passe da conta ONTAP."],
  ['netapp.config.endpoint', "Endpoint HTTPS (origem)"],
  ['netapp.config.username', "Utilizador ONTAP"],
  ['netapp.config.newPassword', "Nova palavra-passe"],
  ['netapp.config.password', "Palavra-passe"],
  ['netapp.config.saving', "A guardar…"],
  ['netapp.config.save', "Guardar configuração"],
  ['netapp.config.configuredFor', "Configurado para"],
  ['netapp.config.at', "em", undefined, 'at'],
  ['netapp.summary.title', "Estado da integração"],
  ['netapp.systems', "Sistemas"],
  ['netapp.nodes', "Nós"],
  ['netapp.volumes', "Volumes"],
  ['netapp.aggregates', "Aggregates"],
  ['netapp.health', "Saúde"],
  ['netapp.summary.noData', "Sem dados"],
  ['netapp.summary.totalCapacity', "Capacidade total"],
  ['netapp.summary.used', "Utilizada"],
  ['netapp.summary.free', "Livre"],
  ['netapp.summary.lastSuccess', "Último sucesso"],
  ['netapp.summary.lastAttempt', "Última tentativa"],
  ['netapp.lastRefreshFailed', "A última atualização falhou (E42). Os dados abaixo são o último snapshot conhecido e foram mantidos.", { code: 'E42' }, () => 'The last refresh failed (' + 'E42' + '). The data below is the last known snapshot and was kept.'],
  ['netapp.noSnapshot.title', "Ainda não existe snapshot"],
  ['netapp.noSnapshot.hint', "Usa “Atualizar snapshot” para importar sistemas, nós, aggregates, volumes, capacidade e saúde."],
  ['netapp.table.system', "Sistema"],
  ['netapp.table.version', "Versão"],
  ['netapp.table.serial', "Número de série / UUID"],
  ['netapp.table.node', "Nó"],
  ['netapp.table.eligibility', "Elegibilidade"],
  ['netapp.table.empty', "Sem registos neste snapshot."],
  ['netapp.observedAt', "Snapshot observado em 01/01/2027.", { date: '01/01/2027' }, () => 'Snapshot observed on ' + '01/01/2027' + '.'],
  ['netapp.capacity.state', "Estado"],
  ['netapp.capacity.used', "Utilizado"],
  ['netapp.capacity.total', "Total"],
  ['netapp.capacity.usedPercent', "% utilizado"],
  ['netapp.capacity.viewTrend', "Ver tendência"],
  ['netapp.capacity.viewTrendOf', "Ver tendência de vol1", { name: 'vol1' }],
  ['netapp.top.title', "Top 10 mais cheios"],
  ['netapp.top.empty', "Sem dados de capacidade neste snapshot."],
  ['netapp.trend.loadError', "Não foi possível carregar a tendência."],
  ['netapp.trend.projectedFull', "Ao ritmo recente, ficará cheio por volta de 01/01/2027.", { date: '01/01/2027' }],
  ['netapp.trend.noGrowth', "Sem crescimento no período observado."],
  ['netapp.trend.notEnoughSamples', "Ainda não há amostras suficientes para estimar o crescimento."],
  ['netapp.trend.noExhaustion', "Não se prevê esgotamento ao ritmo atual."],
  ['netapp.trend.lastDays', "Últimos 30 dias", { count: 30 }],
  ['netapp.trend.description', "Amostras diárias guardadas a cada atualização do snapshot."],
  ['netapp.trend.object', "Objeto"],
  ['netapp.trend.cluster', "Cluster (total)"],
  ['netapp.trend.loading', "A carregar…"],
  ['netapp.trend.noObjects', "Sem objetos com amostras"],
  ['netapp.trend.period', "Período"],
  ['netapp.trend.days', "30 dias", { count: 30 }],
  ['netapp.trend.truncated', "A lista de objetos foi truncada pela API; usa “Ver tendência” nas tabelas para os restantes."],
  ['netapp.trend.loadingTrend', "A carregar a tendência…"],
  ['netapp.trend.usedPercent', "45% utilizado", { value: '45%' }],
  ['netapp.trend.usedBytes', "1 GB utilizado", { value: '1 GB' }],
  ['netapp.trend.chartLabel', "Tendência de capacidade de cluster", { name: 'cluster' }],
  ['netapp.trend.change', "Variação no período: +1 GB", { value: '+1 GB' }],
  ['netapp.trend.perDay', " · 1 GB/dia", { value: '1 GB' }],
  ['netapp.trend.noSamples', "Ainda não há amostras de capacidade para este objeto."],
];

describe('netapp keyed messages', () => {
  it.each(keyed)('%s renders the same Portuguese and English as before', (key, portuguese, params, english) => {
    expect(translateMessage('pt-PT', key, undefined, params)).toBe(portuguese);
    const expected = typeof english === 'function' ? english() : english;
    if (expected !== undefined) expect(translateMessage('en-US', key, undefined, params)).toBe(expected);
  });

  it('renders the singular day forms', () => {
    expect(translateMessage('pt-PT', 'netapp.trend.days', undefined, { count: 1 })).toBe('1 dia');
    expect(translateMessage('en-US', 'netapp.trend.lastDays', undefined, { count: 1 })).toBe('Last 1 day');
  });

  it('covers every key the NetApp components use, in both locales and the added languages', () => {
    const used = new Set(files.flatMap((file) => [...readFileSync(join(__dirname, file), 'utf8').matchAll(/'(netapp\.[\w.]+)'/g)].map((match) => match[1])));
    expect([...used].sort()).toEqual([...new Set(keyed.map(([key]) => key))].sort());
    for (const [key] of keyed) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅', { count: 2 })).not.toBe('∅');
      for (const bundle of [esES, frFR, deDE, itIT]) expect(bundle[key] ?? bundle[`${key}.other`], key).toBeTruthy();
    }
  });

  it('leaves no Portuguese literal in the NetApp components', () => {
    for (const file of files) {
      const source = readFileSync(join(__dirname, file), 'utf8').replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(source, file).not.toMatch(/[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/);
      expect(source, file).not.toMatch(/\b(Atualizar|Sistemas|Estado|Utilizado|Livre|Objeto|dias)\b/);
    }
  });
});
