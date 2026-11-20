import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { classifyTrap, decodeTrap, lookupTrap, RECOVERY_CAPABLE_TRAP_OIDS, TRAP_CATALOG, trapAlertTitle } from './trap-catalog';

// Resolved independently with `snmptranslate -On` against the cisco/cisco-mibs v2 sources.
const MIB_VERIFIED: Record<string, string> = {
  coldStart: '1.3.6.1.6.3.1.1.5.1', warmStart: '1.3.6.1.6.3.1.1.5.2', linkDown: '1.3.6.1.6.3.1.1.5.3', linkUp: '1.3.6.1.6.3.1.1.5.4', authenticationFailure: '1.3.6.1.6.3.1.1.5.5',
  ciscoEnvMonShutdownNotification: '1.3.6.1.4.1.9.9.13.3.0.1', ciscoEnvMonVoltageNotification: '1.3.6.1.4.1.9.9.13.3.0.2', ciscoEnvMonTemperatureNotification: '1.3.6.1.4.1.9.9.13.3.0.3',
  ciscoEnvMonFanNotification: '1.3.6.1.4.1.9.9.13.3.0.4', ciscoEnvMonRedundantSupplyNotification: '1.3.6.1.4.1.9.9.13.3.0.5', ciscoEnvMonVoltStatusChangeNotif: '1.3.6.1.4.1.9.9.13.3.0.6',
  ciscoEnvMonTempStatusChangeNotif: '1.3.6.1.4.1.9.9.13.3.0.7', ciscoEnvMonFanStatusChangeNotif: '1.3.6.1.4.1.9.9.13.3.0.8', ciscoEnvMonSuppStatusChangeNotif: '1.3.6.1.4.1.9.9.13.3.0.9',
  entSensorThresholdNotification: '1.3.6.1.4.1.9.9.91.2.0.1',
  cefcModuleStatusChange: '1.3.6.1.4.1.9.9.117.2.0.1', cefcPowerStatusChange: '1.3.6.1.4.1.9.9.117.2.0.2', cefcFRUInserted: '1.3.6.1.4.1.9.9.117.2.0.3', cefcFRURemoved: '1.3.6.1.4.1.9.9.117.2.0.4',
  cefcUnrecognizedFRU: '1.3.6.1.4.1.9.9.117.2.0.5', cefcFanTrayStatusChange: '1.3.6.1.4.1.9.9.117.2.0.6', cefcPowerSupplyOutputChange: '1.3.6.1.4.1.9.9.117.2.0.7',
  cswStackPortChange: '1.3.6.1.4.1.9.9.500.0.0.1', cswStackNewMaster: '1.3.6.1.4.1.9.9.500.0.0.2', cswStackMismatch: '1.3.6.1.4.1.9.9.500.0.0.3', cswStackRingRedundant: '1.3.6.1.4.1.9.9.500.0.0.4',
  cswStackNewMember: '1.3.6.1.4.1.9.9.500.0.0.5', cswStackMemberRemoved: '1.3.6.1.4.1.9.9.500.0.0.6',
  cswStackPowerPortLinkStatusChanged: '1.3.6.1.4.1.9.9.500.0.0.7', cswStackPowerPortOperStatusChanged: '1.3.6.1.4.1.9.9.500.0.0.8', cswStackPowerVersionMismatch: '1.3.6.1.4.1.9.9.500.0.0.9',
  cswStackPowerInvalidTopology: '1.3.6.1.4.1.9.9.500.0.0.10', cscwStackPowerBudgetWarrning: '1.3.6.1.4.1.9.9.500.0.0.11', cswStackPowerInvalidInputCurrent: '1.3.6.1.4.1.9.9.500.0.0.12',
  cswStackPowerInvalidOutputCurrent: '1.3.6.1.4.1.9.9.500.0.0.13', cswStackPowerUnderBudget: '1.3.6.1.4.1.9.9.500.0.0.14', cswStackPowerUnbalancedPowerSupplies: '1.3.6.1.4.1.9.9.500.0.0.15',
  cswStackPowerInsufficientPower: '1.3.6.1.4.1.9.9.500.0.0.16', cswStackPowerPriorityConflict: '1.3.6.1.4.1.9.9.500.0.0.17', cswStackPowerUnderVoltage: '1.3.6.1.4.1.9.9.500.0.0.18',
  cswStackPowerGLS: '1.3.6.1.4.1.9.9.500.0.0.19', cswStackPowerILS: '1.3.6.1.4.1.9.9.500.0.0.20', cswStackPowerSRLS: '1.3.6.1.4.1.9.9.500.0.0.21', cswStackPowerSSLS: '1.3.6.1.4.1.9.9.500.0.0.22',
  cpmCPURisingThreshold: '1.3.6.1.4.1.9.9.109.2.0.1', cpmCPUFallingThreshold: '1.3.6.1.4.1.9.9.109.2.0.2',
  cempMemBufferNotify: '1.3.6.1.4.1.9.9.221.0.1',
  cErrDisableInterfaceEvent: '1.3.6.1.4.1.9.9.548.0.1.1', cErrDisableInterfaceEventRev1: '1.3.6.1.4.1.9.9.548.0.2',
  ciscoConfigManEvent: '1.3.6.1.4.1.9.9.43.2.0.1', ccmCLIRunningConfigChanged: '1.3.6.1.4.1.9.9.43.2.0.2',
};

