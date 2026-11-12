import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRealm, validateDeployment, writeRealmFile } from './configure-install.mjs';

const templatePath = new URL('./realm-cociber.json', import.meta.url);

test('creates a realm with matching organization, client credentials, and public callback URLs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'management-deploy-'));
  const realmPath = path.join(root, 'realm-simoneda.json');
  const created = writeRealmFile({ templatePath, realmPath, organization: 'SIMONEDA', locale: 'pt-PT', clientSecret: 'fresh-client-secret', publicBaseUrl: 'https://login.example.test/' });
  const realm = JSON.parse(fs.readFileSync(realmPath, 'utf8'));
  const webClient = realm.clients.find((client) => client.clientId === 'simoes-web');
  const adminClient = realm.clients.find((client) => client.clientId === 'simoes-settings-admin');

  assert.equal(created, true);
  assert.equal(realm.realm, 'SIMONEDA');
  assert.equal(realm.displayName, 'SIMONEDA');
  assert.equal(webClient.redirectUris[0], 'https://login.example.test/*');
  assert.equal(webClient.webOrigins[0], 'https://login.example.test');
  assert.equal(adminClient.secret, 'fresh-client-secret');
  assert.equal(fs.statSync(realmPath).mode & 0o777, 0o600);
  fs.rmSync(root, { recursive: true, force: true });
});

test('preserves an existing realm file and refuses to replace it with a different realm', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'management-deploy-'));
  const realmPath = path.join(root, 'realm.json');
  const existing = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  fs.writeFileSync(realmPath, JSON.stringify(existing));

  assert.equal(writeRealmFile({ templatePath, realmPath, organization: 'COCiber', locale: 'pt-PT', clientSecret: 'secret', publicBaseUrl: 'http://localhost:8080' }), false);
  assert.throws(() => writeRealmFile({ templatePath, realmPath, organization: 'SIMONEDA', locale: 'pt-PT', clientSecret: 'secret', publicBaseUrl: 'http://localhost:8080' }), /Refusing to overwrite realm file/);
  assert.equal(JSON.parse(fs.readFileSync(realmPath, 'utf8')).realm, 'COCiber');
  fs.rmSync(root, { recursive: true, force: true });
});

test('validates realm names and supported startup locales', () => {
  assert.doesNotThrow(() => validateDeployment('SIMONEDA-PT_2', 'en-US'));
  assert.throws(() => validateDeployment('company with spaces', 'pt-PT'), /Organization\/realm/);
  assert.throws(() => validateDeployment('SIMONEDA', 'fr-FR'), /Locale/);
});

test('realm generation preserves source clients and leaves the template unchanged', () => {
  const source = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const customized = createRealm(source, { organization: 'SIMONEDA', clientSecret: 'secret', publicBaseUrl: 'http://localhost:8080' });
  assert.equal(customized.clients.length, source.clients.length);
  assert.equal(customized.clients.find((client) => client.clientId === 'simoes-web').clientId, 'simoes-web');
  assert.equal(source.realm, 'COCiber');
});
