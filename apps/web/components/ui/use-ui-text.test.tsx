import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/i18n';
import { Modal } from './modal';
import { ConfirmDialog } from './confirm-dialog';
import { useUiText } from './use-ui-text';

const mocks = vi.hoisted(() => ({ auth: { setupStatus: null as unknown } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/runtime-config', async (original) => ({ ...await original<typeof import('@/lib/runtime-config')>(), getConfiguredLocale: () => 'pt-PT' }));

afterEach(() => { cleanup(); window.localStorage.clear(); mocks.auth = { setupStatus: null }; });

function Paging() {
  const ui = useUiText();
  return <span>{ui('ui.pageOf', undefined, { page: 2, total: 5 })}</span>;
}

describe('useUiText shared labels', () => {
  it('uses the Portuguese copy outside the i18n provider', () => {
    render(<><Paging /><Modal title="Teste" close={() => undefined}><p>corpo</p></Modal></>);
    expect(screen.getByText('Página 2 de 5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('follows the active language inside the provider', () => {
    window.localStorage.setItem('civernode.locale', 'en-US');
    render(<I18nProvider><Paging /><ConfirmDialog message="Remover?" destructive onResolve={() => undefined} /></I18nProvider>);
    expect(screen.getByText('Page 2 of 5')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Confirm deletion' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
