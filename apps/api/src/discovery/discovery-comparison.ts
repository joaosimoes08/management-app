export type ComparableDiscoveryResult = {
  address: string;
  hostname: string | null;
  icmpReachable: boolean;
  openPorts: unknown;
};

export type DiscoveryChange = {
  address: string;
  previous: ComparableDiscoveryResult | null;
  current: ComparableDiscoveryResult | null;
  changes: string[];
};

function ports(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((port): port is number => typeof port === 'number').sort((a, b) => a - b) : [];
}

export function compareDiscoveryResults(previous: ComparableDiscoveryResult[], current: ComparableDiscoveryResult[]) {
  const oldByAddress = new Map(previous.map((result) => [result.address, result]));
  const newByAddress = new Map(current.map((result) => [result.address, result]));
  const newlySeen: DiscoveryChange[] = [];
  const noLongerReachable: DiscoveryChange[] = [];
  const changed: DiscoveryChange[] = [];

  for (const [address, result] of newByAddress) {
    const old = oldByAddress.get(address);
    if (!old) { newlySeen.push({ address, previous: null, current: result, changes: [] }); continue; }
    const differences: string[] = [];
    if (old.hostname !== result.hostname) differences.push('hostname');
    if (old.icmpReachable !== result.icmpReachable) differences.push('icmpReachable');
    if (JSON.stringify(ports(old.openPorts)) !== JSON.stringify(ports(result.openPorts))) differences.push('openPorts');
    if (differences.length) changed.push({ address, previous: old, current: result, changes: differences });
  }
  for (const [address, result] of oldByAddress) {
    if (!newByAddress.has(address)) noLongerReachable.push({ address, previous: result, current: null, changes: [] });
  }
  const byAddress = (a: DiscoveryChange, b: DiscoveryChange) => a.address.localeCompare(b.address, undefined, { numeric: true });
  newlySeen.sort(byAddress); noLongerReachable.sort(byAddress); changed.sort(byAddress);
  return { newlySeen, changed, noLongerReachable };
}
