import { describe, expect, it } from 'vitest';
import { isAppPath, isFiniteNumber, isRecord, parseJson } from './data-guards';

describe('data guards', () => {
  it('parseJson returns the value for valid JSON and undefined for corrupt or missing text', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('[1,2]')).toEqual([1, 2]);
    expect(parseJson('{not json')).toBeUndefined();
    expect(parseJson('')).toBeUndefined();
    expect(parseJson(null)).toBeUndefined();
    expect(parseJson(undefined)).toBeUndefined();
  });

  it('isRecord accepts plain objects only', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('x')).toBe(false);
  });

  it('isFiniteNumber rejects NaN, Infinity and numeric strings', () => {
    expect(isFiniteNumber(3)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNumber('3')).toBe(false);
  });

  it('isAppPath accepts in-app paths and rejects other origins and script URLs', () => {
    expect(isAppPath('/ipam?siteId=s1')).toBe(true);
    expect(isAppPath('//evil.example/x')).toBe(false);
    expect(isAppPath('/\\evil.example')).toBe(false);
    expect(isAppPath('javascript:alert(1)')).toBe(false);
    expect(isAppPath('https://evil.example')).toBe(false);
    expect(isAppPath(undefined)).toBe(false);
  });

  it('isAppPath rejects control characters that URL parsing strips into a protocol-relative URL', () => {
    expect(isAppPath('/\t/x')).toBe(false);
    expect(isAppPath('/\n/x')).toBe(false);
    expect(isAppPath('/\r/x')).toBe(false);
    expect(isAppPath('/\t\\x')).toBe(false);
    expect(isAppPath('/ipam\u0000')).toBe(false);
    expect(isAppPath('/ipam\u007f')).toBe(false);
    expect(isAppPath('/\\x')).toBe(false);
    expect(isAppPath('/ipam/x y')).toBe(true);
  });
});
