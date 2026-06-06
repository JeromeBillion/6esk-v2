import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  WhatsAppConfig,
  WhatsAppSendTextRequest,
  WhatsAppSendTemplateRequest,
  WhatsAppSession,
} from './types';

const GRAPH_API_VERSION = 'v21.0';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1_000, 3_000, 10_000];

export class WhatsAppService extends Service {
  static serviceType = 'whatsapp';
  capabilityDescription = 'WhatsApp Business messaging via Meta Cloud API';

  private waConfig!: WhatsAppConfig;
  private sessions: Map<string, WhatsAppSession> = new Map();

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new WhatsAppService(runtime);
    service.waConfig = {
      phoneNumberId: (runtime.getSetting('WHATSAPP_PHONE_NUMBER_ID') as string) || '',
      accessToken: (runtime.getSetting('WHATSAPP_ACCESS_TOKEN') as string) || '',
      verifyToken: (runtime.getSetting('WHATSAPP_VERIFY_TOKEN') as string) || '',
      appSecret: (runtime.getSetting('WHATSAPP_APP_SECRET') as string) || '',
      graphApiVersion:
        (runtime.getSetting('WHATSAPP_GRAPH_API_VERSION') as string) || GRAPH_API_VERSION,
    };

    if (!service.waConfig.phoneNumberId || !service.waConfig.accessToken) {
      logger.warn(
        { src: 'plugin:whatsapp' },
        'WhatsApp credentials not configured, service inactive'
      );
    } else {
      logger.info(
        { src: 'plugin:whatsapp', phoneNumberId: service.waConfig.phoneNumberId },
        'WhatsApp service started'
      );
    }

    return service;
  }

  async stop(): Promise<void> {
    this.sessions.clear();
  }

  /**
   * Verify the X-Hub-Signature-256 header from Meta webhook delivery.
   * Meta signs with HMAC-SHA256 using the app secret.
   */
  verifyWebhookSignature(signature: string, rawBody: string): boolean {
    if (!this.waConfig.appSecret) return false;

    const expected = createHmac('sha256', this.waConfig.appSecret).update(rawBody).digest('hex');
    const expectedSig = `sha256=${expected}`;

    if (signature.length !== expectedSig.length) return false;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
  }

  /** Verify token for webhook subscription (GET request from Meta) */
  getVerifyToken(): string {
    return this.waConfig.verifyToken;
  }

  /** Send a text message via WhatsApp Cloud API with retry */
  async sendTextMessage(request: WhatsAppSendTextRequest): Promise<{ messageId: string }> {
    const url = `https://graph.facebook.com/${this.waConfig.graphApiVersion}/${this.waConfig.phoneNumberId}/messages`;

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: request.to,
      type: 'text',
      text: {
        preview_url: request.previewUrl ?? false,
        body: request.text,
      },
    };

    const result = await this.sendWithRetry(url, body);
    return { messageId: result.messages?.[0]?.id ?? '' };
  }

  /** Send a template message via WhatsApp Cloud API with retry */
  async sendTemplateMessage(request: WhatsAppSendTemplateRequest): Promise<{ messageId: string }> {
    const url = `https://graph.facebook.com/${this.waConfig.graphApiVersion}/${this.waConfig.phoneNumberId}/messages`;

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: request.to,
      type: 'template',
      template: {
        name: request.templateName,
        language: { code: request.languageCode },
        ...(request.components ? { components: request.components } : {}),
      },
    };

    const result = await this.sendWithRetry(url, body);
    return { messageId: result.messages?.[0]?.id ?? '' };
  }

  /** Mark a message as read */
  async markAsRead(messageId: string): Promise<void> {
    const url = `https://graph.facebook.com/${this.waConfig.graphApiVersion}/${this.waConfig.phoneNumberId}/messages`;

    await this.sendWithRetry(url, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  }

  /** Send request with exponential backoff retry */
  private async sendWithRetry(url: string, body: unknown, attempt = 0): Promise<any> {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.waConfig.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      return response.json();
    }

    const errorText = await response.text();

    // Don't retry client errors (4xx) except rate limits (429)
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new Error(`WhatsApp API error ${response.status}: ${errorText}`);
    }

    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt] ?? 10_000;
      logger.warn(
        { src: 'plugin:whatsapp', attempt: attempt + 1, status: response.status },
        `Retrying WhatsApp API call in ${delay}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.sendWithRetry(url, body, attempt + 1);
    }

    throw new Error(
      `WhatsApp API failed after ${MAX_RETRIES} retries: ${response.status} - ${errorText}`
    );
  }

  /** Get or create a session for a phone number */
  getSession(phoneNumber: string): WhatsAppSession | undefined {
    return this.sessions.get(phoneNumber);
  }

  /** Store/update a session */
  setSession(session: WhatsAppSession): void {
    this.sessions.set(session.phoneNumber, session);
  }

  get isConfigured(): boolean {
    return !!(
      this.waConfig.phoneNumberId &&
      this.waConfig.accessToken &&
      this.waConfig.verifyToken &&
      this.waConfig.appSecret
    );
  }
}
