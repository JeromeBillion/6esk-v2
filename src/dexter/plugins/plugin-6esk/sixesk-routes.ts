import { type Route, type IAgentRuntime, logger, createUniqueUuid, ModelType } from '@elizaos/core';
import { SixeskService } from './sixesk-service';
import type { SixeskWebhookPayload, SixeskAction, SixeskTicket } from './types';
import { cleanMessageText, normalizeWhitespace } from './sixesk-text';
import { normalizeRouteBody, respondInvalidRequest } from '../../utils/request-validation';
import { redactSensitiveLogContext } from '../../utils/redaction';

/**
 * Webhook route that receives events from the 6esk CRM outbox.
 * Mounted at POST /hooks/6esk/events via ElizaOS plugin route system.
 */
export const sixeskWebhookRoute: Route = {
  type: 'POST',
  path: '/hooks/6esk/events',

  handler: async (req, res, runtime: IAgentRuntime): Promise<void> => {
    const service = runtime.getService('sixesk') as SixeskService | null;
    if (!service || !service.isConfigured) {
      res.status(503).json({ error: '6esk integration not configured' });
      return;
    }

    // 1. Verify HMAC signature
    const signature = (req.headers as Record<string, string>)?.['x-6esk-signature'];
    const timestamp = (req.headers as Record<string, string>)?.['x-6esk-timestamp'];

    if (!signature || !timestamp) {
      res.status(401).json({ error: 'Missing signature headers' });
      return;
    }

    const bodyRequest = req as typeof req & { rawBody?: string; body?: unknown };
    const rawBody =
      typeof bodyRequest.rawBody === 'string'
        ? bodyRequest.rawBody
        : JSON.stringify(bodyRequest.body ?? {});
    if (!service.verifyWebhookSignature(signature, timestamp, rawBody)) {
      logger.warn({ src: 'plugin:6esk' }, 'Invalid webhook signature rejected');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // 2. Check timestamp freshness (reject > 5 minutes old)
    const eventTime = new Date(timestamp).getTime();
    if (Number.isNaN(eventTime) || Math.abs(Date.now() - eventTime) > 5 * 60 * 1000) {
      res.status(401).json({ error: 'Stale or invalid timestamp' });
      return;
    }

    // 3. Parse payload
    const payload = normalizeRouteBody<SixeskWebhookPayload>(req);
    const { event_type, resource } = payload;
    const ticket_id = resource?.ticket_id;

    if (!event_type || !ticket_id) {
      respondInvalidRequest(res, 'Missing event_type or resource.ticket_id', {
        route: 'hooks/6esk/events',
        field: 'event_type|resource.ticket_id',
      });
      return;
    }

    logger.info(
      { src: 'plugin:6esk', eventType: event_type, ticketId: ticket_id },
      'Received 6esk webhook event'
    );

    // 4. Acknowledge immediately (6esk expects fast response)
    res.status(200).json({ status: 'accepted' });

    // 5. Process asynchronously
    processWebhookEvent(runtime, service, payload).catch((error) => {
      logger.error(
        {
          src: 'plugin:6esk',
          ticketId: payload.resource?.ticket_id,
          error: error instanceof Error ? error.message : String(error),
          payload: redactSensitiveLogContext(payload),
        },
        'Error processing 6esk webhook event'
      );
    });
  },
};

/**
 * Compute confidence score based on thread context.
 * More customer messages = more context = higher confidence.
 * Short threads or ambiguous tickets get lower confidence.
 */
function computeConfidence(messages: Array<{ direction: string; text: string | null }>): number {
  const customerMessages = messages.filter((m) => m.direction === 'inbound' && m.text);
  const count = customerMessages.length;

  if (count === 0) return 0.3;
  if (count === 1) return 0.6;
  if (count <= 3) return 0.75;
  return 0.85;
}

const REPLY_ELIGIBLE_EVENTS = new Set(['ticket.message.created']);
const MERGE_EVENTS = new Set(['ticket.merged', 'ticket.linked_case', 'customer.merged']);
const CALL_EVENTS = new Set([
  'ticket.call.received',
  'ticket.call.queued',
  'ticket.call.started',
  'ticket.call.ended',
  'ticket.call.failed',
  'ticket.call.recording.ready',
  'ticket.call.transcript.ready',
]);

const CALL_SUMMARY_MAX_CHARS_DEFAULT = 4000;
const CALL_SUMMARY_MAX_TOKENS_DEFAULT = 320;

const parseBooleanSetting = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(lowered)) return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(lowered)) return false;
  }
  return fallback;
};

