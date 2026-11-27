import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HelpTopic from '@/app/(authenticated)/ajuda/[topic]/page';
import { AppShellFrame } from './app-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/ajuda/primeiros-passos', useParams: () => ({ topic: 'primeiros-passos' }) }));
vi.mock('./app-header', () => ({ AppHeader: () => <header /> }));
vi.mock('./app-sidebar', () => ({ AppSidebar: () => <aside><nav aria-label="Navegação principal" /></aside> }));
vi.mock('./global-search', () => ({ GlobalSearchPalette: () => null }));
vi.mock('./user-menu', () => ({ UserMenu: () => null }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'pt-PT', t: (key: string) => key }) }));

afterEach(() => cleanup());

describe('one <main> landmark per page', () => {
  it('a help article page inside the real AppShellFrame renders exactly one main', () => {
    render(<AppShellFrame><HelpTopic /></AppShellFrame>);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.querySelectorAll('main, [role="main"]')).toHaveLength(1);
  });

  it('no component that renders PageShell adds its own <main> or role="main"', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!name.endsWith('.tsx') || name.endsWith('.test.tsx') || full.endsWith(path.join('layout', 'app-shell.tsx'))) continue;
        const source = readFileSync(full, 'utf8');
        if ((source.includes('<PageShell') || source.includes('<AppShellFrame')) && /<main[\s>]|role=["']main["']/.test(source)) offenders.push(path.relative(root, full));
      }
    };
    for (const dir of ['app', 'components', 'features']) walk(path.join(root, dir));
    expect(offenders).toEqual([]);
  });

  it('error boundaries and layouts inside the shell add no <main> of their own', () => {
    const root = path.resolve(import.meta.dirname, '../..');
    const files = [path.join(root, 'components', 'layout', 'route-status.tsx')];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const full = path.join(dir, name); if (statSync(full).isDirectory()) walk(full); else if (/^(loading|error|layout)\.tsx$/.test(name)) files.push(full); } };
    walk(path.join(root, 'app', '(authenticated)'));
    expect(files.length).toBeGreaterThan(2);
    expect(files.filter((file) => /<main[\s>]|role=["']main["']/.test(readFileSync(file, 'utf8'))).map((file) => path.relative(root, file))).toEqual([]);
  });
});
