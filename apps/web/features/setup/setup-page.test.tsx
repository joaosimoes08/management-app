import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SetupPage from './setup-page';

const mocks = vi.hoisted(() => ({
  isAdmin: true,
  getSetupStatus: vi.fn(),
  createSetupOrganization: vi.fn(),
  createSetupSite: vi.fn(),
  completeSetup: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => role === 'ADMIN' && mocks.isAdmin }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'pt-PT', setLocale: vi.fn(), t: (key: string) => key }) }));
vi.mock('@/lib/runtime-config', () => ({ getConfiguredLocale: () => 'pt-PT', resolveOrganizationLocale: () => 'pt-PT' }));
vi.mock('./api', () => ({
  getSetupStatus: mocks.getSetupStatus,
  createSetupOrganization: mocks.createSetupOrganization,
  createSetupSite: mocks.createSetupSite,
  completeSetup: mocks.completeSetup,
}));

function renderAt(search: string) {
  window.history.replaceState(null, '', `/setup${search}`);
  vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, search, replace: mocks.replace } as Location);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><SetupPage /></QueryClientProvider>);
}

beforeEach(() => {
  mocks.isAdmin = true;
  mocks.getSetupStatus.mockResolvedValue({ setupCompleted: true, organizationName: 'Org', organizationCode: 'ORG', hasSite: true, siteCount: 1 });
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.restoreAllMocks(); Object.values(mocks).forEach((value) => typeof value === 'function' && value.mockReset()); });

describe('SetupPage design preview', () => {
  it('lets an admin walk every step with ?preview=1 without redirecting or saving', async () => {
    renderAt('?preview=1');
    expect(await screen.findByText('setup.welcomeTitle')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('setup.previewBadge');

    fireEvent.click(screen.getByRole('button', { name: /setup.start/ }));
    fireEvent.click(await screen.findByRole('button', { name: /setup.continue/ }));
    fireEvent.change(await screen.findByPlaceholderText('setup.siteNameExample'), { target: { value: 'Lisboa' } });
    fireEvent.change(screen.getByPlaceholderText('setup.siteCodeExample'), { target: { value: 'LIS-01' } });
    fireEvent.click(screen.getByRole('button', { name: /setup.createSite/ }));
    fireEvent.click(await screen.findByRole('button', { name: /setup.enter/ }));

    expect(mocks.createSetupOrganization).not.toHaveBeenCalled();
    expect(mocks.createSetupSite).not.toHaveBeenCalled();
    expect(mocks.completeSetup).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });

  it('opens the requested step with &step=N', async () => {
    renderAt('?preview=1&step=2');
    expect(await screen.findByText('setup.siteTitle')).toBeInTheDocument();
  });

  it('is ignored in production: a completed setup still redirects', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    renderAt('?preview=1&step=2');
    expect(await screen.findByText('setup.welcomeTitle')).toBeInTheDocument();
    expect(screen.queryByText('setup.previewBadge')).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });

  it('is ignored for non-admins', async () => {
    mocks.isAdmin = false;
    renderAt('?preview=1');
    expect(await screen.findByText('setup.adminTitle')).toBeInTheDocument();
    expect(screen.queryByText('setup.previewBadge')).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith('/');
  });
});
