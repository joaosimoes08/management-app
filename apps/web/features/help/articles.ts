import { translateMessage } from '@/lib/i18n/i18n';

/**
 * Ajuda articles (Step 36): one list for the index, the article page and the
 * "?" link each page shows next to its title. The text is keyed in `lib/i18n/messages/help`.
 */
export type HelpArticle = { slug: string; title: string; description: string; body: string[] };
type HelpText = (key: string) => string;

/** Slug (also the URL and the message key) and paragraph count of each article, in index order. */
const articleSources: ReadonlyArray<{ slug: string; paragraphs: number }> = [
  { slug: 'primeiros-passos', paragraphs: 5 },
  { slug: 'ipam', paragraphs: 4 },
  { slug: 'descoberta', paragraphs: 5 },
  { slug: 'equipamentos', paragraphs: 4 },
  { slug: 'device-360', paragraphs: 4 },
  { slug: 'servidores', paragraphs: 4 },
  { slug: 'tabelas', paragraphs: 5 },
  { slug: 'pesquisa', paragraphs: 4 },
  { slug: 'auditoria', paragraphs: 5 },
  { slug: 'qualidade', paragraphs: 4 },
  { slug: 'alteracoes', paragraphs: 6 },
  { slug: 'ativos-criticos', paragraphs: 5 },
  { slug: 'alertas', paragraphs: 3 },
  { slug: 'snmp', paragraphs: 4 },
  { slug: 'operacao', paragraphs: 3 },
  { slug: 'troubleshooting', paragraphs: 4 },
];

/** The articles in the language of `t`: title `help.article.<slug>`, description and body from `messages/help`. */
export const localizedHelpArticles = (t: HelpText): HelpArticle[] => articleSources.map(({ slug, paragraphs }) => ({
  slug,
  title: t(`help.article.${slug}`),
  description: t(`help.articleSummary.${slug}`),
  body: Array.from({ length: paragraphs }, (_, index) => t(`help.articleBody.${slug}.${index + 1}`)),
}));

/** The articles in Portuguese, the source language: the path lookups and the index search use these. */
export const helpArticles: HelpArticle[] = localizedHelpArticles((key) => translateMessage('pt-PT', key));

export const helpArticle = (slug: string) => helpArticles.find((article) => article.slug === slug);

/** Page path prefix → article; the longest matching prefix wins. */
const pathTopics: Array<[string, string]> = [
  ['/infraestrutura/equipamentos/', 'device-360'],
  ['/infraestrutura', 'equipamentos'],
  ['/ipam', 'ipam'],
  ['/descoberta', 'descoberta'],
  ['/auditoria', 'auditoria'],
  ['/qualidade-inventario', 'qualidade'],
  ['/alteracoes', 'alteracoes'],
  ['/attestacao-ativos', 'ativos-criticos'],
  ['/alertas', 'alertas'],
  ['/snmp', 'snmp'],
];

/** Help article for each Infraestrutura tab (`?tab=`). Tabs without an article of their own use Equipamentos. */
const infrastructureTabTopics: Record<string, string> = { sites: 'equipamentos', racks: 'equipamentos', devices: 'equipamentos', hosts: 'servidores', lifecycle: 'equipamentos', models: 'equipamentos', interfaces: 'equipamentos', assets: 'equipamentos', permissions: 'equipamentos' };
export const infrastructureHelpTopic = (tab: string | null | undefined) => infrastructureTabTopics[tab ?? ''] ?? 'equipamentos';

/** The article for the page at `pathname`, or null when the page has none. */
export function helpArticleForPath(pathname: string | null | undefined): HelpArticle | null {
  if (!pathname) return null;
  const match = pathTopics.filter(([prefix]) => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)).sort((a, b) => b[0].length - a[0].length)[0];
  return match ? helpArticle(match[1]) ?? null : null;
}
