/**
 * Step 31 channel layer. A channel turns one queued message into one outbound call. Teams is the only
 * implementation today; an e-mail channel would add an EMAIL DeliveryChannelKind, a sender here, and a
 * per-user address source, with no change to the queue, retry or log.
 */
export type DeliveryMessage = {
  title: string;
  message: string;
  /** Absolute link to the source page, when a public app URL is configured. */
  url?: string | null;
  /** Shown for per-user messages, because a Teams incoming webhook posts to a shared channel. */
  recipientLabel?: string | null;
  severity?: string | null;
};

/** Failure with a short, secret-free code (HTTP_500, TIMEOUT, NETWORK_ERROR, ...). */
export class DeliveryError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) { super(code); this.name = 'DeliveryError'; }
}

export interface DeliveryChannelSender {
  readonly kind: 'TEAMS';
  /** Validates and normalises the destination secret an ADMIN entered. Throws DeliveryError on invalid input. */
  validateDestination(value: string): string;
  /** Sends once. Resolves on success, throws DeliveryError otherwise. Must never put the destination in an error. */
  send(destination: string, message: DeliveryMessage): Promise<void>;
}
