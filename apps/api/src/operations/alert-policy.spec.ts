import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { alertPolicyDecision, effectiveAlertRule } from './alert-policy';
import { ruleAlertCounts } from './alert-configuration.service';

const global = { id: 'g', source: 'SNMP', siteId: null, minSeverity: 'HIGH', enabled: true };
const siteRule = { id: 's', source: 'SNMP', siteId: 'site-a', minSeverity: 'WARNING', enabled: true };
const disabled = { id: 'd', source: 'SNMP', siteId: 'site-b', minSeverity: 'INFO', enabled: false };

test('effective rule: site-specific beats global, disabled rules never apply', () => {
  assert.equal(effectiveAlertRule([global, siteRule, disabled], { source: 'SNMP', siteId: 'site-a', severity: 'WARNING' })?.id, 's');
  assert.equal(effectiveAlertRule([global, siteRule, disabled], { source: 'SNMP', siteId: 'site-b', severity: 'WARNING' })?.id, 'g');
  assert.equal(effectiveAlertRule([global], { source: 'DISCOVERY', siteId: 'site-a', severity: 'WARNING' }), undefined);
});

test('policy decision keeps the original rules: critical bypasses, maintenance hides, threshold filters', () => {
  assert.equal(alertPolicyDecision([global], [{ siteId: null }], { source: 'SNMP', siteId: 'x', severity: 'CRITICAL' }), 'SHOWN');
  assert.equal(alertPolicyDecision([global], [{ siteId: 'x' }], { source: 'SNMP', siteId: 'x', severity: 'HIGH' }), 'MAINTENANCE');
  assert.equal(alertPolicyDecision([global], [{ siteId: 'y' }], { source: 'SNMP', siteId: 'x', severity: 'HIGH' }), 'SHOWN');
  assert.equal(alertPolicyDecision([global], [], { source: 'SNMP', siteId: 'x', severity: 'WARNING' }), 'BELOW_THRESHOLD');
  assert.equal(alertPolicyDecision([], [], { source: 'SNMP', siteId: 'x', severity: 'INFO' }), 'SHOWN');
});

test('per-rule counts split governed alerts into shown, below threshold and in maintenance', () => {
  const rules = [global, siteRule, disabled];
  const alerts = [
    { source: 'SNMP', siteId: 'site-a', severity: 'WARNING' }, // site rule, shown
    { source: 'SNMP', siteId: 'site-a', severity: 'INFO' }, // site rule, below threshold
    { source: 'SNMP', siteId: 'site-b', severity: 'WARNING' }, // global, below threshold (disabled site-b rule ignored)
    { source: 'SNMP', siteId: 'site-c', severity: 'HIGH' }, // global, in maintenance
    { source: 'SNMP', siteId: 'site-c', severity: 'CRITICAL' }, // global, shown (critical)
    { source: 'DISCOVERY', siteId: 'site-a', severity: 'HIGH' }, // no rule
  ];
  const windows = [{ siteId: 'site-c' }];
  assert.deepEqual(ruleAlertCounts(siteRule, rules, windows, alerts), { matching: 2, governed: 2, shown: 1, belowThreshold: 1, inMaintenance: 0 });
  assert.deepEqual(ruleAlertCounts(global, rules, windows, alerts), { matching: 5, governed: 3, shown: 1, belowThreshold: 1, inMaintenance: 1 });
  assert.deepEqual(ruleAlertCounts(disabled, rules, windows, alerts), { matching: 1, governed: 0, shown: 0, belowThreshold: 0, inMaintenance: 0 });
});
