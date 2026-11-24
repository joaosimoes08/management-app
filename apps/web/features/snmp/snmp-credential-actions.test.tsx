import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { ApiRequestError, apiErrorMessage, localizedApiErrors } from '@/lib/api/errors';
import SnmpPage from './snmp-page';
import { snmpCredentialBusy, snmpCredentialDeleteMessage, snmpCredentialUsage } from './snmp-credential-usage';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => role === 'ADMIN' }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1', activeSite: { id: 'site-1', name: 'Lisboa' }, loading: false }) }));
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children, moduleTabs, actions }: { children: ReactNode; moduleTabs?: ReactNode; actions?: ReactNode }) => <>{moduleTabs}{actions}{children}</> }));
const mockedFetch = vi.mocked(apiFetch);
const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

const device = { id: 'd1', name: 'core-sw-01', type: 'SWITCH', managementIp: '10.1.1.1' };
const receiver = { listenAll: true, selectedInterfaceIds: [], interfaces: [], engineId: '800000090300AABBCCDDEEFF', engineIdSource: 'STORED', trapPort: 162, v2cAllowed: false, refreshSeconds: 30 };
const read = { id: 'c1', purpose: 'READ', version: 'V3', username: 'netops', authProtocol: 'SHA256', privProtocol: 'AES192', configured: true };
const trap = { id: 'c2', purpose: 'TRAP', version: 'V3', username: 'traps', authProtocol: 'SHA256', privProtocol: 'AES128', configured: true };
const config = { id: 'cfg', enabled: true, port: 161, intervalMinutes: 15, timeoutMs: 5000, retries: 2, compatibilitySha1: false };
const overview = (patch: Record<string, unknown> = {}) => ({ config: null, credentials: [read, trap], latestSnapshot: null, jobs: [], drifts: [], traps: [], lastTrapReceivedAt: null, setEnabled: false, ...patch });

function api(body: Record<string, unknown>) {
  mockedFetch.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/devices')) return { items: [device], total: 1, page: 1, totalPages: 1 };
    if (url === '/api/v1/settings/snmp-listeners') return receiver;
    if (url === '/api/v1/snmp/devices/d1') return body;
    if (url.startsWith('/api/v1/snmp/devices/d1/metrics')) return { days: 7, expectedIntervalMinutes: null, selectedInterfaceIndex: null, interfaces: [], availability: [], interfacesHistory: [] };
    return { success: true };
  });
}
const deleteCalls = () => mockedFetch.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE');

beforeEach(() => { mockedFetch.mockReset(); window.history.replaceState(null, '', '/snmp?deviceId=d1'); });
afterEach(cleanup);

