import { describe, expect, it } from 'vitest';
import { NO_LOCATION, activeTopologyFilterCount, emptyTopologyFilters, hiddenTopologyNodeIds, topologyLocationOptions, topologyTypeOptions, withHiddenEdges, withHiddenNodes } from './filters';
import type { TopologyNodeAlertSummary } from './alerts';
import type { TopologyNode } from './types';

const rack = (building: string, room: string) => ({ name: 'R1', room: { name: room, building: { name: building } } });
const node = (id: string, type: string, location: ReturnType<typeof rack> | null): TopologyNode => ({ id: `map:${id}`, deviceId: id, x: 0, y: 0, device: { id, name: id, type, rack: location } });
const nodes = [
  node('core', 'SWITCH', rack('Sede', 'Sala 1')),
  node('edge', 'ROUTER', rack('Sede', 'Sala 1')),
  node('fw', 'FIREWALL', rack('Armazém', 'Bastidor A')),
  node('srv', 'SERVER', null),
  node('acc', 'SWITCH', rack('Armazém', 'Bastidor A')),
];
const alerts = new Map<string, TopologyNodeAlertSummary>([
  ['core', { count: 2, highestSeverity: 'CRITICAL', titles: ['Down', 'CPU'] }],
  ['fw', { count: 1, highestSeverity: 'WARNING', titles: ['Disk'] }],
]);
const visible = (filters = emptyTopologyFilters) => { const hidden = hiddenTopologyNodeIds(nodes, filters, alerts); return nodes.filter((item) => !hidden.has(item.id)).map((item) => item.deviceId); };

describe('topology filters', () => {
  it('lists types (known order, with counts) and locations (unlocated last)', () => {
    expect(topologyTypeOptions(nodes)).toEqual([
      { value: 'SWITCH', label: 'Switch', count: 2 },
      { value: 'ROUTER', label: 'Router', count: 1 },
      { value: 'FIREWALL', label: 'Firewall', count: 1 },
      { value: 'SERVER', label: 'Servidor', count: 1 },
    ]);
    expect(topologyLocationOptions(nodes).map((option) => [option.value, option.count])).toEqual([['Armazém · Bastidor A', 2], ['Sede · Sala 1', 2], [NO_LOCATION, 1]]);
    expect(topologyTypeOptions([node('x', 'PATCH_PANEL', null)])[0]).toEqual({ value: 'PATCH_PANEL', label: 'PATCH_PANEL', count: 1 });
  });

  it('shows everything without filters', () => {
    expect(visible()).toEqual(['core', 'edge', 'fw', 'srv', 'acc']);
    expect(activeTopologyFilterCount(emptyTopologyFilters)).toBe(0);
  });

  it('filters by type, location and problem state, combined with AND', () => {
    expect(visible({ ...emptyTopologyFilters, type: 'SWITCH' })).toEqual(['core', 'acc']);
    expect(visible({ ...emptyTopologyFilters, location: 'Sede · Sala 1' })).toEqual(['core', 'edge']);
    expect(visible({ ...emptyTopologyFilters, location: NO_LOCATION })).toEqual(['srv']);
    expect(visible({ ...emptyTopologyFilters, problem: 'problem' })).toEqual(['core', 'fw']);
    expect(visible({ ...emptyTopologyFilters, problem: 'critical' })).toEqual(['core']);
    expect(visible({ ...emptyTopologyFilters, problem: 'healthy' })).toEqual(['edge', 'srv', 'acc']);
    expect(visible({ type: 'SWITCH', location: 'Armazém · Bastidor A', problem: 'healthy' })).toEqual(['acc']);
    expect(activeTopologyFilterCount({ type: 'SWITCH', location: '', problem: 'healthy' })).toBe(2);
  });

  it('hides nodes and every edge touching a hidden node, keeping unchanged objects', () => {
    const flowNodes = [{ id: 'a' }, { id: 'b' }, { id: 'c', hidden: true }];
    const flowEdges: Array<{ id: string; source: string; target: string; hidden?: boolean }> = [{ id: 'ab', source: 'a', target: 'b' }, { id: 'bc', source: 'b', target: 'c' }];
    const hidden = new Set(['b']);
    const nextNodes = withHiddenNodes(flowNodes, hidden);
    expect(nextNodes.map((item) => Boolean(item.hidden))).toEqual([false, true, false]);
    expect(nextNodes[0]).toBe(flowNodes[0]);
    expect(withHiddenEdges(flowEdges, hidden).map((item) => item.hidden)).toEqual([true, true]);
    expect(withHiddenEdges(flowEdges, new Set())[0]).toBe(flowEdges[0]);
  });
});
