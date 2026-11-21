/**
 * Step 31 channel layer. A channel turns one queued message into one outbound call. Microsoft Teams (incoming
 * webhook) and Email (SMTP) are implemented; another channel adds a DeliveryChannelKind, a sender here and a
 * destination shape, with no change to the queue, retry or log.
 */
export type DeliveryMessage = {
  title: string;
  message: string;
  /** Absolute link to the source page, when a public app URL is configured. */
  url?: string | null;
  /** Shown for per-user messages posted to a shared Teams channel. E-mail goes to the person, so it is not needed there. */
  recipientLabel?: string | null;
  severity?: string | null;
  /** E-mail only: a full prepared body (Step 32 reports) used instead of the short title/message layout. */
  body?: { text: string; html: string } | null;
  /** E-mail only: files sent as attachments (in memory; never read from disk or a URL). */
  attachments?: DeliveryAttachment[];
  /** E-mail only: one-click unsubscribe page, sent as the List-Unsubscribe header. */
  unsubscribeUrl?: string | null;
};

export type DeliveryAttachment = { filename: string; content: string; contentType: string };

export type SmtpSecurity = 'TLS' | 'STARTTLS' | 'NONE';

/** Non-secret SMTP server settings. The password is held apart, only in the keyring envelope. */
export type SmtpSettings = { host: string; port: number; security: SmtpSecurity; username: string | null; from: string };

/** Decrypted, resolved destination for one send. Built by the service at send time; never logged or returned. */
export type DeliveryDestination =
  | { kind: 'TEAMS'; webhookUrl: string }
  /** `bcc`: group alerts go To the sender address with the list in Bcc, so recipients never see each other. */
  | { kind: 'EMAIL'; smtp: SmtpSettings; password: string | null; to: string[]; bcc?: boolean };

/** Failure with a short, secret-free code (HTTP_500, TIMEOUT, SMTP_EAUTH, ...). */
export class DeliveryError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) { super(code); this.name = 'DeliveryError'; }
}

export interface DeliveryChannelSender {
  readonly kind: DeliveryDestination['kind'];
  /** Sends once. Resolves on success, throws DeliveryError otherwise. Must never put a secret or an address in an error. */
  send(destination: DeliveryDestination, message: DeliveryMessage): Promise<void>;
}
