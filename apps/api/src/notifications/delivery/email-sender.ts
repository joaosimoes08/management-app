import { isIP } from 'node:net';
import { createTransport } from 'nodemailer';
import { DeliveryChannelSender, DeliveryDestination, DeliveryError, DeliveryMessage, SmtpSecurity, SmtpSettings } from './channel';

const TIMEOUT_MS = 10_000;
const MAX_TEXT = 4000;
export const MAX_GROUP_RECIPIENTS = 20;
export const SMTP_SECURITIES: readonly SmtpSecurity[] = ['TLS', 'STARTTLS', 'NONE'];

/** Deliberately strict: one plain address, no display name, no CR/LF, so nothing can be injected into headers. */
const EMAIL_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const HOST_PATTERN = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export function isEmailAddress(value: string) {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

/** Validates and normalises ADMIN SMTP input. Throws DeliveryError with a field-specific code. */
export function validateSmtpSettings(input: { host: string; port: number; security: string; username?: string | null; from: string }, hasPassword: boolean): SmtpSettings {
  const host = input.host.trim();
  if (!(HOST_PATTERN.test(host) || isIP(host))) throw new DeliveryError('SMTP_HOST_INVALID', false);
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

export function emailContent(message: DeliveryMessage) {
  const subject = clip(oneLine(message.title)).slice(0, 250);
  const text = [clip(message.message), message.url ? `Abrir na aplicação: ${message.url}` : null, '— Management-App'].filter(Boolean).join('\n\n');
  const colour = message.severity === 'CRITICAL' ? '#b42318' : message.severity === 'HIGH' ? '#b54708' : '#101828';
  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#101828">`
    + `<p style="font-size:16px;font-weight:600;color:${colour};margin:0 0 12px">${escapeHtml(subject)}</p>`
    + `<p style="white-space:pre-wrap;margin:0 0 12px">${escapeHtml(clip(message.message))}</p>`
    + (message.url ? `<p style="margin:0 0 12px"><a href="${escapeHtml(message.url)}">Abrir na aplicação</a></p>` : '')
    + `<p style="color:#667085;font-size:12px;margin:0">Management-App</p></div>`;
  return { subject, text, html };
}

/** Maps a nodemailer failure to a short code. Never uses the error message or response: they can hold the username or addresses. */
export function smtpFailure(error: unknown) {
  const { code, responseCode, permanent } = (error ?? {}) as { code?: unknown; responseCode?: unknown; permanent?: unknown };
  if (typeof responseCode === 'number' && responseCode >= 200 && responseCode < 600) {
    const isPermanent = typeof permanent === 'boolean' ? permanent : responseCode >= 500 && responseCode !== 503;
    if (code === 'EAUTH') return new DeliveryError(`SMTP_EAUTH_${responseCode}`, false);
    return new DeliveryError(`SMTP_${responseCode}`, !isPermanent);
  }
  switch (code) {
    case 'ECONNECTION': case 'ETIMEDOUT': case 'ESOCKET': case 'EDNS': case 'EPROTOCOL': case 'EMAXLIMIT':
      return new DeliveryError(`SMTP_${code}`, true);
    case 'EAUTH': case 'ENOAUTH': case 'ETLS': case 'EREQUIRETLS': case 'EENVELOPE': case 'ECONFIG':
      return new DeliveryError(`SMTP_${code}`, false);
    default:
      return new DeliveryError('SMTP_ERROR', true);
  }
}

type MailTransport = { sendMail(mail: Record<string, unknown>): Promise<unknown>; close?(): void };
export type TransportFactory = (options: Record<string, unknown>) => MailTransport;

export function transportOptions(smtp: SmtpSettings, password: string | null) {
  return {
    host: smtp.host, port: smtp.port,
    secure: smtp.security === 'TLS', requireTLS: smtp.security === 'STARTTLS', ignoreTLS: smtp.security === 'NONE',
    ...(smtp.username ? { auth: { user: smtp.username, pass: password ?? '' } } : {}),
    // Certificate checks stay on; timeouts keep a stuck server from holding the dispatcher.
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS,
    logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
  };
}

export class EmailSender implements DeliveryChannelSender {
  readonly kind = 'EMAIL' as const;
  constructor(private readonly factory: TransportFactory = (options) => createTransport(options as never) as unknown as MailTransport) {}

  async send(destination: DeliveryDestination, message: DeliveryMessage) {
    if (destination.kind !== 'EMAIL') throw new DeliveryError('CHANNEL_MISMATCH', false);
    if (!destination.to.length) throw new DeliveryError('RECIPIENT_NO_EMAIL', false);
    let transport: MailTransport;
    try { transport = this.factory(transportOptions(destination.smtp, destination.password)); }
    catch { throw new DeliveryError('SMTP_ECONFIG', false); }
    try {
      await transport.sendMail({ from: destination.smtp.from, to: destination.to, ...emailContent(message) });
    } catch (error) {
      throw smtpFailure(error);
    } finally {
      try { transport.close?.(); } catch { /* ignore */ }
    }
  }
}
