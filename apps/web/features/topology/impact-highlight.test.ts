import { describe, expect, it } from 'vitest';
import { impactFixture, pathFixture } from './__fixtures__/impact';
import { impactHighlight, pathHighlight, withHighlightClasses } from './impact-highlight';
import type { TopologyConnection, TopologyNode } from './types';

const node = (deviceId: string): TopologyNode => ({ id: `m:${deviceId}`, deviceId, x: 0, y: 0 });
const link = (id: string, sourceDeviceId: string, targetDeviceId: string): TopologyConnection => ({ id, sourceDeviceId, targetDeviceId, sourceNodeId: `m:${sourceDeviceId}`, targetNodeId: `m:${targetDeviceId}` });
const map = {
  nodes: ['fw', 'core', 'acc-1', 'srv', 'other'].map(node),
  connections: [link('c-fw-core', 'fw', 'core'), link('c-core-acc1', 'core', 'acc-1'), link('c-fw-other', 'fw', 'other'), link('c-other-srv', 'other', 'srv')],
};

describe('impactHighlight', () => {
  it('marks what goes down, what is cut off and what loses one feed, by map node id', () => {
    const result = impactHighlight(impactFixture(), map);
    expect(Object.fromEntries(result.nodes)).toEqual({ 'm:core': 'down', 'm:acc-1': 'cut', 'm:srv': 'degraded' });
    // acc-2 is affected but not drawn on this map.
    expect(result.offMap).toBe(1);
  });

  it('marks links touching a failed device as down and the cut-off route by its connection id', () => {
    const result = impactHighlight(impactFixture(), map);
    expect(result.edges.get('c-fw-core')).toBe('down');
    expect(result.edges.get('c-core-acc1')).toBe('down');
    expect(result.edges.has('c-fw-other')).toBe(false);
    expect(result.edges.has('c-other-srv')).toBe(false);
    const viaOnly = impactHighlight(impactFixture({ down: [] }), map);
    expect(viaOnly.edges.get('c-core-acc1')).toBe('cut');
  });
});

describe('pathHighlight', () => {
  it('highlights visible steps and links only', () => {
    const result = pathHighlight(pathFixture(), { nodes: [node('acc-2'), node('fw'), node('core')], connections: [link('c-x-fw', 'x', 'fw'), link('c-fw-core', 'fw', 'core')] });
    expect([...result.nodes.keys()]).toEqual(['m:acc-2', 'm:fw']);
    expect([...result.edges.keys()]).toEqual(['c-x-fw']);
    expect(result.offMap).toBe(0);
  });
});

describe('withHighlightClasses', () => {
  it('adds the state class to highlighted items and dims the rest, keeping existing classes', () => {
    const items = withHighlightClasses([{ id: 'a', className: 'keep' }, { id: 'b' }], new Map([['a', 'down']]), 'node');
    expect(items[0].className).toBe('keep topology-node--impact topology-node--impact-down');
    expect(items[1].className).toBe('topology-node--dimmed');
    const untouched = [{ id: 'a' }];
    expect(withHighlightClasses(untouched, null, 'edge')).toBe(untouched);
  });
});
