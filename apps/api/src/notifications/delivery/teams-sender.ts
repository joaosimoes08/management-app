import { DeliveryChannelSender, DeliveryDestination, DeliveryError, DeliveryMessage } from './channel';

const TIMEOUT_MS = 10_000;
const MAX_URL_LENGTH = 2048;
const MAX_TEXT = 4000;

/** Hosts Microsoft uses for Teams incoming webhooks (classic connectors) and Workflows (Power Automate) webhooks. */
export function isTeamsWebhookHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'outlook.office.com' || host.endsWith('.webhook.office.com') || host.endsWith('.logic.azure.com') || host.endsWith('.api.powerplatform.com');
}

export function validateTeamsWebhookUrl(value: string) {
  const raw = value.trim();
  let url: URL;
  try { url = new URL(raw); } catch { throw new DeliveryError('TEAMS_WEBHOOK_INVALID', false); }
  if (raw.length > MAX_URL_LENGTH || url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.hash || !isTeamsWebhookHost(url.hostname) || url.pathname === '/') {
    throw new DeliveryError('TEAMS_WEBHOOK_INVALID', false);
  }
  return url.toString();
}

const clip = (value: string) => value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 1)}…` : value;

/** Adaptive Card in the attachments envelope, accepted by both classic incoming webhooks and Workflows webhooks. */
export function teamsPayload(message: DeliveryMessage) {
  const body: unknown[] = [{ type: 'TextBlock', text: clip(message.title), weight: 'Bolder', size: 'Medium', wrap: true, ...(message.severity === 'CRITICAL' ? { color: 'Attention' } : message.severity === 'HIGH' ? { color: 'Warning' } : {}) }];
  if (message.recipientLabel) body.push({ type: 'TextBlock', text: `Para: ${clip(message.recipientLabel)}`, isSubtle: true, spacing: 'None', wrap: true });
  body.push({ type: 'TextBlock', text: clip(message.message), wrap: true });
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body,
        ...(message.url ? { actions: [{ type: 'Action.OpenUrl', title: 'Abrir na aplicação', url: message.url }] } : {}),
      },
    }],
  };
}

export class TeamsSender implements DeliveryChannelSender {
  readonly kind = 'TEAMS' as const;
  constructor(private readonly fetchImpl: () => typeof fetch = () => globalThis.fetch) {}

  async send(destination: DeliveryDestination, message: DeliveryMessage) {
    if (destination.kind !== 'TEAMS') throw new DeliveryError('CHANNEL_MISMATCH', false);
    const url = validateTeamsWebhookUrl(destination.webhookUrl);
    let response: Response;
    try {
      response = await this.fetchImpl()(url, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(teamsPayload(message)),
      });
    } catch (error) {
      // Never surface the error text: undici messages can include the request URL.
      const name = (error as { name?: string } | null)?.name;
      throw new DeliveryError(name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR', true);
    }
    void response.body?.cancel().catch(() => undefined);
    if (response.status >= 200 && response.status < 300) return;
    if (response.status >= 300 && response.status < 400) throw new DeliveryError('REDIRECT_BLOCKED', false);
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    throw new DeliveryError(`HTTP_${response.status}`, retryable);
  }
}