describe('SNMP credentials: delete', () => {
  it('asks first, warns when the credential is in use, and deletes only that device and purpose', async () => {
    api(overview({ config }));
    wrap(<SnmpPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar credencial READ' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Eliminar a credencial READ · V3 (netops) de core-sw-01?');
    expect(dialog).toHaveTextContent('Só esta credencial é removida');
    expect(dialog).toHaveTextContent('A recolha SNMP deste equipamento está ativa');
    expect(deleteCalls()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar mesmo assim' }));
    await waitFor(() => expect(deleteCalls()).toEqual([['/api/v1/snmp/devices/d1/credentials/READ?force=true', { method: 'DELETE' }]]));
    expect(await screen.findByText('Credencial READ eliminada.')).toBeInTheDocument();
  });

  it('sends a plain delete (no force) when the credential is not in use', async () => {
    api(overview());
    wrap(<SnmpPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar credencial TRAP' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(deleteCalls()).toEqual([['/api/v1/snmp/devices/d1/credentials/TRAP', { method: 'DELETE' }]]));
    expect(await screen.findByText('Credencial TRAP eliminada.')).toBeInTheDocument();
  });

  it('explains a 409 SNMP_CREDENTIAL_IN_USE on a plain delete and reloads the overview', async () => {
    api(overview());
    const fallback = mockedFetch.getMockImplementation()!;
    const payload = { code: 'SNMP_CREDENTIAL_IN_USE', message: 'in use', details: { usages: [{ type: 'POLL_SCHEDULE', deviceId: 'd1', deviceName: 'core-sw-01' }] } };
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') throw new ApiRequestError(apiErrorMessage(payload, 'pt-PT'), 409, payload);
      return fallback(url, init);
    });
    wrap(<SnmpPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar credencial READ' }));
    const overviewCalls = () => mockedFetch.mock.calls.filter(([url]) => url === '/api/v1/snmp/devices/d1').length;
    const before = overviewCalls();
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(localizedApiErrors['pt-PT'].SNMP_CREDENTIAL_IN_USE);
    expect(deleteCalls()).toEqual([['/api/v1/snmp/devices/d1/credentials/READ', { method: 'DELETE' }]]);
    await waitFor(() => expect(overviewCalls()).toBeGreaterThan(before));
    expect(screen.queryByText('Credencial READ eliminada.')).not.toBeInTheDocument();
  });

  it('explains a 409 SNMP_CREDENTIAL_BUSY (job running) even on the forced path', async () => {
    api(overview({ config }));
    const fallback = mockedFetch.getMockImplementation()!;
    const payload = { code: 'SNMP_CREDENTIAL_BUSY', message: 'busy', details: { jobs: [{ id: 'j1', type: 'POLL', status: 'RUNNING', createdAt: '2026-11-24T10:00:00.000Z' }] } };
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') throw new ApiRequestError(apiErrorMessage(payload, 'pt-PT'), 409, payload);
      return fallback(url, init);
    });
    wrap(<SnmpPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar credencial READ' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Eliminar mesmo assim' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(localizedApiErrors['pt-PT'].SNMP_CREDENTIAL_BUSY);
    expect(deleteCalls()).toEqual([['/api/v1/snmp/devices/d1/credentials/READ?force=true', { method: 'DELETE' }]]);
  });

  it('does nothing when the confirmation is cancelled', async () => {
    api(overview());
    wrap(<SnmpPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar credencial TRAP' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByText(/está em uso/)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(deleteCalls()).toHaveLength(0);
  });

  it('refuses to delete while an SNMP job is running', async () => {
    api(overview({ jobs: [{ id: 'j1', type: 'POLL', status: 'RUNNING', createdAt: '2026-11-24T10:00:00.000Z' }] }));
    wrap(<SnmpPage />);
    expect(await screen.findByRole('button', { name: 'Eliminar credencial READ' })).toBeDisabled();
    expect(screen.getByText('Há uma tarefa SNMP em curso; só podes eliminar credenciais quando terminar.')).toBeInTheDocument();
  });
});

describe('SNMP credentials: rotate', () => {
  it('prefills the form with the same purpose, version and identity, keeps secrets empty and locks the purpose', async () => {
    api(overview());
    wrap(<SnmpPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Rodar credencial READ' }));
    expect(await screen.findByText(/Rodar a credencial READ: introduz os novos segredos/)).toBeInTheDocument();
    const form = document.getElementById('snmp-credential-form') as HTMLFormElement;
    expect(within(form).getByRole('combobox')).toHaveValue('READ');
    expect(within(form).getByRole('combobox')).toBeDisabled();
    expect(within(form).getByDisplayValue('netops')).toBeInTheDocument();
    for (const input of form.querySelectorAll('input[type="password"]')) expect(input).toHaveValue('');
    fireEvent.click(within(form).getByRole('button', { name: 'Cancelar rotação' }));
    expect(within(form).getByRole('combobox')).toBeEnabled();
    expect(within(form).queryByDisplayValue('netops')).not.toBeInTheDocument();
  });
});

describe('snmpCredentialUsage', () => {
  it('flags READ while polling is on, TRAP once traps arrived and WRITE while SET is enabled', () => {
    expect(snmpCredentialUsage('READ', overview({ config }) as never)).toHaveLength(1);
    expect(snmpCredentialUsage('READ', overview({ config: { ...config, enabled: false } }) as never)).toEqual([]);
    expect(snmpCredentialUsage('TRAP', overview({ lastTrapReceivedAt: '2026-11-24T10:00:00.000Z' }) as never)).toHaveLength(1);
    expect(snmpCredentialUsage('TRAP', overview() as never)).toEqual([]);
    expect(snmpCredentialUsage('WRITE', overview({ setEnabled: true }) as never)).toHaveLength(1);
    expect(snmpCredentialUsage('READ', undefined)).toEqual([]);
    expect(snmpCredentialBusy(overview({ jobs: [{ status: 'PENDING' }] }) as never)).toBe(true);
    expect(snmpCredentialBusy(overview({ jobs: [{ status: 'SUCCEEDED' }] }) as never)).toBe(false);
  });

  it('names exactly one credential in the confirmation text', () => {
    expect(snmpCredentialDeleteMessage({ purpose: 'TRAP', version: 'V3', username: null, label: null }, undefined, [])).toBe('Eliminar a credencial TRAP · V3 deste equipamento?\nSó esta credencial é removida; as outras credenciais e a configuração SNMP ficam como estão. Não é possível desfazer.');
  });
});

describe('SNMP credential delete conflicts (#176)', () => {
  it('has a clear pt-PT and en-US message for both 409 codes', () => {
    expect(apiErrorMessage({ code: 'SNMP_CREDENTIAL_IN_USE', message: 'x' }, 'pt-PT')).toMatch(/^A credencial não foi eliminada: está em uso/);
    expect(apiErrorMessage({ code: 'SNMP_CREDENTIAL_IN_USE', message: 'x' }, 'en-US')).toMatch(/^The credential was not deleted: it is in use/);
    expect(apiErrorMessage({ code: 'SNMP_CREDENTIAL_BUSY', message: 'x' }, 'pt-PT')).toMatch(/tarefa SNMP em curso/);
    expect(apiErrorMessage({ code: 'SNMP_CREDENTIAL_BUSY', message: 'x' }, 'en-US')).toMatch(/SNMP job that uses it is still running/);
  });
});