const parseNumberSetting = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const safeParseJson = (text: string): Record<string, unknown> | null => {
  const raw = text.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
};

const readString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const readStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => readString(item)).filter(Boolean) as string[];
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n|;/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const fetchTranscriptText = async (url: string, maxChars: number): Promise<string | null> => {
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const text = await response.text();
    const cleaned = normalizeWhitespace(text);
    if (!cleaned) return null;
    if (cleaned.length <= maxChars) return cleaned;
    return `${cleaned.slice(0, maxChars)}...`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const buildCallSummaryPrompt = (params: {
  transcript: string;
  callStatus?: string | null;
  direction?: string | null;
  durationSeconds?: number | null;
}): string => {
  const contextLines = [
    params.callStatus ? `Status: ${params.callStatus}` : null,
    params.direction ? `Direction: ${params.direction}` : null,
    typeof params.durationSeconds === 'number' ? `Duration: ${params.durationSeconds}s` : null,
  ].filter(Boolean);

  return [
    'You are an internal CRM assistant summarizing a support phone call for a ticket.',
    'Return JSON with keys:',
    '- summary: 2-4 sentences.',
    '- actionItems: array of follow-up actions (empty if none).',
    '- sentiment: one of positive, neutral, negative, frustrated, angry, anxious, confused, relieved.',
    '',
    contextLines.length ? `Call context: ${contextLines.join(' | ')}` : '',
    'Transcript:',
    params.transcript,
  ]
    .filter(Boolean)
    .join('\n');
};

const getActionReason = (action: SixeskAction): string | null => {
  if (hasText(action.reason)) return action.reason.trim();
  if (action.metadata && hasText(action.metadata.reason)) return action.metadata.reason.trim();
  return null;
};

const getActionConfidence = (action: SixeskAction): number | null => {
  if (typeof action.confidence === 'number' && Number.isFinite(action.confidence)) {
    return action.confidence;
  }
  if (action.metadata && typeof action.metadata.confidence === 'number' && Number.isFinite(action.metadata.confidence)) {
    return action.metadata.confidence as number;
  }
  return null;
};

const isMergeAction = (action: SixeskAction): boolean =>
  ['merge_tickets', 'link_tickets', 'merge_customers', 'propose_merge'].includes(action.type);

const mergeProposalType = (
  actionType: SixeskAction['type']
): 'ticket_merge' | 'customer_merge' | 'linked_case' => {
  if (actionType === 'merge_customers') return 'customer_merge';
  if (actionType === 'link_tickets') return 'linked_case';
  return 'ticket_merge';
};

const hasMergeIds = (action: SixeskAction): boolean => {
  if (action.type === 'merge_customers') {
    return hasText(action.sourceCustomerId) && hasText(action.targetCustomerId);
  }
  return hasText(action.sourceTicketId) && hasText(action.targetTicketId);
};

export function applySixeskActionPolicy(
  actions: SixeskAction[],
  options: { allowDirectMergeActions: boolean }
): SixeskAction[] {
  const normalized: SixeskAction[] = [];

  for (const action of actions) {
    if (!isMergeAction(action)) {
      normalized.push(action);
      continue;
    }

    const reason = getActionReason(action);
    const confidence = getActionConfidence(action);
    if (!reason || confidence === null) {
      logger.warn(
        { src: 'plugin:6esk', actionType: action.type },
        'Skipping merge action without reason/confidence'
      );
      continue;
    }

    if (
      (action.type === 'merge_tickets' ||
        action.type === 'link_tickets' ||
        action.type === 'merge_customers') &&
      !options.allowDirectMergeActions
    ) {
      if (!hasMergeIds(action)) {
        logger.warn(
          { src: 'plugin:6esk', actionType: action.type },
          'Skipping direct merge action without source/target identifiers'
        );
        continue;
      }
      normalized.push({
        ...action,
        type: 'propose_merge',
        reason,
        confidence,
        metadata: {
          ...(action.metadata || {}),
          proposalType: mergeProposalType(action.type),
          downgradedFrom: action.type,
          reason,
          confidence,
          policyHint: 'Direct merge actions disabled; proposing merge for human review.'
        }
      });
      continue;
    }

    normalized.push({
      ...action,
      reason,
      confidence,
      metadata: {
        ...(action.metadata || {}),
        reason,
        confidence
      }
    });
  }

  return normalized;
}

const isLockedOrMerged = (ticket: SixeskTicket): { locked: boolean; reason: string | null } => {
  if (ticket.merged_into_ticket_id || ticket.merged_at) {
    return { locked: true, reason: 'merged' };
  }
  const status = (ticket.status || '').toLowerCase();
  if (status === 'closed') {
    return { locked: true, reason: 'closed' };
  }
  const metadata = (ticket.metadata || {}) as Record<string, unknown>;
  if (metadata.merge_locked === true || metadata.locked === true) {
    return { locked: true, reason: 'locked' };
  }
  return { locked: false, reason: null };
};

async function summarizeCallTranscript(params: {
  runtime: IAgentRuntime;
  transcript: string;
  callStatus?: string | null;
  direction?: string | null;
  durationSeconds?: number | null;
  maxTokens: number;
}): Promise<{
  summary: string;
  actionItems: string[];
  sentiment: string | null;
  raw: string;
} | null> {
  const prompt = buildCallSummaryPrompt({
    transcript: params.transcript,
    callStatus: params.callStatus,
    direction: params.direction,
    durationSeconds: params.durationSeconds,
  });

  try {
    const response = (await params.runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
      maxTokens: params.maxTokens,
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
    })) as string;

    const raw = response?.trim() || '';
    if (!raw) return null;
    const parsed = safeParseJson(raw);
    const summary =
      readString(parsed?.summary) ||
      readString(parsed?.callSummary) ||
      raw.slice(0, 1200);
    const actionItems = readStringArray(parsed?.actionItems ?? parsed?.action_items ?? parsed?.actions);
    const sentiment =
      readString(parsed?.sentiment) ||
      readString(parsed?.customerTone) ||
      null;

    return {
      summary: summary.length > 1200 ? summary.slice(0, 1200) : summary,
      actionItems: actionItems.slice(0, 8),
      sentiment,
      raw,
    };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.warn(
      { src: 'plugin:6esk', error: errMessage },
      'Failed to generate call summary'
    );
    return null;
  }
}

