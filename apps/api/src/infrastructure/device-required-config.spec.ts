import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  createViolations, DEVICE_REQUIRED_CONFIGS, deviceConfigStatus, deviceSettingsHref, FEATURE_CONFIG_KEYS, missingConfigListHref,
  missingConfigWhere, requiredConfigRegistry, requiredConfigSummary, toDeviceConfigState, updateViolations, type DeviceConfigState,
} from './required-config/device-required-config';
import { DeviceRequiredConfigService, manageableDeviceTypes, RequiredConfigException } from './required-config/device-required-config.service';

const complete: DeviceConfigState = { name: 'sw-01', type: 'SWITCH', siteId: 's1', rackId: 'r1', status: 'ACTIVE', backAssetId: 'a1', connectedPlugs: 2 };

/** Minimal evaluator of the Prisma filters missingConfigWhere produces, to prove they match deviceConfigStatus. */
function matches(record: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((item: any) => matches(record, item));
    if (key === 'AND') return value.every((item: any) => matches(record, item));
    if (value === null) return record[key] == null;
    if (typeof value === 'object') {
      if ('not' in value) return record[key] !== value.not;
      if ('gt' in value) return record[key] != null && record[key] > value.gt;
      if ('none' in value) return (record[key] ?? []).length === 0;
      return record[key] != null && matches(record[key], value);
    }
    return record[key] === value;
  });
}

describe('registry', () => {
  test('keys are unique, every config has a known tab and pt-PT copy; FEATURE configs carry bell titles', () => {
    const keys = DEVICE_REQUIRED_CONFIGS.map((item) => item.key);
    assert.equal(new Set(keys).size, keys.length);
    const tabs = requiredConfigRegistry().tabs.map((tab) => tab.key);
    for (const config of DEVICE_REQUIRED_CONFIGS) {
      assert.ok(tabs.includes(config.tab), config.key);
      assert.ok(config.missingMessage && config.label && config.fields.length);
      if (config.kind === 'FEATURE') assert.ok(config.alertTitle?.one && config.alertTitle.other.includes('{count}'));
      assert.equal('introducedAt' in config, false);
    }
    assert.deepEqual(FEATURE_CONFIG_KEYS, ['rearImage', 'power']);
  });

  test('rear image and power apply only to racked, non-retired devices; model image and 0 plugs count', () => {
    const missing = (state: Partial<DeviceConfigState>) => requiredConfigSummary({ ...complete, ...state }).missing;
    assert.deepEqual(missing({}), []);
    assert.deepEqual(missing({ backAssetId: null }), ['rearImage']);
    assert.deepEqual(missing({ backAssetId: null, modelBackAssetId: 'm1' }), []);
    assert.deepEqual(missing({ connectedPlugs: 0 }), ['power']);
    assert.deepEqual(missing({ connectedPlugs: 0, powerPlugCount: 0 }), []);
    assert.deepEqual(missing({ connectedPlugs: 0, modelPowerPlugCount: 0 }), []);
    assert.deepEqual(missing({ connectedPlugs: 0, backAssetId: null, rackId: null }), []);
    assert.deepEqual(missing({ connectedPlugs: 0, backAssetId: null, status: 'RETIRED' }), []);
    assert.deepEqual(requiredConfigSummary({ ...complete, backAssetId: null, connectedPlugs: 0 }).missingTabs, ['imagens', 'energia']);
  });

  test('missingConfigWhere selects exactly the devices deviceConfigStatus reports as missing', () => {
    const variants: any[] = [];
    for (const rackId of [null, 'r1']) for (const status of ['ACTIVE', 'RETIRED']) for (const backAssetId of [null, 'a1'])
      for (const model of [null, { backAssetId: null, powerPlugCount: null }, { backAssetId: 'm1', powerPlugCount: 0 }, { backAssetId: null, powerPlugCount: 3 }])
        for (const powerPlugCount of [null, 0, 1]) for (const outlets of [0, 1])
          variants.push({ name: 'd', type: 'SWITCH', siteId: 's1', rackId, status, backAssetId, modelId: model ? 'm' : null, model, powerPlugCount, pduOutlets: Array(outlets).fill({}), _count: { pduOutlets: outlets } });
    for (const key of FEATURE_CONFIG_KEYS) {
      for (const device of variants) {
        const status = deviceConfigStatus(toDeviceConfigState(device)).find((item) => item.key === key)!;
        assert.equal(matches(device, missingConfigWhere(key)), status.applies && !status.satisfied, `${key} ${JSON.stringify(device)}`);
      }
    }
  });

  test('hrefs: one device opens its settings tab, groups open the filtered list', () => {
    assert.equal(deviceSettingsHref({ id: 'd1', siteId: 's1' }, 'energia'), '/infraestrutura?siteId=s1&tab=devices&deviceId=d1&settingsTab=energia');
    assert.equal(missingConfigListHref('rearImage', 's1'), '/infraestrutura?siteId=s1&tab=devices&missingConfig=rearImage');
    assert.equal(missingConfigListHref('power'), '/infraestrutura?tab=devices&missingConfig=power');
  });
});

