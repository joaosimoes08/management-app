import { describe, expect, it } from 'vitest';
import { RACK_IMAGE, RACK_UNIT_PITCH, RACK_UNITS, rackUnitAt, rackUnitBox, rackUnitFromDrop, rackUnitImageY } from './utils';

// Centres of the rail labels measured on public/assets/rack-empty-42u.png (image pixels).
const LABEL_CENTER = { 42: 27.5, 41: 45.5, 21: 413.5, 20: 432, 19: 450.5, 18: 469, 2: 763, 1: 781 } as const;

describe('rack U to y mapping', () => {
  it('uses the measured 42U geometry of the rack image', () => {
    expect(RACK_IMAGE.height).toBe(838);
    expect(RACK_UNIT_PITCH).toBeCloseTo(18.374, 2);
  });

  it('puts U42 at the top edge and U1 at the bottom edge', () => {
    expect(rackUnitBox(42, 1)).toEqual({ top: 0, height: 100 / 42 });
    expect(rackUnitBox(1, 1).top + rackUnitBox(1, 1).height).toBeCloseTo(100, 10);
    expect(rackUnitImageY(42, 1).top).toBeCloseTo(RACK_IMAGE.unitTop, 5);
    expect(rackUnitImageY(1, 1).bottom).toBeCloseTo(RACK_IMAGE.unitBottom, 5);
  });

  it.each(Object.entries(LABEL_CENTER))('centres U%s on its rail label within 1 px', (unit, center) => {
    const { top, bottom } = rackUnitImageY(Number(unit), 1);
    expect(Math.abs((top + bottom) / 2 - center)).toBeLessThan(1);
  });

  it('spans multi-U devices from their lowest unit upwards', () => {
    const twoU = rackUnitImageY(30, 2);
    expect(twoU.bottom - twoU.top).toBeCloseTo(2 * RACK_UNIT_PITCH, 5);
    expect(twoU.top).toBeCloseTo(rackUnitImageY(31, 1).top, 5);
    expect(twoU.bottom).toBeCloseTo(rackUnitImageY(30, 1).bottom, 5);
    const fourU = rackUnitBox(1, 4);
    expect(fourU.top + fourU.height).toBeCloseTo(100, 10);
    expect(fourU.height).toBeCloseTo(400 / 42, 10);
  });

  it('snaps a point back to the same grid', () => {
    const height = 840;
    for (let unit = 1; unit <= RACK_UNITS; unit += 1) {
      const box = rackUnitBox(unit, 1);
      expect(rackUnitAt(((box.top + box.height / 2) / 100) * height, height)).toBe(unit);
    }
    expect(rackUnitAt(-5, height)).toBe(42);
    expect(rackUnitAt(height + 5, height)).toBe(1);
  });

  it('drops on the 42U grid even for a smaller rack, and clamps to the rack size', () => {
    const target = { getBoundingClientRect: () => ({ top: 100, height: 420 }) } as unknown as HTMLElement;
    const data = (offset = '0') => ({ getData: (key: string) => (key === 'application/x-rack-offset' ? offset : '') }) as unknown as DataTransfer;
    // 10 px per unit: y=105 is inside U42, y=515 inside U1.
    expect(rackUnitFromDrop({ currentTarget: target, clientY: 105, dataTransfer: data() }, 42, 1)).toBe(42);
    expect(rackUnitFromDrop({ currentTarget: target, clientY: 515, dataTransfer: data() }, 42, 1)).toBe(1);
    expect(rackUnitFromDrop({ currentTarget: target, clientY: 325, dataTransfer: data() }, 42, 2)).toBe(19);
    expect(rackUnitFromDrop({ currentTarget: target, clientY: 105, dataTransfer: data() }, 24, 1)).toBe(24);
  });
});
