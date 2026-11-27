import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { RecentItems, parseRecentItems, rememberRecentItem } from './recent-items';

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

describe('stored recent items', () => {
  const key = 'management-app:recent-items:user-1';
  const valid = { id: 'device:1', kind: 'Equipamento', label: 'Core', href: '/infraestrutura/equipamentos/1', visitedAt: 5 };

  it('reads valid entries unchanged', () => {
    expect(parseRecentItems(JSON.stringify([valid]))).toEqual([valid]);
  });

  it('reads corrupt JSON, the wrong shape and a missing key as an empty list', () => {
    expect(parseRecentItems('{not json')).toEqual([]);
    expect(parseRecentItems(JSON.stringify({ items: [valid] }))).toEqual([]);
    expect(parseRecentItems(null)).toEqual([]);
  });

  it('drops malformed entries and links that leave the app, keeping the rest', () => {
    const stored = [valid, { id: 1, kind: 'Host', label: 'x', href: '/ipam' }, { ...valid, id: 'evil', href: 'javascript:alert(1)' }, { ...valid, id: 'old', visitedAt: undefined }];
    expect(parseRecentItems(JSON.stringify(stored))).toEqual([valid, { ...valid, id: 'old', visitedAt: 0 }]);
  });

  it('renders only the valid entries from tampered storage', async () => {
    window.localStorage.setItem(key, JSON.stringify([valid, { ...valid, id: 'evil', label: 'Evil', href: 'javascript:alert(1)' }, null]));
    render(<RecentItems userId="user-1" />);
    expect(await screen.findByRole('link', { name: 'EquipamentoCore' })).toHaveAttribute('href', valid.href);
    expect(screen.queryByText('Evil')).not.toBeInTheDocument();
  });

  it('still records a visit when the stored list is corrupt or has the wrong shape', () => {
    for (const stored of ['{not json', JSON.stringify({ not: 'a list' })]) {
      window.localStorage.setItem(key, stored);
      rememberRecentItem('user-1', { id: 'host:1', kind: 'Host', label: 'h1', href: '/ipam?hostId=1' });
      expect(parseRecentItems(window.localStorage.getItem(key)).map((item) => item.id)).toEqual(['host:1']);
    }
  });
});
