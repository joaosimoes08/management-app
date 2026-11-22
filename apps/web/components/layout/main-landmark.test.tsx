import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModulePage } from '@/components/module-page';
import HelpTopic from '@/app/ajuda/[topic]/page';

vi.mock('next/navigation', () => ({ usePathname: () => '/ajuda/primeiros-passos', useParams: () => ({ topic: 'primeiros-passos' }) }));
vi.mock('./app-header', () => ({ AppHeader: () => <header /> }));
vi.mock('./app-sidebar', () => ({ AppSidebar: () => <aside><nav aria-label="Navegação principal" /></aside> }));
vi.mock('./global-search', () => ({ GlobalSearchPalette: () => null }));
vi.mock('./user-menu', () => ({ UserMenu: () => null }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'pt-PT', t: (key: string) => key }) }));

afterEach(() => cleanup());

describe('one <main> landmark per page', () => {
  it('a ModulePage inside the real AppShell renders exactly one main', () => {
    render(<ModulePage kind="settings" title="Definições" eyebrow="SISTEMA" description="Configuração"><p>Corpo</p></ModulePage>);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.querySelectorAll('main')).toHaveLength(1);
  });

  it('a help article page inside the real AppShell renders exactly one main', () => {
    render(<HelpTopic />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.querySelectorAll('main, [role="main"]')).toHaveLength(1);
  });

  it('no component that renders AppShell adds its own <main> or role="main"', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!name.endsWith('.tsx') || name.endsWith('.test.tsx') || full.endsWith(path.join('layout', 'app-shell.tsx'))) continue;
        const source = readFileSync(full, 'utf8');
        if (source.includes('<AppShell') && /<main[\s>]|role=["']main["']/.test(source)) offenders.push(path.relative(root, full));
      }
    };
    for (const dir of ['app', 'components', 'features']) walk(path.join(root, dir));
    expect(offenders).toEqual([]);
  });
});