async function handleCallTranscriptReady(
  runtime: IAgentRuntime,
  service: SixeskService,
  payload: SixeskWebhookPayload
): Promise<void> {
  const enabled = parseBooleanSetting(runtime.getSetting('SIXESK_CALL_SUMMARY_ENABLED'), false);
  if (!enabled) return;

  const ticketId = payload.resource?.ticket_id;
  if (!ticketId) return;

  const callContext = service.getCallContext(ticketId);
  if (!callContext?.callSessionId) return;

  if (service.hasCallSummaryPosted(callContext.callSessionId)) {
    logger.info(
      { src: 'plugin:6esk', ticketId, callSessionId: callContext.callSessionId },
      'Call summary already posted; skipping'
    );
    return;
  }

  const maxChars = parseNumberSetting(
    runtime.getSetting('SIXESK_CALL_SUMMARY_MAX_CHARS'),
    CALL_SUMMARY_MAX_CHARS_DEFAULT
  );
  const maxTokens = parseNumberSetting(
    runtime.getSetting('SIXESK_CALL_SUMMARY_MAX_TOKENS'),
    CALL_SUMMARY_MAX_TOKENS_DEFAULT
  );

  let transcript = callContext.transcriptExcerpt || null;
  if (callContext.transcriptUrl) {
    const fetched = await fetchTranscriptText(callContext.transcriptUrl, maxChars);
    if (fetched) {
      transcript = fetched;
    }
  }
  if (!transcript) {
    logger.info(
      { src: 'plugin:6esk', ticketId, callSessionId: callContext.callSessionId },
      'Transcript not available for call summary'
    );
    return;
  }

  const summary = await summarizeCallTranscript({
    runtime,
    transcript,
    callStatus: callContext.status,
    direction: callContext.direction ?? null,
    durationSeconds: callContext.durationSeconds ?? null,
    maxTokens,
  });
  if (!summary) return;

  const metadata = {
    source: 'DEXTER_call_summary',
    callSessionId: callContext.callSessionId,
    status: callContext.status ?? null,
    direction: callContext.direction ?? null,
    durationSeconds: callContext.durationSeconds ?? null,
    transcriptUrl: callContext.transcriptUrl ?? null,
    recordingUrl: callContext.recordingUrl ?? null,
    summary: summary.summary,
    actionItems: summary.actionItems,
    sentiment: summary.sentiment,
    generatedAt: new Date().toISOString(),
  };

  try {
    await service.submitActions([
      {
        type: 'request_human_review',
        ticketId,
        metadata,
      },
    ]);
    service.markCallSummaryPosted(callContext.callSessionId);
    logger.info(
      { src: 'plugin:6esk', ticketId, callSessionId: callContext.callSessionId },
      'Posted call summary to 6esk'
    );
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      { src: 'plugin:6esk', ticketId, callSessionId: callContext.callSessionId, error: errMessage },
      'Failed to post call summary to 6esk'
    );
  }
}

