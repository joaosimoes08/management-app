import { cleanup, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportUnsubscribeScreen } from './report-unsubscribe-screen';
import ReportUnsubscribeRoute from '@/app/(public)/relatorios/cancelar-subscricao/page';

const auth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock('@/lib/auth', () => auth);
vi.mock('@/lib/runtime-config', () => ({ getPublicOrganizationName: () => 'Org', getPublicRuntimeConfig: () => ({ apiUrl: '', keycloakRealm: 'r' }) }));
vi.mock('./report-unsubscribe', () => ({ ReportUnsubscribe: ({ token }: { token: string | null }) => <p>unsubscribe:{token}</p> }));

afterEach(() => cleanup());

describe('public unsubscribe page', () => {
  it('shows the unsubscribe screen in the signed-out card without asking for a session', () => {
    render(<ReportUnsubscribeScreen token="tok123" />);
    expect(screen.getByText('unsubscribe:tok123')).toBeInTheDocument();
    expect(screen.getByText('ORG')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Keycloak/ })).toBeNull();
    expect(auth.useAuth).not.toHaveBeenCalled();
  });

  it('shows the connecting spinner before hydration instead of an empty page', () => {
    const html = renderToString(<ReportUnsubscribeScreen token="tok123" />);
    expect(html).toContain('auth-spinner');
    expect(html).not.toContain('unsubscribe:tok123');
  });

  it('passes the token from the link to the screen, and nothing for a missing or repeated token', async () => {
    render(await ReportUnsubscribeRoute({ searchParams: Promise.resolve({ token: 'tok123' }) }));
    expect(screen.getByText('unsubscribe:tok123')).toBeInTheDocument();
    cleanup();
    render(await ReportUnsubscribeRoute({ searchParams: Promise.resolve({ token: ['a', 'b'] }) }));
    expect(screen.getByText('unsubscribe:')).toBeInTheDocument();
  });
});
