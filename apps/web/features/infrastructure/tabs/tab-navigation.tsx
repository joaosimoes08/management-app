'use client';

import { Boxes, CalendarDays, HardDrive, KeyRound, Layers, MapPinned, Server } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useUiText } from '@/components/ui/use-ui-text';
import hostStyles from '../components/linux-hosts.module.css';

/** Tabs the user's effective access opens beyond the four every user sees. */
type TabAccess = { models?: boolean; interfaces?: boolean; assets?: boolean; permissions?: boolean } | undefined;

/**
 * The Infrastructure tab bar shown in the shell. Returns the `<nav>` element itself (not a component wrapping it):
 * AppHeader only adds the responsive overflow menu ("More") when `moduleTabs` is a plain `<nav>` element.
 */
export function useInfrastructureTabNavigation({ tab, tabs, onSelect }: { tab: string; tabs: TabAccess; onSelect: (key: string) => void }) {
  const ui = useUiText();
  const visibleTabs: [string, string, LucideIcon][] = [['sites', ui('infra.tab.sites'), MapPinned], ['racks', ui('infra.tab.racks'), MapPinned], ['devices', ui('infra.tab.devices'), Server], ['lifecycle', ui('infra.tab.lifecycle'), CalendarDays], ...(tabs?.models ? [['models', ui('infra.tab.models'), Boxes] as [string, string, LucideIcon]] : []), ...(tabs?.interfaces ? [['interfaces', ui('infra.tab.interfaces'), Layers] as [string, string, LucideIcon]] : []), ...(tabs?.assets ? [['assets', ui('infra.tab.assets'), HardDrive] as [string, string, LucideIcon]] : []), ...(tabs?.permissions ? [['permissions', ui('infra.tab.permissions'), KeyRound] as [string, string, LucideIcon]] : [])];
  return <nav className={`infra-menu infrastructure-tabs ${hostStyles.tabNavigation}`} aria-label="Infraestrutura">{visibleTabs.map(([key, label, Icon]) => <button key={key} className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => onSelect(key)}><Icon size={15} /><span>{label}</span></button>)}</nav>;
}
