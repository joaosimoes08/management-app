import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { interfaceTrafficRates } from './metrics';

describe('SNMP interface traffic metrics', () => {
  it('derives Mbps from 64-bit counters and leaves the first sample unplotted', () => {
    const result = interfaceTrafficRates([
      { observedAt: new Date('2026-01-01T00:00:00Z'), ifIndex: 2, counters: { hcInOctets: '1000000', hcOutOctets: '2000000' } },
      { observedAt: new Date('2026-01-01T00:00:10Z'), ifIndex: 2, counters: { hcInOctets: '2000000', hcOutOctets: '2500000' } },
    ]);
    assert.equal(result[0].inMbps, null);
    assert.equal(result[1].inMbps, 0.8);
    assert.equal(result[1].outMbps, 0.4);
  });

  it('supports 32-bit counter rollover, but does not bridge a reset in a 64-bit counter', () => {
    const rollover = interfaceTrafficRates([
      { observedAt: new Date(0), ifIndex: 1, counters: { inOctets: '4294967290' } },
      { observedAt: new Date(1000), ifIndex: 1, counters: { inOctets: '4' } },
    ]);
    assert.equal(rollover[1].inMbps, 0.00008);
    const reset = interfaceTrafficRates([
      { observedAt: new Date(0), ifIndex: 1, counters: { hcInOctets: '900', inOctets: '900' } },
      { observedAt: new Date(1000), ifIndex: 1, counters: { hcInOctets: '5', inOctets: '5' } },
    ]);
    assert.equal(reset[1].inMbps, null);
  });

  it('leaves rates unavailable when counters are absent or timestamps are not increasing', () => {
    const result = interfaceTrafficRates([
      { observedAt: new Date(1000), ifIndex: 1, counters: {} },
      { observedAt: new Date(1000), ifIndex: 1, counters: { inOctets: '20' } },
    ]);
    assert.equal(result[1].inMbps, null);
  });
});
