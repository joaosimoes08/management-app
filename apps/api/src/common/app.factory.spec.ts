import { Controller, Module, Put } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { configureApp } from '../app.factory';

@Controller({ path: 'cors-test', version: '1' })
class CorsTestController {
  @Put()
  update() {
    return { ok: true };
  }
}

@Module({ controllers: [CorsTestController] })
class CorsTestModule {}

describe('configureApp CORS', () => {
  let app: NestFastifyApplication;

  before(async () => {
    const testingModule = await Test.createTestingModule({ imports: [CorsTestModule] }).compile();
    app = testingModule.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await configureApp(app, { swagger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  after(async () => {
    await app.close();
  });

  it('allows PUT requests in browser preflight checks', async () => {
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/cors-test',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'PUT',
      },
    });

    assert.equal(response.statusCode, 204);
    assert.match(response.headers['access-control-allow-methods'] ?? '', /(?:^|,\s*)PUT(?:,|$)/);
  });
});
