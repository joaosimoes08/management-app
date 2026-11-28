import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { translateMessage, type AppLocale } from '@/lib/i18n/i18n';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import { messages as deDE } from '@/lib/i18n/messages/tags/de-DE';
import { messages as esES } from '@/lib/i18n/messages/tags/es-ES';
import { messages as frFR } from '@/lib/i18n/messages/tags/fr-FR';
import { messages as itIT } from '@/lib/i18n/messages/tags/it-IT';
import { messages as ptPT } from '@/lib/i18n/messages/tags/pt-PT';
import type { Tag } from './types';

// The tags screens were the first domain moved from hard-coded Portuguese (translated on the page
// from source-text-messages.ts) to keyed messages. Each key must render exactly what the old
// Portuguese source showed, and en-US exactly what the source-text table made of it.
const keyed: Array<[key: string, portuguese: string, params?: Record<string, string | number>]> = [
  ['tags.label', 'Etiquetas'],
  ['tags.manage', 'Gerir etiquetas'],
  ['tags.saveError', 'Não foi possível guardar as etiquetas.'],
  ['tags.loading', 'A carregar etiquetas…'],
  ['tags.color.gray', 'Cinzento'],
  ['tags.color.blue', 'Azul'],
  ['tags.color.green', 'Verde'],
  ['tags.color.amber', 'Âmbar'],
  ['tags.color.red', 'Vermelho'],
  ['tags.color.purple', 'Roxo'],
  ['tags.filter.label', 'Filtrar por etiqueta'],
  ['tags.filter.all', 'Todas as etiquetas'],
  ['tags.filter.removed', 'Etiqueta removida'],
  ['tags.new.nameLabel', 'Nome da nova etiqueta'],
  ['tags.new.placeholder', 'Nova etiqueta'],
  ['tags.new.colorLabel', 'Cor da nova etiqueta'],
  ['tags.new.create', 'Criar'],
  ['tags.empty.canCreate', 'Este site ainda não tem etiquetas. Cria a primeira abaixo.'],
  ['tags.empty.readOnly', 'Este site ainda não tem etiquetas. Um administrador pode criá-las.'],
  ['tags.editor.title', 'Etiquetas · sw-core-01', { name: 'sw-core-01' }],
  ['tags.editor.options', 'Etiquetas do site'],
  ['tags.editor.cancel', 'Cancelar'],
  ['tags.editor.save', 'Guardar etiquetas'],
  ['tags.manager.nameLabel', 'Nome da etiqueta'],
  ['tags.manager.colorLabel', 'Cor da etiqueta'],
  ['tags.manager.usesTitle', 'Equipamentos · Sub-redes'],
  ['tags.manager.save', 'Guardar'],
  ['tags.manager.confirmDeleteUsed', 'Eliminar a etiqueta "core"? Sai de 3 itens.', { name: 'core', count: 3 }],
  ['tags.manager.confirmDelete', 'Eliminar a etiqueta "core"?', { name: 'core' }],
  ['tags.manager.description', 'As etiquetas pertencem a este site e servem equipamentos e sub-redes. Contagem: equipamentos · sub-redes.'],
  ['tags.manager.readOnlyNote', 'Só administradores e operadores de sistemas podem criar, renomear ou eliminar etiquetas.'],
  ['tags.manager.close', 'Fechar'],
];

