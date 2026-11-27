import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceNavigation } from './use-workspace-navigation';

const SITE = 'site-1';
const openAt = (search: string) => window.history.replaceState(null, '', `/infraestrutura${search}`);
const query = () => new URLSearchParams(window.location.search);

afterEach(() => {
  vi.restoreAllMocks();
  openAt('');
});

describe('useWorkspaceNavigation', () => {
  it('rewrites a legacy ?tab=hosts link to Equipamentos with the Servidores type, keeping the host filters', () => {
    openAt('?siteId=site-1&tab=hosts&hosts-state=down');
    const { result } = renderHook(() => useWorkspaceNavigation(SITE));
    expect(result.current.tab).toBe('devices');
    expect(result.current.deviceFilters.type).toBe('SERVER');
    expect(query().get('tab')).toBe('devices');
    expect(query().get('type')).toBe('SERVER');
    expect(query().get('hosts-state')).toBe('down');
  });

  it('opens Equipamentos filtered by ?missingConfig= and clears it back to the active Site', () => {
    openAt('?missingConfig=rearImage');
    const { result } = renderHook(() => useWorkspaceNavigation(SITE));
    expect(result.current.tab).toBe('devices');
    expect(result.current.missingConfig).toBe('rearImage');
    // A link without siteId lists every Site.
    expect(result.current.missingConfigAllSites).toBe(true);

    act(() => result.current.clearMissingConfig());
    expect(result.current.missingConfig).toBe('');
    expect(result.current.missingConfigAllSites).toBe(false);
    expect(query().get('missingConfig')).toBeNull();
    expect(query().get('siteId')).toBe(SITE);
  });

  it('ignores a ?missingConfig= value that is not a config key', () => {
    openAt('?siteId=site-1&missingConfig=%3Cscript%3E');
    const { result } = renderHook(() => useWorkspaceNavigation(SITE));
    expect(result.current.missingConfig).toBe('');
    expect(result.current.tab).toBe('racks');
  });

  it('keeps the tab in the URL and resets only on a double click of the open tab', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    openAt('?siteId=site-1');
    const { result } = renderHook(() => useWorkspaceNavigation(SITE));
    const reset = vi.fn();

    act(() => result.current.selectTab('models', reset));
    expect(result.current.tab).toBe('models');
    expect(query().get('tab')).toBe('models');
    expect(reset).not.toHaveBeenCalled();

    // Second click on the open tab within 500 ms: back to the Site root.
    now.mockReturnValue(1_200);
    act(() => result.current.selectTab('models', reset));
    expect(reset).toHaveBeenCalledTimes(1);

    // Two slow clicks are not a double click.
    now.mockReturnValue(5_000);
    act(() => result.current.selectTab('models', reset));
    now.mockReturnValue(6_000);
    act(() => result.current.selectTab('models', reset));
    expect(reset).toHaveBeenCalledTimes(1);

    // Bastidores is the default tab and is not written to the URL.
    act(() => result.current.selectTab('racks', reset));
    expect(query().get('tab')).toBeNull();
  });

  it('returns the same object between renders when nothing changed', () => {
    openAt('?siteId=site-1');
    const { result, rerender } = renderHook(() => useWorkspaceNavigation(SITE));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