type Fixture = { name: string; trapOid: string; varbinds: Array<{ oid: string; type: number; value: unknown }>; expect: Record<string, any> };
const fixtureFile = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'cisco-c9300-traps.synthetic.json'), 'utf8')) as { _synthetic: string; fixtures: Fixture[] };

describe('SNMP trap catalog', () => {
  it('has one entry per OID and every OID matches the MIB-verified value', () => {
    const oids = TRAP_CATALOG.map((entry) => entry.oid);
    assert.equal(new Set(oids).size, oids.length, 'duplicate OID in catalog');
    assert.equal(TRAP_CATALOG.length, Object.keys(MIB_VERIFIED).length);
    for (const entry of TRAP_CATALOG) {
      assert.equal(entry.oid, MIB_VERIFIED[entry.name], `${entry.mib}::${entry.name}`);
      assert.match(entry.oid, /^1\.3\.6\.1\.(4\.1\.9\.9|6\.3\.1\.1\.5)\./);
      assert.ok(['CRITICAL', 'HIGH', 'WARNING', 'INFO'].includes(entry.severity));
      assert.ok(entry.label.length > 0);
    }
  });

  it('resolves every catalog OID (with or without a leading dot)', () => {
    for (const entry of TRAP_CATALOG) {
      assert.equal(lookupTrap(entry.oid)?.name, entry.name);
      assert.equal(lookupTrap(`.${entry.oid}`)?.name, entry.name);
      assert.deepEqual(classifyTrap(entry.oid), { category: entry.category, severity: entry.severity });
    }
  });

  it('keeps the previous standard trap classification unchanged', () => {
    assert.deepEqual(classifyTrap('1.3.6.1.6.3.1.1.5.1'), { category: 'COLD_START', severity: 'WARNING' });
    assert.deepEqual(classifyTrap('1.3.6.1.6.3.1.1.5.2'), { category: 'WARM_START', severity: 'INFO' });
    assert.deepEqual(classifyTrap('1.3.6.1.6.3.1.1.5.3'), { category: 'LINK_DOWN', severity: 'WARNING' });
    assert.deepEqual(classifyTrap('1.3.6.1.6.3.1.1.5.4'), { category: 'LINK_UP', severity: 'INFO' });
    assert.deepEqual(classifyTrap('1.3.6.1.6.3.1.1.5.5'), { category: 'AUTHENTICATION_FAILURE', severity: 'CRITICAL' });
  });

  it('classifies unknown or missing OIDs as VENDOR/INFO and never mutates raw varbinds', () => {
    assert.deepEqual(classifyTrap('1.3.6.1.4.1.9.9.1'), { category: 'VENDOR', severity: 'INFO' });
    assert.deepEqual(classifyTrap(undefined), { category: 'VENDOR', severity: 'INFO' });
    assert.deepEqual(classifyTrap(null), { category: 'VENDOR', severity: 'INFO' });
    const raw = [{ oid: '1.3.6.1.4.1.99999.1.1.0', type: 4, value: { encoding: 'hex', value: '00ff10' } }];
    const snapshot = JSON.stringify(raw);
    const decoded = decodeTrap('1.3.6.1.4.1.99999.0.1', raw);
    assert.equal(decoded.known, false);
    assert.equal(decoded.category, 'VENDOR');
    assert.equal(decoded.severity, 'INFO');
    assert.equal(decoded.alertable, false);
    assert.equal(JSON.stringify(raw), snapshot);
    assert.doesNotThrow(() => decodeTrap('1.3.6.1.4.1.9.9.13.3.0.4', 'not-an-array'));
    assert.doesNotThrow(() => decodeTrap('1.3.6.1.4.1.9.9.13.3.0.4', [null, 1, { oid: 5 }]));
  });

  it('only lists recovery-capable OIDs from the catalog', () => {
    for (const oid of RECOVERY_CAPABLE_TRAP_OIDS) assert.ok(lookupTrap(oid));
    assert.ok(RECOVERY_CAPABLE_TRAP_OIDS.includes('1.3.6.1.6.3.1.1.5.4'));
    assert.ok(RECOVERY_CAPABLE_TRAP_OIDS.includes('1.3.6.1.4.1.9.9.109.2.0.2'));
  });
});