async function processWebhookEvent(
  runtime: IAgentRuntime,
  service: SixeskService,
  payload: SixeskWebhookPayload
): Promise<void> {
  const eventType = payload.event_type;
  const ticketId = payload.resource.ticket_id ?? '';
  if (!ticketId) {
    logger.warn({ src: 'plugin:6esk', eventType }, 'Webhook payload missing ticket_id');
    return;
  }

  try {
    if (MERGE_EVENTS.has(eventType)) {
      service.recordMergeSignal(payload);
      logger.info(
        { src: 'plugin:6esk', ticketId, eventType },
        'Merge event received: recorded canonical mapping and skipped reply generation'
      );
      return;
    }

    if (eventType === 'customer.identity.resolved' || eventType === 'merge.review.required') {
      service.recordMergeSignal(payload);
      logger.info(
        { src: 'plugin:6esk', ticketId, eventType },
        'Identity/merge-review event acknowledged without reply generation'
      );
      return;
    }

    if (CALL_EVENTS.has(eventType)) {
      await service.recordCallEvent(payload);
      if (eventType === 'ticket.call.transcript.ready') {
        await handleCallTranscriptReady(runtime, service, payload);
      }
      logger.info(
        { src: 'plugin:6esk', ticketId, eventType },
        'Call lifecycle event recorded without reply generation'
      );
      return;
    }

    // Fetch ticket context from 6esk
    await service.cacheTicketContext(ticketId);

    const ctx = service.getTicketContext(ticketId);
    if (!ctx) {
      logger.warn({ src: 'plugin:6esk', ticketId }, 'No ticket context after fetch');
      return;
    }

    const mergeSignal = service.getMergeSignal(ticketId);
    if (mergeSignal?.targetTicketId && mergeSignal.targetTicketId !== ticketId) {
      logger.info(
        {
          src: 'plugin:6esk',
          ticketId,
          eventType,
          targetTicketId: mergeSignal.targetTicketId,
          mergeSignal: mergeSignal.eventType
        },
        'Ticket has canonical merge target; skipping reply generation on source ticket'
      );
      return;
    }

    // Keep non-message webhook events on ice for now.
    if (!REPLY_ELIGIBLE_EVENTS.has(eventType)) {
      logger.info(
        { src: 'plugin:6esk', ticketId, eventType, status: ctx.ticket.status },
        '6esk event acknowledged without reply generation'
      );
      return;
    }

    const lockState = isLockedOrMerged(ctx.ticket);
    if (lockState.locked) {
      logger.info(
        {
          src: 'plugin:6esk',
          ticketId,
          eventType,
          ticketStatus: ctx.ticket.status,
          mergedIntoTicketId: ctx.ticket.merged_into_ticket_id ?? null,
          lockReason: lockState.reason,
        },
        'Ticket is merged/locked; skipping reply generation'
      );
      return;
    }

    // Get latest customer message for context
    const latestCustomerMsg = ctx.messages.filter((m) => m.direction === 'inbound').slice(-1)[0];
    if (!latestCustomerMsg?.text?.trim()) {
      logger.info(
        { src: 'plugin:6esk', ticketId, eventType },
        'No inbound customer text found — skipping reply generation'
      );
      return;
    }

    const cleanedText = cleanMessageText(latestCustomerMsg.text);
    const messageText = cleanedText || latestCustomerMsg.text || '';
    if (!messageText.trim()) {
      logger.info(
        { src: 'plugin:6esk', ticketId, eventType },
        'Inbound message contained no usable text after cleaning — skipping reply generation'
      );
      return;
    }

    // Create deterministic room + entity IDs scoped to this agent
    const roomId = createUniqueUuid(runtime, `ticket-${ticketId}`);
    const entityId = createUniqueUuid(runtime, `6esk-customer-${ticketId}`);

    // Ensure connection exists for this ticket room
    await runtime.ensureConnection({
      entityId,
      roomId,
      worldId: runtime.agentId,
      source: '6esk',
      channelId: `ticket-${ticketId}`,
    });

    // Process through the agent's message pipeline
    if (runtime.messageService) {
      const messageId = createUniqueUuid(runtime, `${ticketId}-${Date.now()}`);
      const memory = {
        id: messageId,
        entityId,
        agentId: runtime.agentId,
        roomId,
        content: {
          text: messageText,
          source: '6esk',
          metadata: { ticketId, eventType },
        },
        createdAt: Date.now(),
      };

      await runtime.messageService.handleMessage(runtime, memory, async (response) => {
        if (response.text) {
          const actionType = service.policyMode === 'auto_send' ? 'send_reply' : 'draft_reply';
          const confidence = computeConfidence(ctx.messages);
          const normalizedActions = applySixeskActionPolicy(
            [
              {
                type: actionType,
                ticketId,
                text: response.text,
                confidence,
              },
            ],
            { allowDirectMergeActions: service.allowDirectMergeActions }
          );
          if (!normalizedActions.length) {
            logger.warn(
              { src: 'plugin:6esk', ticketId, actionType },
              'No actions remained after policy filtering; skipping submit'
            );
            return [];
          }
          try {
            await service.submitActions(normalizedActions);
            logger.info({ src: 'plugin:6esk', ticketId, actionType }, 'Submitted response to 6esk');
          } catch (error) {
            logger.error(
              {
                src: 'plugin:6esk',
                ticketId,
                error: error instanceof Error ? error.message : String(error),
              },
              'Failed to submit action to 6esk'
            );
          }
        }
        return [];
      });
    }
  } finally {
    // Ensure per-ticket context is always released even when processing throws.
    service.clearTicketContext(ticketId);
  }
}