describe('new vs existing device rule', () => {
  test('create needs every applicable config, with field-level errors', () => {
    const errors = createViolations({ ...complete, name: ' ', backAssetId: null, connectedPlugs: 0 });
    assert.deepEqual(errors.map((item) => [item.config, item.reason, item.tab, item.fields]), [
      ['name', 'MISSING', 'geral', ['name']], ['rearImage', 'MISSING', 'imagens', ['backAssetId']], ['power', 'MISSING', 'energia', ['power', 'powerPlugCount']],
    ]);
    const response = new RequiredConfigException(errors).getResponse() as any;
    assert.equal(response.code, 'REQUIRED_CONFIG_MISSING');
    assert.equal(response.message, 'Faltam 3 configurações obrigatórias.');
    assert.equal(response.details.errors.length, 3);
  });

  test('legacy devices may be saved while a feature config is still missing', () => {
    const legacy = { ...complete, backAssetId: null, connectedPlugs: 0 };
    assert.deepEqual(updateViolations(legacy, { ...legacy, name: 'novo nome' }), []);
  });

  test('an update may not clear a filled feature config, and core configs always apply', () => {
    assert.deepEqual(updateViolations(complete, { ...complete, backAssetId: null }).map((item) => [item.config, item.reason]), [['rearImage', 'CLEARED']]);
    assert.deepEqual(updateViolations(complete, { ...complete, connectedPlugs: 0 }, ['power']).map((item) => item.config), ['power']);
    assert.deepEqual(updateViolations(complete, { ...complete, connectedPlugs: 0 }, ['rearImage']), []);
    assert.deepEqual(updateViolations(complete, { ...complete, connectedPlugs: 0, powerPlugCount: 0 }), []);
    assert.deepEqual(updateViolations(complete, { ...complete, rackId: null, backAssetId: null, connectedPlugs: 0 }), []);
    const legacy = { ...complete, name: '', connectedPlugs: 0 };
    assert.deepEqual(updateViolations(legacy, legacy).map((item) => [item.config, item.reason]), [['name', 'MISSING']]);
  });

  test('placing a device is like creating it there: Site → rack, rack → rack, RETIRED → active, 0 → n plugs', () => {
    const reasons = (before: DeviceConfigState, after: DeviceConfigState) => updateViolations(before, after).map((item) => [item.config, item.reason]);
    const unracked = { ...complete, rackId: null, backAssetId: null, connectedPlugs: 0 };
    // Site → rack without power or rear image: both start to apply → MISSING
    assert.deepEqual(reasons(unracked, { ...unracked, rackId: 'r1' }), [['rearImage', 'MISSING'], ['power', 'MISSING']]);
    // ...unless the save provides them, or declares 0 plugs
    assert.deepEqual(reasons(unracked, { ...unracked, rackId: 'r1', backAssetId: 'a1', connectedPlugs: 2 }), []);
    assert.deepEqual(reasons(unracked, { ...unracked, rackId: 'r1', modelBackAssetId: 'm1', powerPlugCount: 0 }), []);
    // A legacy device moving to another rack is placed again → MISSING; staying in its rack keeps the gap
    const legacy = { ...complete, backAssetId: null, connectedPlugs: 0 };
    assert.deepEqual(reasons(legacy, { ...legacy, rackId: 'r2' }), [['rearImage', 'MISSING'], ['power', 'MISSING']]);
    assert.deepEqual(reasons(legacy, { ...legacy, name: 'outro' }), []);
    // Leaving RETIRED inside a rack, or going from 0 plugs to some, starts the requirement
    assert.deepEqual(reasons({ ...legacy, status: 'RETIRED' }, { ...legacy, status: 'ACTIVE' }), [['rearImage', 'MISSING'], ['power', 'MISSING']]);
    assert.deepEqual(reasons({ ...complete, powerPlugCount: 0, connectedPlugs: 0 }, { ...complete, powerPlugCount: 2, connectedPlugs: 0 }), [['power', 'MISSING']]);
    // Leaving a rack never needs them
    assert.deepEqual(reasons(legacy, { ...legacy, rackId: null }), []);
  });
});

