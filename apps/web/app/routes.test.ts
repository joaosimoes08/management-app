import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const appDir = import.meta.dirname;

/** Every URL the app directory serves: page.tsx folders, with route groups `(name)` removed from the path. */
function listRoutes(dir = appDir, segments: string[] = []): string[] {
  const routes: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith('_') || name.startsWith('@')) continue;
      const isGroup = name.startsWith('(') && name.endsWith(')');
      routes.push(...listRoutes(full, isGroup ? segments : [...segments, name]));
    } else if (/^page\.(tsx|ts|jsx|js)$/.test(name)) {
      routes.push(`/${segments.join('/')}`);
    }
  }
  return routes;
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

// The URLs main served at 57206d9, before the (authenticated)/(public) route groups. Moving a page between
// groups must never change this list; a new page has to be added here on purpose.
const ROUTES_BEFORE_ROUTE_GROUPS = [
  '/',
  '/ajuda',
  '/ajuda/[topic]',
  '/alertas',
  '/alteracoes',
  '/attestacao-ativos',
  '/auditoria',
  '/definicoes',
  '/descoberta',
  '/infraestrutura',
  '/infraestrutura/equipamentos/[deviceId]',
  '/ipam',
  '/ipam/new-subnet',
  '/netapp',
  '/perfil',
  '/portal',
  '/qualidade-inventario',
  '/relatorios/cancelar-subscricao',
  '/setup',
  '/snmp',
  '/topology',
];

describe('app routes', () => {
  it('serves exactly the same URLs as before the route groups', () => {
    expect([...listRoutes()].sort()).toEqual([...ROUTES_BEFORE_ROUTE_GROUPS].sort());
  });

  it('never resolves two page files to the same URL', () => {
    const routes = listRoutes();
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('keeps setup and the email unsubscribe link in (public), and every other page in (authenticated)', () => {
    const groupOf = (file: string) => path.relative(appDir, file).split(path.sep)[0];
    const pages = filesUnder(appDir).filter((file) => /[/\\]page\.tsx$/.test(file));
    const publicPages = pages.filter((file) => groupOf(file) === '(public)').map((file) => path.relative(appDir, file));
    expect(publicPages.sort()).toEqual([path.join('(public)', 'relatorios', 'cancelar-subscricao', 'page.tsx'), path.join('(public)', 'setup', 'page.tsx')]);
    expect(pages.filter((file) => !['(public)', '(authenticated)'].includes(groupOf(file)))).toEqual([]);
  });

  it('renders the sign-in gate and the app shell from the (authenticated) layout, not from each page', () => {
    const layout = readFileSync(path.join(appDir, '(authenticated)', 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/<AuthGate><AppShellFrame>\{children\}<\/AppShellFrame><\/AuthGate>/);
    expect(readFileSync(path.join(appDir, 'layout.tsx'), 'utf8')).not.toContain('<AuthGate');
    // The unsubscribe link must work without a session: nothing on its path may render AuthGate.
    for (const file of filesUnder(path.join(appDir, '(public)', 'relatorios'))) expect(readFileSync(file, 'utf8')).not.toContain('<AuthGate');
    expect(readFileSync(path.join(appDir, '..', 'features', 'reports', 'report-unsubscribe-screen.tsx'), 'utf8')).not.toContain('<AuthGate');
  });

  it('has loading states for the heavy pages and an error boundary for the signed-in group', () => {
    for (const route of ['infraestrutura', 'ipam', 'topology']) expect(statSync(path.join(appDir, '(authenticated)', route, 'loading.tsx')).isFile()).toBe(true);
    expect(statSync(path.join(appDir, '(authenticated)', 'error.tsx')).isFile()).toBe(true);
  });
});