describe('SNMP trap varbind decoding (synthetic C9300 fixtures)', () => {
  it('fixture file is explicitly marked synthetic', () => {
    assert.match(fixtureFile._synthetic, /SYNTHETIC/);
    assert.match(fixtureFile._synthetic, /NOT captured from a real Catalyst 9300/);
    assert.ok(fixtureFile.fixtures.length >= 30);
  });

  for (const fixture of fixtureFile.fixtures) {
    it(fixture.name, () => {
      const before = JSON.stringify(fixture.varbinds);
      const decoded = decodeTrap(fixture.trapOid, fixture.varbinds);
      const expect = fixture.expect;
      assert.equal(decoded.category, expect.category);
      assert.equal(decoded.severity, expect.severity);
      assert.equal(decoded.isClear, expect.isClear);
      if ('clearKey' in expect) assert.equal(decoded.clearKey, expect.clearKey);
      if ('known' in expect) assert.equal(decoded.known, expect.known);
      if ('alertable' in expect) assert.equal(decoded.alertable, expect.alertable);
      if (expect.title) assert.equal(trapAlertTitle(decoded), expect.title);
      if (expect.summaryIncludes) assert.ok(decoded.summary.includes(expect.summaryIncludes), `${decoded.summary} ⊉ ${expect.summaryIncludes}`);
      for (const [key, value] of Object.entries(expect.fields ?? {})) assert.equal(decoded.fields[key], value, key);
      assert.equal(JSON.stringify(fixture.varbinds), before, 'decoder must not mutate varbinds');
    });
  }

  it('decodes OCTET STRING hex and ignores non-printable binary', () => {
    const decoded = decodeTrap('1.3.6.1.4.1.9.9.13.3.0.4', [
      { oid: '1.3.6.1.4.1.9.9.13.1.4.1.2.5', type: 4, value: { encoding: 'hex', value: '00ff' } },
      { oid: '1.3.6.1.4.1.9.9.13.1.4.1.3.5', type: 2, value: 3 },
    ]);
    assert.equal(decoded.subject, undefined);
    assert.equal(decoded.fields.state, 'critical');
    assert.equal(decoded.clearKey, 'envFan:5');
  });

  it('downgrades to INFO when the decoded state says normal and keeps the problem severity otherwise', () => {
    const fan = (state: number) => decodeTrap('1.3.6.1.4.1.9.9.13.3.0.8', [{ oid: '1.3.6.1.4.1.9.9.13.1.4.1.3.1', type: 2, value: state }]);
    assert.equal(fan(1).severity, 'INFO');
    for (const state of [2, 3, 4, 5, 6]) assert.equal(fan(state).severity, 'HIGH');
    const power = (state: number) => decodeTrap('1.3.6.1.4.1.9.9.117.2.0.2', [{ oid: '1.3.6.1.4.1.9.9.117.1.1.2.1.2.9', type: 2, value: state }]);
    assert.equal(power(2).severity, 'INFO');
    assert.equal(power(9).severity, 'HIGH'); // onButFanFail is not normal
  });
});
