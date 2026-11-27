import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetList } from './assets/asset-list';
import { InfrastructurePermissions } from './infrastructure-permissions';

vi.mock('../api', () => ({
  listInfrastructureGroups: vi.fn().mockResolvedValue([]),
  listInfrastructurePermissions: vi.fn().mockResolvedValue([]),
  createInfrastructurePermission: vi.fn(),
  deleteInfrastructurePermission: vi.fn(),
}));
vi.mock('./asset-image', () => ({ AssetImage: () => null }));
vi.mock('@/features/runbooks/bookstack-context-link', () => ({ BookStackContextLink: () => null }));

function renderWithQueryClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('Infrastructure tab headings', () => {
  afterEach(cleanup);

  it('uses the shared tab heading treatment for the Assets description', () => {
    render(<AssetList assets={[]} onDelete={() => {}} canEdit={false} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Imagens de frente dos equipamentos usadas no mapeamento de portas.' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Assets visuais' })).not.toBeInTheDocument();
  });

  it('omits the redundant Permissions panel description', async () => {
    renderWithQueryClient(<InfrastructurePermissions siteId="site-1" buildings={[]} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Permissões dos grupos' })).toBeInTheDocument();
    expect(screen.queryByText(/Seleciona o grupo e o âmbito/)).not.toBeInTheDocument();
  });
});
