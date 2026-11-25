import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validate } from 'class-validator';
import { IsHttpUrl, isHttpUrl } from './http-url';

test('isHttpUrl accepts absolute http and https URLs', () => {
  for (const url of ['http://zabbix.interno', 'https://zabbix.interno/path?q=1#x', 'https://10.0.0.5:8443/', 'HTTPS://Example.com']) assert.equal(isHttpUrl(url), true, url);
});

test('isHttpUrl refuses every other scheme, however it is spelled', () => {
  for (const url of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'javascript://example.com/%0Aalert(1)',
    'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'ftp://example.com', 'mailto:a@b.c',
  ]) assert.equal(isHttpUrl(url), false, url);
});

test('isHttpUrl refuses relative, empty, padded and non-string values', () => {
  for (const value of ['', '/portal', '//evil.example', 'example.com', ' https://example.com', 'https://example.com\n', 'http://', null, undefined, 42, {}]) assert.equal(isHttpUrl(value), false, String(value));
});

class Sample { @IsHttpUrl() url!: unknown; }
const errorsFor = async (url: unknown) => validate(Object.assign(new Sample(), { url }));

test('@IsHttpUrl passes http(s) URLs and fails other schemes with its own constraint', async () => {
  assert.deepEqual(await errorsFor('https://zabbix.interno'), []);
  const [error] = await errorsFor('javascript:alert(1)');
  assert.equal(error?.property, 'url');
  assert.match(error?.constraints?.isHttpUrl ?? '', /http:\/\/ or https:\/\//);
  assert.equal((await errorsFor('data:text/html,x')).length, 1);
});
