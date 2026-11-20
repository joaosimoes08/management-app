import { describe, expect, it } from 'vitest';
import { countProblemsBySeverity } from './severity';

describe('countProblemsBySeverity', () => {
  it('sums OPEN and ACKNOWLEDGED alerts and quality findings per severity, separately', () => {
    const counts = countProblemsBySeverity(
      [
        { status: 'OPEN', severity: 'CRITICAL', _count: { _all: 2 } },
        { status: 'ACKNOWLEDGED', severity: 'CRITICAL', _count: { _all: 1 } },
        { status: 'OPEN', severity: 'INFO', _count: { _all: 4 } },
      ],
      [
        { status: 'OPEN', severity: 'CRITICAL', _count: { _all: 5 } },
        { status: 'ACKNOWLEDGED', severity: 'WARNING', _count: { _all: 3 } },
      ],
    );
    expect(counts.CRITICAL).toEqual({ alerts: 3, quality: 5, total: 8 });
    expect(counts.WARNING).toEqual({ alerts: 0, quality: 3, total: 3 });
    expect(counts.INFO).toEqual({ alerts: 4, quality: 0, total: 4 });
    expect(counts.HIGH).toEqual({ alerts: 0, quality: 0, total: 0 });
  });

  it('excludes SNOOZED and RESOLVED groups', () => {
    const counts = countProblemsBySeverity(
      [
        { status: 'SNOOZED', severity: 'HIGH', _count: { _all: 7 } },
        { status: 'RESOLVED', severity: 'HIGH', _count: { _all: 9 } },
        { status: 'OPEN', severity: 'HIGH', _count: { _all: 1 } },
      ],
      [{ status: 'SNOOZED', severity: 'CRITICAL', _count: { _all: 6 } }],
    );
    expect(counts.HIGH).toEqual({ alerts: 1, quality: 0, total: 1 });
    expect(counts.CRITICAL.total).toBe(0);
  });

  it('returns zeros for missing groups and ignores unknown severities', () => {
    const counts = countProblemsBySeverity(undefined, [{ status: 'OPEN', severity: 'MEDIUM', _count: { _all: 2 } }, { status: 'OPEN', severity: 'INFO' }]);
    expect(Object.values(counts).every((count) => count.total === 0)).toBe(true);
  });
});
