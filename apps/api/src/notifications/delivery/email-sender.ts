import { lookup } from 'node:dns/promises';
import { BlockList, isIP, isIPv6 } from 'node:net';
import { createTransport } from 'nodemailer';
import { DeliveryChannelSender, DeliveryDestination, DeliveryError, DeliveryMessage, SmtpSecurity, SmtpSettings } from './channel';

const TIMEOUT_MS = 10_000;
const MAX_TEXT = 4000;
export const MAX_GROUP_RECIPIENTS = 20;
export const SMTP_SECURITIES: readonly SmtpSecurity[] = ['TLS', 'STARTTLS', 'NONE'];

/** Deliberately strict: one plain address, no display name, no CR/LF, so nothing can be injected into headers. */
const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const HOST_PATTERN = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

/**
 * Addresses the SMTP host may never be: loopback, link-local (incl. the 169.254.169.254 metadata service) and
 * unspecified, also in IPv4-mapped IPv6 form. Private RFC 1918 ranges stay allowed: on-prem relays are normal.
 */
const BLOCKED = new BlockList();
BLOCKED.addSubnet('127.0.0.0', 8); BLOCKED.addSubnet('0.0.0.0', 8); BLOCKED.addSubnet('169.254.0.0', 16);
BLOCKED.addAddress('::', 'ipv6'); BLOCKED.addAddress('::1', 'ipv6'); BLOCKED.addSubnet('fe80::', 10, 'ipv6');

export function isBlockedAddress(address: string) {
  const family = isIP(address);
  return !family || BLOCKED.check(address, isIPv6(address) ? 'ipv6' : 'ipv4');
}

const isLocalName = (host: string) => host === 'localhost' || host.endsWith('.localhost') || host === 'localhost.localdomain';

export function isEmailAddress(value: string) {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

/** Validates and normalises ADMIN SMTP input. Throws DeliveryError with a field-specific code. */
export function validateSmtpSettings(input: { host: string; port: number; security: string; username?: string | null; from: string }, hasPassword: boolean): SmtpSettings {
  const host = input.host.trim();
  if (!(HOST_PATTERN.test(host) || isIP(host))) throw new DeliveryError('SMTP_HOST_INVALID', false);
  if ((isIP(host) && isBlockedAddress(host)) || isLocalName(host.toLowerCase())) throw new DeliveryError('SMTP_HOST_NOT_ALLOWED', false);
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) throw new DeliveryError('SMTP_PORT_INVALID', false);
  if (!(SMTP_SECURITIES as readonly string[]).includes(input.security)) throw new DeliveryError('SMTP_SECURITY_INVALID', false);
  const username = input.username?.trim() || null;
  if (username && (username.length > 254 || /[\r\n]/.test(username))) throw new DeliveryError('SMTP_USERNAME_INVALID', false);
  // Never send credentials over an unencrypted connection.
  if ((username || hasPassword) && input.security === 'NONE') throw new DeliveryError('SMTP_AUTH_NEEDS_TLS', false);
  const from = input.from.trim();
  if (!isEmailAddress(from)) throw new DeliveryError('SMTP_FROM_INVALID', false);
  return { host: host.toLowerCase(), port: input.port, security: input.security as SmtpSecurity, username, from };
}

