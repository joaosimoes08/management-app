import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DeliveryError } from './channel';
import { DEFAULT_POLL_MS, failureOutcome, MAX_ATTEMPTS, pollIntervalMs, publicLink, RETRY_BACKOFF_MS } from './notification-delivery.service';
import { teamsPayload, TeamsSender, validateTeamsWebhookUrl } from './teams-sender';
import { createTransport } from 'nodemailer';
import { emailContent, EmailSender, normaliseRecipients, smtpFailure, transportOptions, validateSmtpSettings } from './email-sender';

const SECRET_URL = 'https://contoso.webhook.office.com/webhookb2/secret-token-123/IncomingWebhook/abc/def';
const TEAMS = { kind: 'TEAMS' as const, webhookUrl: SECRET_URL };

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
  await sender(respond(200)).send(TEAMS, { title: 't', message: 'm' });
  await sender(respond(202)).send(TEAMS, { title: 't', message: 'm' });
  const failure = async (impl: typeof fetch) => {
    try { await sender(impl).send(TEAMS, { title: 't', message: 'm' }); } catch (error) { return error as DeliveryError; }
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
  await new TeamsSender(() => (async (_url: string, options: RequestInit) => { init = options; return new Response('1', { status: 200 }); }) as unknown as typeof fetch).send(TEAMS, { title: 't', message: 'm' });
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

// ----- Email (SMTP) channel -----

const SMTP = { host: 'smtp.example.pt', port: 587, security: 'STARTTLS' as const, username: 'alerts@example.pt', from: 'alerts@example.pt' };
const SMTP_PASSWORD = 'smtp-pass-S3cr3t!';
const EMAIL = { kind: 'EMAIL' as const, smtp: SMTP, password: SMTP_PASSWORD, to: ['ana@example.pt'] };

test('validates SMTP settings and refuses credentials without TLS', () => {
  assert.deepEqual(validateSmtpSettings({ ...SMTP, host: ' SMTP.Example.pt ' }, true), { ...SMTP, host: 'smtp.example.pt' });
  assert.equal(validateSmtpSettings({ ...SMTP, host: '10.0.0.25', username: '', security: 'NONE', port: 25 }, false).username, null);
  const code = (fn: () => unknown) => { try { fn(); } catch (error) { return (error as DeliveryError).code; } return 'OK'; };
  assert.equal(code(() => validateSmtpSettings({ ...SMTP, security: 'NONE' }, true)), 'SMTP_AUTH_NEEDS_TLS');
  assert.equal(code(() => validateSmtpSettings({ ...SMTP, host: 'smtp://x' }, true)), 'SMTP_HOST_INVALID');
  assert.equal(code(() => validateSmtpSettings({ ...SMTP, port: 70000 }, true)), 'SMTP_PORT_INVALID');
  assert.equal(code(() => validateSmtpSettings({ ...SMTP, security: 'SSL' }, true)), 'SMTP_SECURITY_INVALID');
  assert.equal(code(() => validateSmtpSettings({ ...SMTP, from: 'a@b.pt\r\nBcc: x@evil.com' }, true)), 'SMTP_FROM_INVALID');
  assert.equal(code(() => validateSmtpSettings({ ...SMTP, from: 'Ops <ops@b.pt>' }, true)), 'SMTP_FROM_INVALID');
  assert.deepEqual(normaliseRecipients([' Ops@Example.pt ', 'ops@example.pt', 'noc@example.pt']), ['ops@example.pt', 'noc@example.pt']);
  assert.throws(() => normaliseRecipients([]));
  assert.throws(() => normaliseRecipients(['not-an-address']));
});

test('builds a plain and HTML e-mail with an escaped body, one-line subject and optional link', () => {
  const content = emailContent({ title: '[CRITICAL] Core\r\nBcc: x@evil.com', message: '<script>alert(1)</script>', url: 'https://mgmt.example/alertas?a=1&b=2', severity: 'CRITICAL' });
  assert.equal(content.subject, '[CRITICAL] Core Bcc: x@evil.com');
  assert.ok(!/[\r\n]/.test(content.subject));
  assert.ok(content.html.includes('&lt;script&gt;') && !content.html.includes('<script>'));
  assert.ok(content.html.includes('href="https://mgmt.example/alertas?a=1&amp;b=2"'));
  assert.ok(content.text.includes('Abrir na aplicação: https://mgmt.example/alertas?a=1&b=2'));
  assert.ok(!emailContent({ title: 't', message: 'm' }).text.includes('Abrir'));
});

test('maps SMTP failures to secret-free codes and marks which ones retry', () => {
  const leak = `535 Authentication failed for ${SMTP.username} with ${SMTP_PASSWORD}`;
  const cases: [Record<string, unknown>, string, boolean][] = [
    [{ code: 'EAUTH', responseCode: 535, response: leak }, 'SMTP_EAUTH_535', false],
    [{ code: 'EAUTH' }, 'SMTP_EAUTH', false],
    [{ code: 'ECONNECTION' }, 'SMTP_ECONNECTION', true],
    [{ code: 'ETIMEDOUT' }, 'SMTP_ETIMEDOUT', true],
    [{ code: 'ETLS' }, 'SMTP_ETLS', false],
    [{ code: 'EENVELOPE', responseCode: 550, permanent: true }, 'SMTP_550', false],
    [{ code: 'EENVELOPE', responseCode: 451, permanent: false }, 'SMTP_451', true],
    [{ code: 'EMESSAGE', responseCode: 503 }, 'SMTP_503', true],
    [{}, 'SMTP_ERROR', true],
  ];
  for (const [error, code, retryable] of cases) {
    const failure = smtpFailure(Object.assign(new Error(leak), error));
    assert.deepEqual([failure.code, failure.retryable], [code, retryable]);
    assert.ok(!failure.message.includes(SMTP_PASSWORD) && !String(failure.stack).includes(SMTP_PASSWORD) && !failure.message.includes(SMTP.username));
  }
});

test('sends through nodemailer with TLS checks, timeouts and auth, and closes the transport', async () => {
  let options: any; let mail: any; let closed = false;
  await new EmailSender((value) => { options = value; return { sendMail: async (m) => { mail = m; return {}; }, close: () => { closed = true; } }; }).send(EMAIL, { title: 'T', message: 'M' });
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
  assert.deepEqual(options.auth, { user: SMTP.username, pass: SMTP_PASSWORD });
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.ok(options.connectionTimeout <= 10_000 && options.socketTimeout <= 10_000);
  assert.equal(options.logger, false);
  assert.deepEqual([mail.from, mail.to, mail.subject], [SMTP.from, ['ana@example.pt'], 'T']);
  assert.ok(closed);
  assert.equal(transportOptions({ ...SMTP, security: 'TLS', port: 465 }, null).secure, true);
  assert.equal('auth' in transportOptions({ ...SMTP, username: null, security: 'NONE' }, null), false);
});

test('renders a real message with nodemailer (JSON transport) without the password in it', async () => {
  let rendered = '';
  await new EmailSender(() => {
    const transport = createTransport({ jsonTransport: true });
    return { sendMail: async (m) => { rendered = String(((await transport.sendMail(m as never)) as { message: string }).message); return {}; } };
  }).send(EMAIL, { title: '[HIGH] Uplink', message: 'Site A', severity: 'HIGH' });
  const parsed = JSON.parse(rendered);
  assert.equal(parsed.subject, '[HIGH] Uplink');
  assert.deepEqual(parsed.to.map((a: { address: string }) => a.address), ['ana@example.pt']);
  assert.ok(!rendered.includes(SMTP_PASSWORD));
});

test('e-mail failures from the transport keep only the code', async () => {
  const sender = new EmailSender(() => ({ sendMail: async () => { throw Object.assign(new Error(`Invalid login: ${SMTP_PASSWORD}`), { code: 'EAUTH', responseCode: 535 }); } }));
  await assert.rejects(sender.send(EMAIL, { title: 't', message: 'm' }), (error: unknown) => error instanceof DeliveryError && error.code === 'SMTP_EAUTH_535' && !error.retryable && !String(error.stack).includes(SMTP_PASSWORD));
  await assert.rejects(new EmailSender(() => ({ sendMail: async () => ({}) })).send({ ...EMAIL, to: [] }, { title: 't', message: 'm' }), (error: unknown) => (error as DeliveryError).code === 'RECIPIENT_NO_EMAIL');
  await assert.rejects(new EmailSender().send(TEAMS, { title: 't', message: 'm' }), (error: unknown) => (error as DeliveryError).code === 'CHANNEL_MISMATCH');
});