describe('tags keyed messages', () => {
  it.each(keyed)('%s renders the same Portuguese and English as before', (key, portuguese, params) => {
    expect(translateMessage('pt-PT', key, undefined, params)).toBe(portuguese);
    const english = translateMessage('en-US', key, undefined, params);
    expect(english).toBe(translateSourceText('en-US', portuguese));
  });

  it('covers every key the tags components use, in both locales and the added languages', () => {
    const source = readFileSync(join(__dirname, 'tag-components.tsx'), 'utf8');
    const used = new Set([...source.matchAll(/'(tags\.[\w.]+)'/g)].map((match) => match[1]));
    used.delete('tags.deleteNamed'); // keyed before this change
    expect([...used].sort()).toEqual(keyed.map(([key]) => key).sort());
    // A plural key exists as its .one and .other forms.
    const forms = (key: string) => (key in ptPT ? [key] : [`${key}.one`, `${key}.other`]);
    for (const key of keyed.flatMap(([key]) => forms(key))) {
      for (const locale of ['pt-PT', 'en-US'] as AppLocale[]) expect(translateMessage(locale, key, '∅')).not.toBe('∅');
      for (const bundle of [esES, frFR, deDE, itIT]) expect(bundle[key], key).toBeTruthy();
    }
  });

  // The one intended output change: the old single template read "Sai de 1 itens." for one item.
  it('words the delete confirmation for one item in the singular, in every language', () => {
    const one = { name: 'core', count: 1 };
    expect(translateMessage('pt-PT', 'tags.manager.confirmDeleteUsed', undefined, one)).toBe('Eliminar a etiqueta "core"? Sai de 1 item.');
    expect(translateMessage('en-US', 'tags.manager.confirmDeleteUsed', undefined, one)).toBe('Delete the tag "core"? It is removed from 1 item.');
    expect(translateMessage('pt-PT', 'tags.manager.confirmDeleteUsed', undefined, { name: 'core', count: 2 })).toBe('Eliminar a etiqueta "core"? Sai de 2 itens.');
    // Each added language: the .one form is the .other form with the noun in the singular.
    const nouns: Array<[Record<string, string>, plural: string, singular: string]> = [[esES, 'elementos', 'elemento'], [frFR, 'éléments', 'élément'], [deDE, 'Elementen', 'Element'], [itIT, 'elementi', 'elemento']];
    for (const [bundle, plural, singular] of nouns) {
      const other = bundle['tags.manager.confirmDeleteUsed.other'];
      expect(other).toContain(`{count} ${plural}`);
      expect(bundle['tags.manager.confirmDeleteUsed.one']).toBe(other.replace(`{count} ${plural}`, `{count} ${singular}`));
    }
  });

  it('leaves no Portuguese literal in the tags components', () => {
    const source = readFileSync(join(__dirname, 'tag-components.tsx'), 'utf8').replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(source).not.toMatch(/[áàãâéêíóôõúçÁÀÃÂÉÊÍÓÔÕÚÇ]/);
  });
});

const locale = vi.hoisted(() => ({ current: 'en-US' as 'pt-PT' | 'en-US' }));
vi.mock('@/lib/i18n/i18n', async (original) => {
  const actual = await original<typeof import('@/lib/i18n/i18n')>();
  return {
    ...actual,
    useOptionalI18n: () => ({ t: (key: string, fallback?: string, params?: Record<string, string | number>) => actual.translateMessage(locale.current, key, fallback, params) }),
  };
});
const api = vi.hoisted(() => ({ listTags: vi.fn(), createTag: vi.fn(), updateTag: vi.fn(), deleteTag: vi.fn() }));
vi.mock('./api', () => ({ ...api, tagsQueryKey: (siteId: string | null | undefined) => ['tags', siteId ?? null] }));

const { ManageTagsButton, TagManager } = await import('./tag-components');
const core: Tag = { id: 't-core', siteId: 's1', name: 'core', color: 'blue', deviceCount: 2, subnetCount: 1 };

function withQuery(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client }, element);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); locale.current = 'en-US'; });

describe('tags screens follow the active language', () => {
  it('renders the tag manager in English', async () => {
    api.listTags.mockResolvedValue([core]);
    render(withQuery(<TagManager siteId="s1" close={vi.fn()} canManage />));
    expect(await screen.findByLabelText('Tag name')).toHaveProperty('value', 'core');
    expect(screen.getByRole('heading', { name: 'Manage tags' })).toBeTruthy();
    expect(screen.getByText('Tags belong to this site and apply to devices and subnets. Count: devices · subnets.')).toBeTruthy();
    expect(screen.getByText('Close', { selector: '.modal-actions button' })).toBeTruthy();
    expect(screen.getByPlaceholderText('New tag')).toBeTruthy();
    expect(screen.getAllByRole('option', { name: 'Purple' }).length).toBeGreaterThan(0);
  });

  it('renders the same screen in Portuguese', async () => {
    locale.current = 'pt-PT';
    api.listTags.mockResolvedValue([core]);
    render(withQuery(<TagManager siteId="s1" close={vi.fn()} />));
    expect(await screen.findByText('core')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Gerir etiquetas' })).toBeTruthy();
    expect(screen.getByText('Só administradores e operadores de sistemas podem criar, renomear ou eliminar etiquetas.')).toBeTruthy();
    render(<ManageTagsButton onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Gerir etiquetas' })).toBeTruthy();
  });
});
