import { describe, expect, it } from 'vitest';
import { helpArticle, helpArticleForPath, helpArticles } from './articles';

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
});
