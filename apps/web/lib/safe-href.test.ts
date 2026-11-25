import { describe, expect, it } from 'vitest';
import { isHttpUrl, safeHref } from './safe-href';

describe('safeHref', () => {
  it('returns http and https URLs unchanged', () => {
    for (const url of ['http://zabbix.interno', 'https://grafana.interno:3000/d/abc?x=1#y', 'HTTPS://Example.com']) expect(safeHref(url)).toBe(url);
  });

  it('returns undefined for any other scheme, however it is spelled', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'javascript://x.example/%0Aalert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'mailto:a@b.c', 'ftp://example.com']) expect(safeHref(url)).toBeUndefined();
  });

  it('returns undefined for relative, empty and missing values', () => {
    for (const url of ['', '/portal', '//evil.example', 'example.com', 'http://', null, undefined]) expect(safeHref(url)).toBeUndefined();
    expect(isHttpUrl(42)).toBe(false);
  });
});
