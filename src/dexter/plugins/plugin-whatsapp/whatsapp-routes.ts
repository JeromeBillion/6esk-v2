import { type Route, type IAgentRuntime, logger, createUniqueUuid } from '@elizaos/core';
import { WhatsAppService } from './whatsapp-service';
import type { WhatsAppWebhookPayload, WhatsAppInboundMessage, WhatsAppContact } from './types';
import { normalizeRouteBody, respondInvalidRequest } from '../../utils/request-validation';
import { redactSensitiveLogContext } from '../../utils/redaction';

/**
 * GET /webhooks/whatsapp — Meta webhook verification.
 * Meta sends a GET with hub.mode, hub.verify_token, hub.challenge.
 */
export const whatsappVerifyRoute: Route = {
  type: 'GET',
  path: '/webhooks/whatsapp',

  handler: async (req, res, runtime: IAgentRuntime): Promise<void> => {
    const service = runtime.getService('whatsapp') as WhatsAppService | null;
    if (!service || !service.isConfigured) {
      res.status(503).json({ error: 'WhatsApp integration not configured' });
      return;
    }

    const query = req.query as Record<string, unknown>;
    const mode = query?.['hub.mode'] as string | undefined;
    const token = query?.['hub.verify_token'] as string | undefined;
    const challenge = query?.['hub.challenge'] as string | undefined;

    if (mode === 'subscribe' && token === service.getVerifyToken()) {
      logger.info({ src: 'plugin:whatsapp' }, 'Webhook verification successful');
      res.status(200).send(challenge ?? '');
    } else {
      logger.warn({ src: 'plugin:whatsapp' }, 'Webhook verification failed — token mismatch');
      res.status(403).json({ error: 'Verification failed' });
    }
  },
};

/**
 * POST /webhooks/whatsapp — Receives inbound messages and status updates from Meta.
 */
export const whatsappWebhookRoute: Route = {
  type: 'POST',
  path: '/webhooks/whatsapp',

  handler: async (req, res, runtime: IAgentRuntime): Promise<void> => {
    const service = runtime.getService('whatsapp') as WhatsAppService | null;
    if (!service || !service.isConfigured) {
      res.status(503).json({ error: 'WhatsApp integration not configured' });
      return;
    }

    // 1. Verify signature
    const signature = (req.headers as Record<string, string>)?.['x-hub-signature-256'];
    if (!signature) {
      res.status(401).json({ error: 'Missing signature header' });
      return;
    }

    const rawBody =
      typeof req.rawBody === 'string' ? req.rawBody : JSON.stringify(req.body ?? {});
    if (!service.verifyWebhookSignature(signature, rawBody)) {
      logger.warn({ src: 'plugin:whatsapp' }, 'Invalid webhook signature rejected');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const payload = normalizeRouteBody<WhatsAppWebhookPayload>(req);
    if (!Array.isArray(payload.entry)) {
      respondInvalidRequest(res, 'Malformed WhatsApp webhook payload: entry[] is required', {
        route: 'webhooks/whatsapp',
        field: 'entry',
      });
      return;
    }

    // 2. Acknowledge immediately (Meta expects fast 200)
    res.status(200).json({ status: 'ok' });

    // 3. Process asynchronously
    processWhatsAppWebhook(runtime, service, payload).catch((error) => {
      logger.error(
        {
          src: 'plugin:whatsapp',
          error: error instanceof Error ? error.message : String(error),
          payload: redactSensitiveLogContext(payload),
        },
        'Error processing WhatsApp webhook'
      );
    });
  },
};

async function processWhatsAppWebhook(
  runtime: IAgentRuntime,
  service: WhatsAppService,
  payload: WhatsAppWebhookPayload
): Promise<void> {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change?.value as Record<string, unknown> | undefined;
      if (!value || typeof value !== 'object') {
        continue;
      }
      const messages = value.messages as WhatsAppInboundMessage[] | undefined;
      const contacts = value.contacts as WhatsAppContact[] | undefined;
      const statuses = value.statuses as Array<{ id: string; status: string; errors?: unknown[] }> | undefined;

      // Handle status updates (delivery receipts)
      if (statuses?.length) {
        for (const status of statuses) {
          logger.debug(
            { src: 'plugin:whatsapp', messageId: status.id, status: status.status },
            'WhatsApp status update'
          );
          if (status.status === 'failed' && status.errors?.length) {
            logger.error(
              { src: 'plugin:whatsapp', messageId: status.id, errors: status.errors },
              'WhatsApp message delivery failed'
            );
          }
        }
      }

      // Handle inbound messages
      if (messages?.length && contacts?.length) {
        for (const message of messages) {
          const contact = contacts.find((c) => c.wa_id === message.from) ?? contacts[0];
          await processInboundMessage(runtime, service, message, contact);
        }
      }
    }
  }
}

async function processInboundMessage(
  runtime: IAgentRuntime,
  service: WhatsAppService,
  message: WhatsAppInboundMessage,
  contact: WhatsAppContact
): Promise<void> {
  // Only handle text messages for MVP
  if (message.type !== 'text' || !message.text?.body) {
    logger.debug(
      { src: 'plugin:whatsapp', type: message.type, from: message.from },
      'Skipping non-text message'
    );
    return;
  }

  const phoneNumber = message.from;
  const contactName = contact.profile.name || phoneNumber;
  const messageText = message.text.body;

  logger.info(
    { src: 'plugin:whatsapp', from: phoneNumber, name: contactName },
    'Processing inbound WhatsApp message'
  );

  // Mark as read
  service.markAsRead(message.id).catch((error) => {
    logger.warn(
      { src: 'plugin:whatsapp', error: error instanceof Error ? error.message : String(error) },
      'Failed to mark message as read'
    );
  });

  // Create deterministic room + entity IDs scoped to this agent
  const roomId = createUniqueUuid(runtime, `wa-${phoneNumber}`);
  const entityId = createUniqueUuid(runtime, `wa-user-${phoneNumber}`);

  // Update session
  service.setSession({
    phoneNumber,
    contactName,
    roomId,
    entityId,
    lastMessageAt: Date.now(),
  });

  // Ensure connection exists for this WhatsApp conversation
  await runtime.ensureConnection({
    entityId,
    roomId,
    worldId: runtime.agentId,
    source: 'whatsapp',
    channelId: `wa-${phoneNumber}`,
    userName: contactName,
  });

  // Process through the agent's message pipeline
  if (runtime.messageService) {
    const messageId = createUniqueUuid(runtime, `wa-msg-${message.id}`);
    const memory = {
      id: messageId,
      entityId,
      agentId: runtime.agentId,
      roomId,
      content: {
        text: messageText,
        source: 'whatsapp',
        metadata: {
          phoneNumber,
          contactName,
          whatsappMessageId: message.id,
        },
      },
      createdAt: Date.now(),
    };

    await runtime.messageService.handleMessage(runtime, memory, async (response) => {
      if (response.text) {
        try {
          await service.sendTextMessage({
            to: phoneNumber,
            text: response.text,
          });
          logger.info({ src: 'plugin:whatsapp', to: phoneNumber }, 'Sent WhatsApp reply');
        } catch (error) {
          logger.error(
            {
              src: 'plugin:whatsapp',
              to: phoneNumber,
              error: error instanceof Error ? error.message : String(error),
            },
            'Failed to send WhatsApp reply'
          );
        }
      }
      return [];
    });
  }
}
