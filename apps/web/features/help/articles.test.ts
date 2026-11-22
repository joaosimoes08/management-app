import { describe, expect, it } from 'vitest';
import { helpArticle, helpArticleForPath, helpArticles, infrastructureHelpTopic } from './articles';

describe('help articles', () => {
  it('have unique slugs and non-empty bodies', () => {
    const slugs = helpArticles.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const article of helpArticles) expect(article.body.length).toBeGreaterThan(0);
  });

  it('map each page to its article, longest prefix first', () => {
    expect(helpArticleForPath('/infraestrutura/equipamentos/d1')?.slug).toBe('device-360');
    expect(helpArticleForPath('/infraestrutura')?.slug).toBe('equipamentos');
    expect(helpArticleForPath('/alteracoes')?.slug).toBe('alteracoes');
    expect(helpArticleForPath('/qualidade-inventario')?.slug).toBe('qualidade');
    expect(helpArticleForPath('/auditoria')?.slug).toBe('auditoria');
    expect(helpArticleForPath('/ipamx')).toBeNull();
    expect(helpArticleForPath('/')).toBeNull();
    expect(helpArticleForPath(null)).toBeNull();
    expect(helpArticle('tabelas')?.title).toBe('Tabelas, filtros e vistas guardadas');
  });

  it('describe current audit and critical-asset behaviour (#113, #97)', () => {
    const audit = helpArticle('auditoria')!.body.join(' ');
    expect(audit).toMatch(/GET e HEAD/);
    expect(audit).toMatch(/exportações/);
    expect(audit).toMatch(/transferências de ficheiros/);
    const critical = helpArticle('ativos-criticos')!;
    const text = [critical.description, ...critical.body].join(' ');
    expect(text).not.toMatch(/semanal/i);
    expect(text).toMatch(/T1 a cada semana, T2 a cada 2 semanas e T3 a cada 4 semanas/);
    expect(text).toMatch(/Definições → Sites/);
  });

  it('map every Infraestrutura tab to an existing article (item 8)', () => {
    for (const tab of ['sites', 'racks', 'devices', 'hosts', 'lifecycle', 'models', 'interfaces', 'assets', 'permissions', null, 'unknown']) {
      expect(helpArticle(infrastructureHelpTopic(tab))).toBeDefined();
    }
    expect(infrastructureHelpTopic('hosts')).toBe('servidores');
    expect(infrastructureHelpTopic('permissions')).toBe('equipamentos');
    expect(infrastructureHelpTopic(null)).toBe('equipamentos');
  });
});
