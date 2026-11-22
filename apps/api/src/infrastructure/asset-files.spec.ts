import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ASSET_CACHE_CONTROL, assetEtag } from './asset-cache';
import { isSvgDocument, sniffImageMime } from './asset-sniff';
import { InfrastructureController } from './infrastructure.controller';
import { InfrastructureService } from './infrastructure.service';

const user = { id: 'user-1', username: 'admin', roles: ['ADMIN'] } as any;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const SVG = Buffer.from('<?xml version="1.0" encoding="UTF-8"?>\n<!-- front -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" data-x="a>b"/><text>1U &amp; 2U</text></svg>\n');
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');
const b64 = (bytes: Buffer) => bytes.toString('base64');
const notImage = (error: unknown) => error instanceof BadRequestException && (error.getResponse() as any).code === 'ASSET_NOT_IMAGE';

describe('sniffImageMime', () => {
  test('recognises PNG, JPEG, WebP and SVG from their bytes', () => {
    assert.equal(sniffImageMime(PNG), 'image/png');
    assert.equal(sniffImageMime(JPEG), 'image/jpeg');
    assert.equal(sniffImageMime(WEBP), 'image/webp');
    assert.equal(sniffImageMime(SVG), 'image/svg+xml');
  });

  test('rejects PDF, HTML, text, empty input and a RIFF file that is not WebP', () => {
    assert.equal(sniffImageMime(PDF), null);
    assert.equal(sniffImageMime(Buffer.from('<!doctype html><html><body><svg></svg></body></html>')), null);
    assert.equal(sniffImageMime(Buffer.from('just some text')), null);
    assert.equal(sniffImageMime(Buffer.alloc(0)), null);
    assert.equal(sniffImageMime(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVEfmt ')])), null);
  });

  test('SVG must be well-formed XML with an <svg> root', () => {
    assert.equal(isSvgDocument(Buffer.from('﻿<svg/>')), true);
    assert.equal(isSvgDocument(Buffer.from('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd"><svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:g/></svg:svg>')), true);
    assert.equal(isSvgDocument(Buffer.from('<svg><g></svg>')), false, 'unclosed child');
    assert.equal(isSvgDocument(Buffer.from('<svg>')), false, 'unclosed root');
    assert.equal(isSvgDocument(Buffer.from('<svg width=10></svg>')), false, 'unquoted attribute');
    assert.equal(isSvgDocument(Buffer.from('<svg></svg><svg></svg>')), false, 'two roots');
    assert.equal(isSvgDocument(Buffer.from('garbage<svg></svg>')), false, 'text before the root');
    assert.equal(isSvgDocument(Buffer.from('<html><svg></svg></html>')), false, 'root is not svg');
    assert.equal(isSvgDocument(Buffer.from([0x3c, 0x73, 0x76, 0x67, 0xff, 0x2f, 0x3e])), false, 'invalid UTF-8');
  });
});

function harness() {
  const created: any[] = [];
  const stored = new Map<string, any>();
  const prisma = {
    assetFile: {
      findFirst: async () => null,
      create: async ({ data }: any) => { const asset = { id: `asset-${created.length + 1}`, ...data }; created.push(asset); stored.set(asset.id, asset); return asset; },
      findUnique: async ({ where }: any) => stored.get(where.id) ?? null,
    },
  } as any;
  const subject = new InfrastructureService(prisma, { record: async () => undefined } as any, {} as any, {} as any);
  (subject as any).log = async () => undefined;
  return { subject, created, stored };
}

describe('asset upload checks the real file type (D2)', () => {
  const directories: string[] = [];
  after(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });
  const withDirectory = async () => { const h = harness(); const directory = await mkdtemp(join(tmpdir(), 'assets-spec-')); directories.push(directory); (h.subject as any).assetDirectory = directory; return { ...h, directory }; };

  test('PDF bytes declared as image/png are rejected with 400 ASSET_NOT_IMAGE and nothing is stored', async () => {
    const h = await withDirectory();
    await assert.rejects(h.subject.createAsset({ filename: 'front.png', mimeType: 'image/png', contentBase64: b64(PDF), kind: 'INFRASTRUCTURE' } as any, user), notImage);
    assert.equal(h.created.length, 0);
    assert.deepEqual(await readdir(h.directory), []);
  });

  test('a malformed SVG declared as image/svg+xml is rejected', async () => {
    const h = await withDirectory();
    await assert.rejects(h.subject.createAsset({ filename: 'front.svg', mimeType: 'image/svg+xml', contentBase64: b64(Buffer.from('<svg><g></svg>')), kind: 'INFRASTRUCTURE' } as any, user), notImage);
  });

  test('a real image is stored with the type read from its bytes, not the declared one', async () => {
    const h = await withDirectory();
    const png = await h.subject.createAsset({ filename: 'front.png', mimeType: 'image/png', contentBase64: b64(PNG), kind: 'INFRASTRUCTURE' } as any, user);
    assert.equal(png.mimeType, 'image/png');
    const jpegNamedPng = await h.subject.createAsset({ filename: 'rear.png', mimeType: 'image/png', contentBase64: `data:image/png;base64,${b64(JPEG)}`, kind: 'INFRASTRUCTURE' } as any, user);
    assert.equal(jpegNamedPng.mimeType, 'image/jpeg');
    assert.equal((await readdir(h.directory)).length, 2);
  });

  test('a face image whose stored bytes are not an image is refused, and a missing file is a 404', async () => {
    const h = harness();
    h.stored.set('fake', { id: 'fake', mimeType: 'image/png', storageKey: 'fake.png' });
    h.stored.set('gone', { id: 'gone', mimeType: 'image/png', storageKey: 'gone.png' });
    h.stored.set('ok', { id: 'ok', mimeType: 'image/svg+xml', storageKey: 'ok.svg' });
    (h.subject as any).readAssetBytes = async (key: string) => { if (key === 'gone.png') throw new Error('ENOENT'); return key === 'fake.png' ? PDF : SVG; };
    await assert.rejects((h.subject as any).assertFaceImage('fake', 'front'), notImage);
    await assert.rejects((h.subject as any).assertFaceImage('gone', 'rear'), NotFoundException);
    await (h.subject as any).assertFaceImage('ok', 'front');
  });

  test('an image that is already attached is not re-read, so old records stay editable', async () => {
    const h = harness();
    h.stored.set('fake', { id: 'fake', mimeType: 'image/png', storageKey: 'fake.png' });
    h.stored.set('pdf', { id: 'pdf', mimeType: 'application/pdf', storageKey: 'x.pdf' });
    let reads = 0;
    (h.subject as any).readAssetBytes = async () => { reads += 1; return PDF; };
    await (h.subject as any).assertFaceImage('fake', 'front', (h.subject as any).prisma, 'fake');
    assert.equal(reads, 0);
    await assert.rejects((h.subject as any).assertFaceImage('fake', 'front', (h.subject as any).prisma, 'other'), notImage);
    assert.equal(reads, 1);
    // The declared type is still checked for attached images.
    await assert.rejects((h.subject as any).assertFaceImage('pdf', 'rear', (h.subject as any).prisma, 'pdf'), notImage);
  });
});

describe('asset file caching (D4)', () => {
  const asset = { id: 'a1', filename: 'front "1".png', mimeType: 'image/png', storageKey: 'a1.png', sizeBytes: PNG.length };
  const service = () => { const h = harness(); h.stored.set('a1', asset); let reads = 0; (h.subject as any).readAssetBytes = async () => { reads += 1; return PNG; }; return { subject: h.subject, get reads() { return reads; } }; };

  test('returns the bytes with a strong ETag, and a matching If-None-Match skips the disk', async () => {
    const s = service();
    const first = await s.subject.assetFile('a1');
    assert.equal(first.notModified, false);
    assert.equal(first.etag, assetEtag(asset));
    assert.deepEqual(first.buffer, PNG);
    for (const header of [first.etag, `W/${first.etag}`, `"other", ${first.etag}`, '*']) {
      const again = await s.subject.assetFile('a1', header);
      assert.equal(again.notModified, true, header);
      assert.equal(again.buffer, null);
    }
    assert.equal(s.reads, 1);
    assert.equal((await s.subject.assetFile('a1', '"stale"')).notModified, false);
  });

  const reply = () => {
    const headers: Record<string, string> = {};
    const r: any = { statusCode: 200, body: undefined as unknown };
    r.header = (name: string, value: string) => { headers[name.toLowerCase()] = value; return r; };
    r.type = (value: string) => r.header('Content-Type', value);
    r.code = (status: number) => { r.statusCode = status; return r; };
    r.send = (body?: unknown) => { r.body = body; return r; };
    r.headers = headers;
    return r;
  };

  test('controller sends long-lived private caching, ETag and the security headers, and 304 with no body', async () => {
    const s = service();
    const controller = new InfrastructureController(s.subject, {} as any, { record: async () => undefined } as any);
    const ok = reply();
    await controller.assetFile('a1', undefined, { user: { id: 'u1' } } as any, ok);
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(ok.body, PNG);
    assert.equal(ok.headers['cache-control'], ASSET_CACHE_CONTROL);
    assert.equal(ASSET_CACHE_CONTROL, 'private, max-age=31536000, immutable');
    assert.equal(ok.headers.etag, assetEtag(asset));
    assert.equal(ok.headers['content-type'], 'image/png');
    assert.equal(ok.headers['x-content-type-options'], 'nosniff');
    assert.match(ok.headers['content-security-policy'], /sandbox/);
    assert.equal(ok.headers['content-disposition'], 'inline; filename="front 1.png"');
    const cached = reply();
    await controller.assetFile('a1', ok.headers.etag, { user: { id: 'u1' } } as any, cached);
    assert.equal(cached.statusCode, 304);
    assert.equal(cached.body, undefined);
    assert.equal(cached.headers.etag, ok.headers.etag);
  });

  test('the asset file route has its own, higher rate limit; other routes keep the global one', () => {
    const handler = (name: string) => (InfrastructureController.prototype as any)[name];
    assert.equal(Reflect.getMetadata('THROTTLER:LIMITdefault', handler('assetFile')), 1200);
    assert.equal(Reflect.getMetadata('THROTTLER:TTLdefault', handler('assetFile')), 60_000);
    assert.equal(Reflect.getMetadata('THROTTLER:LIMITdefault', handler('assets')), undefined);
  });
});
