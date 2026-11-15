import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RecentItems, rememberRecentItem } from './recent-items';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('RecentItems', () => {
  it('renders the recently opened items for the signed-in user', async () => {
    rememberRecentItem('user-1', {
      id: 'device-1',
      kind: 'Equipamento',
      label: 'Core switch',
      href: '/infraestrutura?deviceId=device-1',
    });

    render(<RecentItems userId="user-1" />);

    expect(await screen.findByRole('heading', { name: 'Vistos recentemente' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'EquipamentoCore switch' })).toHaveAttribute('href', '/infraestrutura?deviceId=device-1');
  });
});
