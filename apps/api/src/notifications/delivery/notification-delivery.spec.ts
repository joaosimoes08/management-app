import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DeliveryError } from './channel';
import { DEFAULT_POLL_MS, failureOutcome, MAX_ATTEMPTS, pollIntervalMs, publicLink, RETRY_BACKOFF_MS } from './notification-delivery.service';
import { teamsPayload, TeamsSender, validateTeamsWebhookUrl } from './teams-sender';

const SECRET_URL = 'https://contoso.webhook.office.com/webhookb2/secret-token-123/IncomingWebhook/abc/def';

test('accepts only HTTPS Microsoft Teams webhook hosts', () => {
  assert.equal(validateTeamsWebhookUrl(` ${SECRET_URL} `), SECRET_URL);
  assert.ok(validateTeamsWebhookUrl('https://prod-12.westeurope.logic.azure.com:443/workflows/abc/triggers/manual/paths/invoke?api-version=2016-06-01&sig=x'));
  assert.ok(validateTeamsWebhookUrl('https://default123.environment.api.powerplatform.com/powerautomate/automations/direct/workflows/abc/triggers/manual/paths/invoke?sig=x'));
  for (const bad of [
    'http://contoso.webhook.office.com/webhookb2/x', 'https://evil.example.com/webhookb2/x', 'https://webhook.office.com.evil.com/x',
    'https://user:pass@contoso.webhook.office.com/x', 'https://contoso.webhook.office.com:8443/x', 'https://contoso.webhook.office.com/',
    'not a url', `https://contoso.webhook.office.com/${'a'.repeat(2100)}`,
  ]) assert.throws(() => validateTeamsWebhookUrl(bad), (error: unknown) => error instanceof DeliveryError && error.code === 'TEAMS_WEBHOOK_INVALID' && !error.message.includes('evil'));
});

test('builds an Adaptive Card with recipient, severity colour and an optional link', () => {
  const payload = teamsPayload({ title: '[CRITICAL] Core down', message: 'Site A · link lost', url: 'https://mgmt.example/alertas?alertId=1', recipientLabel: null, severity: 'CRITICAL' }) as any;
  const card = payload.attachments[0].content;
  assert.equal(payload.attachments[0].contentType, 'application/vnd.microsoft.card.adaptive');
  assert.equal(card.body[0].color, 'Attention');
  assert.equal(card.actions[0].url, 'https://mgmt.example/alertas?alertId=1');
  const personal = teamsPayload({ title: 'T', message: 'M', recipientLabel: 'Ana (ana)' }) as any;
  assert.equal(personal.attachments[0].content.body[1].text, 'Para: Ana (ana)');
  assert.equal(personal.attachments[0].content.actions, undefined);
});

test('maps webhook failures to secret-free codes and marks which ones retry', async () => {
  const sender = (impl: typeof fetch) => new TeamsSender(() => impl);
  const respond = (status: number) => (async () => new Response('x', { status })) as unknown as typeof fetch;
  await sender(respond(200)).send(SECRET_URL, { title: 't', message: 'm' });
  await sender(respond(202)).send(SECRET_URL, { title: 't', message: 'm' });
  const failure = async (impl: typeof fetch) => {
    try { await sender(impl).send(SECRET_URL, { title: 't', message: 'm' }); } catch (error) { return error as DeliveryError; }
    throw new Error('expected failure');
  };
  assert.deepEqual(await failure(respond(500)).then((e) => [e.code, e.retryable]), ['HTTP_500', true]);
  assert.deepEqual(await failure(respond(429)).then((e) => [e.code, e.retryable]), ['HTTP_429', true]);
  assert.deepEqual(await failure(respond(404)).then((e) => [e.code, e.retryable]), ['HTTP_404', false]);
  assert.deepEqual(await failure(respond(302)).then((e) => [e.code, e.retryable]), ['REDIRECT_BLOCKED', false]);
  const leaky = await failure((async () => { throw new TypeError(`fetch failed for ${SECRET_URL}`); }) as unknown as typeof fetch);
  assert.deepEqual([leaky.code, leaky.retryable], ['NETWORK_ERROR', true]);
  assert.ok(!leaky.message.includes('secret-token-123') && !String(leaky.stack).includes('secret-token-123'));
  const timeout = await failure((async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); }) as unknown as typeof fetch);
  assert.equal(timeout.code, 'TIMEOUT');
});

test('sends without following redirects and with a timeout', async () => {
  let init: RequestInit | undefined;
  await new TeamsSender(() => (async (_url: string, options: RequestInit) => { init = options; return new Response('1', { status: 200 }); }) as unknown as typeof fetch).send(SECRET_URL, { title: 't', message: 'm' });
  assert.equal(init?.redirect, 'manual');
  assert.ok(init?.signal);
  assert.equal(JSON.parse(String(init?.body)).type, 'message');
});

test('retries with backoff and stops after the last attempt or a permanent failure', () => {
  const now = new Date('2026-11-21T10:00:00Z');
  const first = failureOutcome(1, true, now);
  assert.equal(first.status, 'PENDING');
  assert.equal(first.nextAttemptAt.getTime() - now.getTime(), RETRY_BACKOFF_MS[0]);
  assert.equal(failureOutcome(MAX_ATTEMPTS - 1, true, now).nextAttemptAt.getTime() - now.getTime(), RETRY_BACKOFF_MS[MAX_ATTEMPTS - 2]);
  assert.equal(failureOutcome(MAX_ATTEMPTS, true, now).status, 'FAILED');
  assert.equal(failureOutcome(1, false, now).status, 'FAILED');
});

test('polls well inside one minute so a CRITICAL alert cannot wait longer', () => {
  assert.equal(pollIntervalMs(undefined), DEFAULT_POLL_MS);
  assert.ok(DEFAULT_POLL_MS + 10_000 < 60_000, 'poll interval plus one send timeout must stay under 1 minute');
  assert.equal(pollIntervalMs('5000'), 5000);
  assert.equal(pollIntervalMs('600000'), DEFAULT_POLL_MS);
  assert.equal(pollIntervalMs('abc'), DEFAULT_POLL_MS);
});

test('builds links only from relative app paths and a configured public URL', () => {
  assert.equal(publicLink('/alertas?alertId=1', 'https://mgmt.example'), 'https://mgmt.example/alertas?alertId=1');
  assert.equal(publicLink('/alertas', undefined), null);
  assert.equal(publicLink('//evil.example/x', 'https://mgmt.example'), null);
  assert.equal(publicLink('https://evil.example', 'https://mgmt.example'), null);
  assert.equal(publicLink('/x', 'javascript:alert(1)'), null);
});
