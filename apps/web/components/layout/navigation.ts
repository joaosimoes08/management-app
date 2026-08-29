import { Boxes, ExternalLink, LayoutDashboard, Network, Search, Settings, Table2, CircleHelp } from 'lucide-react';

export interface NavigationItem {
  label: string;
  key: string;
  href: string;
  icon: typeof LayoutDashboard;
  ipam?: boolean;
  audit?: boolean;
  discovery?: boolean;
}

/** Primary sidebar navigation, filtered per role at render time. */
export const navigation: NavigationItem[] = [
  { label: 'Dashboard', key: 'nav.dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Infraestrutura', key: 'nav.infrastructure', href: '/infraestrutura', icon: Boxes },
  { label: 'Portal interno', key: 'nav.portal', href: '/portal', icon: ExternalLink },
  { label: 'IPAM', key: 'nav.ipam', href: '/ipam', icon: Network, ipam: true },
  { label: 'Descoberta', key: 'nav.discovery', href: '/descoberta', icon: Search, discovery: true },
  { label: 'Auditoria', key: 'nav.audit', href: '/auditoria', icon: Table2, audit: true },
];

export const settingsNavigation = { label: 'Definições', key: 'nav.settings', href: '/definicoes', icon: Settings };
export const helpNavigation = { label: 'Ajuda', key: 'nav.help', href: '/ajuda', icon: CircleHelp };