describe('grouped bell alerts', () => {
  function service(counts: Record<string, { count: number; sites: string[]; first?: any }>, roomIds = ['room-1']) {
    const calls: any[] = [];
    const which = (where: any) => (JSON.stringify(where).includes('pduOutlets') ? 'power' : 'rearImage');
    const queries = { groupBy: 0, findFirst: 0, visibleRoomIds: 0 };
    const prisma: any = {
      device: {
        // Spread the count over the sites: the first site takes the remainder.
        groupBy: async ({ where }: any) => {
          queries.groupBy += 1; calls.push(where);
          const entry = counts[which(where)]; if (!entry?.count) return [];
          const sites = entry.sites.length ? entry.sites : [null];
          const each = Math.floor(entry.count / sites.length);
          return sites.map((siteId, index) => ({ siteId, _count: { _all: index === 0 ? entry.count - each * (sites.length - 1) : each } }));
        },
        findFirst: async ({ where }: any) => { queries.findFirst += 1; return counts[which(where)]?.first ?? null; },
      },
    };
    const access: any = { visibleRoomIds: async () => { queries.visibleRoomIds += 1; return roomIds; } };
    return { subject: new DeviceRequiredConfigService(prisma, access), calls, queries };
  }
  const admin = { id: 'u', roles: ['ADMIN'] } as any;

  test('one alert per missing config: 1 device links to its tab, many link to the filtered list', async () => {
    const { subject } = service({
      rearImage: { count: 1, sites: ['s1'], first: { id: 'd1', name: 'sw-01', siteId: 's1' } },
      power: { count: 4, sites: ['s1', 's2'], first: { id: 'd2', name: 'a', siteId: 's1' } },
    });
    const alerts = await subject.topbarAlerts(admin);
    assert.deepEqual(alerts.map(({ id, title, href, persistent, severity }) => ({ id, title, href, persistent, severity })), [
      { id: 'device-missing-config-rearImage', title: '1 dispositivo sem imagem traseira', href: '/infraestrutura?siteId=s1&tab=devices&deviceId=d1&settingsTab=imagens', persistent: true, severity: 'WARNING' },
      { id: 'device-missing-config-power', title: '4 dispositivos sem tomadas de energia configuradas', href: '/infraestrutura?tab=devices&missingConfig=power&allSites=1', persistent: true, severity: 'WARNING' },
    ]);
    assert.ok(alerts[0].detail.startsWith('sw-01: '));
    assert.equal(alerts[0].siteCount, 1);
    assert.equal(alerts[0].detail, 'sw-01: A vista traseira do bastidor não os consegue mostrar.');
    assert.equal(alerts[1].siteCount, 2);
    assert.equal(alerts[1].detail, 'A carga das PDUs não inclui estes equipamentos — em 2 Sites.');
  });

  test('cost: visible rooms once, one grouped query per config, a device lookup only when count is 1', async () => {
    const { subject, queries } = service({ rearImage: { count: 1, sites: ['s1'], first: { id: 'd1', name: 'sw-01', siteId: 's1' } }, power: { count: 5, sites: ['s1'] } });
    await subject.topbarAlerts(admin);
    assert.deepEqual(queries, { groupBy: 2, findFirst: 1, visibleRoomIds: 1 });
  });

  test('stable ids (refresh never duplicates) and the alert clears once nothing is missing', async () => {
    const counts: any = { rearImage: { count: 2, sites: ['s1'] } };
    const { subject } = service(counts);
    const first = await subject.topbarAlerts(admin);
    assert.deepEqual(first.map((item) => item.id), ['device-missing-config-rearImage']);
    assert.equal(first[0].href, '/infraestrutura?siteId=s1&tab=devices&missingConfig=rearImage');
    assert.deepEqual((await subject.topbarAlerts(admin)).map((item) => item.id), first.map((item) => item.id));
    counts.rearImage.count = 0;
    assert.deepEqual(await subject.topbarAlerts(admin), []);
  });

  test('scope: visible rooms and the device types the role may manage; read-only users get none', async () => {
    const { subject, calls } = service({ rearImage: { count: 1, sites: ['s1'] } });
    await subject.topbarAlerts({ id: 'u', roles: ['NETWORK_OPERATOR'] } as any);
    assert.deepEqual(calls[0].AND[0], { rack: { roomId: { in: ['room-1'] } }, type: { in: ['SWITCH', 'ROUTER', 'FIREWALL'] } });
    assert.equal(manageableDeviceTypes({ roles: ['READ_ONLY'] } as any), 'none');
    assert.deepEqual(await subject.topbarAlerts({ id: 'u', roles: ['READ_ONLY'] } as any), []);
  });

  test('2 Sites: the list without siteId uses the bell scope, so its total equals the bell count (allSites=1)', async () => {
    // In-memory devices: 4 in LX and 2 in QA-PILOT miss power; 1 elsewhere is outside the visible rooms.
    const devices = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `lx-${i}`, name: `lx-${i}`, siteId: 'lx', roomId: 'room-1' })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: `qa-${i}`, name: `qa-${i}`, siteId: 'qa', roomId: 'room-2' })),
      { id: 'hidden', name: 'hidden', siteId: 'other', roomId: 'room-9' },
    ];
    const wheres: any[] = [];
    const matching = (where: any) => {
      wheres.push(where);
      const [scope] = where.AND;
      return devices.filter((device) => scope.rack.roomId.in.includes(device.roomId) && (!scope.siteId || scope.siteId === device.siteId));
    };
    const prisma: any = {
      device: {
        groupBy: async ({ where }: any) => {
          const bySite = new Map<string, number>();
          for (const device of matching(where)) bySite.set(device.siteId, (bySite.get(device.siteId) ?? 0) + 1);
          return JSON.stringify(where).includes('pduOutlets') ? [...bySite].map(([siteId, all]) => ({ siteId, _count: { _all: all } })) : [];
        },
        findFirst: async () => null,
        findMany: async ({ where, skip, take }: any) => matching(where).slice(skip, skip + take).map((device) => ({ ...device, site: { name: device.siteId }, rack: null, model: null })),
        count: async ({ where }: any) => matching(where).length,
      },
    };
    const access: any = { visibleRoomIds: async () => ['room-1', 'room-2'] };
    const subject = new DeviceRequiredConfigService(prisma, access);
    const [alert] = await subject.topbarAlerts(admin);
    const list = await subject.listMissing(admin, 'power', undefined, '1', '5');
    assert.deepEqual({ count: alert.count, siteCount: alert.siteCount, href: alert.href }, { count: 6, siteCount: 2, href: '/infraestrutura?tab=devices&missingConfig=power&allSites=1' });
    assert.equal(list.total, alert.count);
    assert.equal(list.totalPages, 2);
    assert.deepEqual([...new Set(list.items.map((item: any) => item.siteName))], ['lx', 'qa']);
    // Same where for the bell and the list (scope + filter), not just the same number.
    const powerWheres = wheres.filter((where) => JSON.stringify(where).includes('pduOutlets'));
    assert.equal(powerWheres.length, 3); // bell groupBy, list findMany, list count
    for (const where of powerWheres) assert.deepEqual(where, powerWheres[0]);
  });

  test('affected-devices list rejects an unknown config', async () => {
    const { subject } = service({});
    await assert.rejects(subject.listMissing(admin, 'frontImage'), (error: any) => error.getResponse().code === 'UNKNOWN_REQUIRED_CONFIG');
  });
});