export function normaliseRecipients(values: string[]) {
  const recipients = [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (!recipients.length || recipients.length > MAX_GROUP_RECIPIENTS || !recipients.every(isEmailAddress)) throw new DeliveryError('EMAIL_RECIPIENTS_INVALID', false);
  return recipients;
}

const clip = (value: string) => value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value;
const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

/** Upper bound for a prepared body (reports); the short layout keeps its 4000-character clip. */
const MAX_BODY = 500_000;
const safeFilename = (value: string) => value.replace(/[\r\n"\\/]+/g, '').slice(0, 120) || 'anexo';

/** Attachments and List-Unsubscribe header for nodemailer. Content is always an in-memory string. */
export function emailExtras(message: DeliveryMessage) {
  const attachments = (message.attachments ?? []).map((item) => ({ filename: safeFilename(item.filename), content: item.content, contentType: item.contentType }));
  const unsubscribe = message.unsubscribeUrl && /^https?:\/\/[^\s<>]+$/.test(message.unsubscribeUrl) ? message.unsubscribeUrl : null;
  return { ...(attachments.length ? { attachments } : {}), ...(unsubscribe ? { headers: { 'List-Unsubscribe': `<${unsubscribe}>` } } : {}) };
}

export function emailContent(message: DeliveryMessage) {
  const subject = clip(oneLine(message.title)).slice(0, 250);
  if (message.body) return { subject, text: message.body.text.slice(0, MAX_BODY), html: message.body.html.slice(0, MAX_BODY) };
  const text = [clip(message.message), message.url ? `Abrir na aplicação: ${message.url}` : null, '— Management-App'].filter(Boolean).join('\n\n');
  const colour = message.severity === 'CRITICAL' ? '#b42318' : message.severity === 'HIGH' ? '#b54708' : '#101828';
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#101828">`
    + `<p style="font-size:16px;font-weight:600;color:${colour};margin:0 0 12px">${escapeHtml(subject)}</p>`
    + `<p style="white-space:pre-wrap;margin:0 0 12px">${escapeHtml(clip(message.message))}</p>`
    + (message.url ? `<p style="margin:0 0 12px"><a href="${escapeHtml(message.url)}">Abrir na aplicação</a></p>` : '')
    + `<p style="color:#667085;font-size:12px;margin:0">Management-App</p></div>`;
  return { subject, text, html };
}

/**
 * Maps a nodemailer failure to a short code. Never uses the error message or response: they can hold the username
 * or addresses. Every failure before an SMTP reply (refused, timed out, reset, TLS, not SMTP) is one generic code, so
 * the test button cannot tell a closed port from a filtered one or a non-SMTP service: it is no port scanner.
 */
export function smtpFailure(error: unknown) {
  const { code, responseCode, permanent } = (error ?? {}) as { code?: unknown; responseCode?: unknown; permanent?: unknown };
  if (typeof responseCode === 'number' && responseCode >= 200 && responseCode < 600) {
    const isPermanent = typeof permanent === 'boolean' ? permanent : responseCode >= 500 && responseCode !== 503;
    if (code === 'EAUTH') return new DeliveryError(`SMTP_EAUTH_${responseCode}`, false);
    return new DeliveryError(`SMTP_${responseCode}`, !isPermanent);
  }
  switch (code) {
    case 'ECONNECTION': case 'ETIMEDOUT': case 'ESOCKET': case 'EDNS': case 'EPROTOCOL': case 'EMAXLIMIT':
      return new DeliveryError('SMTP_CONNECTION_FAILED', true);
    case 'ETLS': case 'EREQUIRETLS':
      return new DeliveryError('SMTP_CONNECTION_FAILED', false);
    case 'EAUTH': case 'ENOAUTH': case 'EENVELOPE': case 'ECONFIG':
      return new DeliveryError(`SMTP_${code}`, false);
    default:
      return new DeliveryError('SMTP_ERROR', true);
  }
}

type MailTransport = { sendMail(mail: Record<string, unknown>): Promise<unknown>; close?(): void };
export type TransportFactory = (options: Record<string, unknown>) => MailTransport;
/** Resolves a host name to every address it has. */
export type HostResolver = (host: string) => Promise<string[]>;
const systemResolver: HostResolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);

/**
 * Resolves the SMTP host and checks every address against the block list. The connection then goes to the checked
 * address (TLS still verifies the certificate against the host name), so DNS cannot change it between check and use.
 */
export async function resolveSmtpHost(host: string, resolver: HostResolver = systemResolver) {
  if (isIP(host)) { if (isBlockedAddress(host)) throw new DeliveryError('SMTP_HOST_NOT_ALLOWED', false); return host; }
  if (isLocalName(host)) throw new DeliveryError('SMTP_HOST_NOT_ALLOWED', false);
  let addresses: string[];
  try { addresses = await resolver(host); }
  catch { throw new DeliveryError('SMTP_CONNECTION_FAILED', true); }
  if (!addresses.length) throw new DeliveryError('SMTP_CONNECTION_FAILED', true);
  if (addresses.some(isBlockedAddress)) throw new DeliveryError('SMTP_HOST_NOT_ALLOWED', false);
  return addresses[0];
}

export function transportOptions(smtp: SmtpSettings, password: string | null, address: string = smtp.host) {
  return {
    host: address, port: smtp.port, ...(address !== smtp.host ? { servername: smtp.host } : {}),
    secure: smtp.security === 'TLS', requireTLS: smtp.security === 'STARTTLS', ignoreTLS: smtp.security === 'NONE',
    ...(smtp.username ? { auth: { user: smtp.username, pass: password ?? '' } } : {}),
    // Certificate checks stay on; timeouts keep a stuck server from holding the dispatcher.
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(address !== smtp.host ? { servername: smtp.host } : {}) },
    connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  };
}

export class EmailSender implements DeliveryChannelSender {
  readonly kind = 'EMAIL' as const;
  constructor(
    private readonly factory: TransportFactory = (options) => createTransport(options as never) as unknown as MailTransport,
    private readonly resolver: HostResolver = systemResolver,
  ) {}

  async send(destination: DeliveryDestination, message: DeliveryMessage) {
    if (destination.kind !== 'EMAIL') throw new DeliveryError('CHANNEL_MISMATCH', false);
    if (!destination.to.length) throw new DeliveryError('RECIPIENT_NO_EMAIL', false);
    const address = await resolveSmtpHost(destination.smtp.host, this.resolver);
    let transport: MailTransport;
    try { transport = this.factory(transportOptions(destination.smtp, destination.password, address)); }
    catch { throw new DeliveryError('SMTP_ECONFIG', false); }
    try {
      const recipients = destination.bcc ? { to: destination.smtp.from, bcc: destination.to } : { to: destination.to };
      await transport.sendMail({ from: destination.smtp.from, ...recipients, ...emailContent(message), ...emailExtras(message) });
    } catch (error) {
      throw smtpFailure(error);
    } finally {
      try { transport.close?.(); } catch { /* ignore */ }
    }
  }
}
