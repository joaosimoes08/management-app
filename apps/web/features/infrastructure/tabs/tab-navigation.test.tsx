import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppHeader } from '@/components/layout/app-header';
import { useInfrastructureTabNavigation } from './tab-navigation';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), load: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/features/operations/api', () => ({ readAllOperationalAlerts: vi.fn() }));
vi.mock('@/features/operations/use-operational-events', () => ({ useOperationalEvents: mocks.load }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => false }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/layout/site-switcher', () => ({ SiteSwitcher: () => <span>Site</span> }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function Header({ onSelect }: { onSelect: (key: string) => void }) {
  const tabs = useInfrastructureTabNavigation({ tab: 'models', tabs: { models: true, interfaces: true, assets: true, permissions: true }, onSelect });
  return <AppHeader moduleTabs={tabs} onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />;
}

describe('useInfrastructureTabNavigation', () => {
  it('gives the shell a plain <nav>, so the header keeps its responsive overflow menu for the tabs', () => {
    mocks.apiFetch.mockReturnValue(new Promise(() => {}));
    const onSelect = vi.fn();
    const { container } = render(<Header onSelect={onSelect} />);
    // AppHeader only wraps `moduleTabs` in ResponsiveTabNavigation when it is a <nav> element.
    expect(container.querySelector('.module-tabs-slot .responsive-tab-navigation')).not.toBeNull();
    const nav = screen.getAllByRole('navigation', { name: 'Infraestrutura' })[0];
    const buttons = nav.querySelectorAll('button');
    expect(buttons).toHaveLength(8);
    expect(nav.querySelector('[aria-current="page"]')?.textContent).toBe('Modelos');
    fireEvent.click(buttons[5]);
    expect(onSelect).toHaveBeenCalledWith('interfaces');
  });
});
