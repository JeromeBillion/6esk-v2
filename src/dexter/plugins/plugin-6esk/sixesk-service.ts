import { Service, type IAgentRuntime, logger } from '@elizaos/core';
import { createHmac, timingSafeEqual } from 'crypto';
import type {
  SixeskConfig,
  SixeskTicket,
  SixeskMessage,
  SixeskAction,
  SixeskTicketContext,
  SixeskTicketSummary,
  SixeskWebhookPayload,
  SixeskCustomerHistoryResponse,
  SixeskCustomerProfile,
  SixeskCallContext,
  SixeskTicketCallOptions,
  TicketMergePreflight,
  TicketLinkPreflight,
  CustomerMergePreflight,
} from './types';
import { truncateSnippet, normalizeWhitespace, stripQuotedText } from './sixesk-text';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1_000, 3_000, 10_000];
const SUMMARY_SNIPPET_CHARS_DEFAULT = 220;
const RECENT_THREAD_LIMIT = 8;
const CUSTOMER_HISTORY_LIMIT = 12;
const DEFAULT_MIN_MERGE_CONFIDENCE = 0.85;

const asTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

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

type MergeSignal = {
  eventType: string;
  occurredAt: string;
  targetTicketId?: string | null;
  note?: string | null;
};

export class SixeskService extends Service {
  static serviceType = 'sixesk';
  capabilityDescription = '6esk CRM integration for ticket management';

  private sixeskConfig!: SixeskConfig;
  private ticketContextCache: Map<string, SixeskTicketContext> = new Map();
  private ticketSummaries: Map<string, SixeskTicketSummary> = new Map();
  private mergedTicketAliases: Map<string, string> = new Map();
  private mergeSignals: Map<string, MergeSignal> = new Map();
  private callContexts: Map<string, SixeskCallContext> = new Map();
  private callSummaryPosts: Map<string, number> = new Map();
  private summarySnippetChars = SUMMARY_SNIPPET_CHARS_DEFAULT;

  static async start(runtime: IAgentRuntime): Promise<Service> {
    const service = new SixeskService(runtime);
    service.sixeskConfig = {
      baseUrl: (runtime.getSetting('SIXESK_BASE_URL') as string) || '',
      agentKey: (runtime.getSetting('SIXESK_AGENT_KEY') as string) || '',
      sharedSecret: (runtime.getSetting('SIXESK_SHARED_SECRET') as string) || '',
      policyMode: ((runtime.getSetting('SIXESK_POLICY_MODE') as string) || 'draft_only') as
        | 'draft_only'
        | 'auto_send',
      allowDirectMergeActions: parseBooleanSetting(
        runtime.getSetting('SIXESK_ALLOW_DIRECT_MERGE_ACTIONS'),
        false
      ),
      minMergeConfidence: parseNumberSetting(
        runtime.getSetting('SIXESK_MIN_MERGE_CONFIDENCE'),
        DEFAULT_MIN_MERGE_CONFIDENCE
      ),
    };
    service.summarySnippetChars = parseNumberSetting(
      runtime.getSetting('SIXESK_THREAD_SNIPPET_CHARS'),
      SUMMARY_SNIPPET_CHARS_DEFAULT
    );

    if (!service.sixeskConfig.baseUrl) {
      logger.warn({ src: 'plugin:6esk' }, 'SIXESK_BASE_URL not configured, service inactive');
    } else {
      logger.info(
        {
          src: 'plugin:6esk',
          baseUrl: service.sixeskConfig.baseUrl,
          allowDirectMergeActions: service.sixeskConfig.allowDirectMergeActions,
          minMergeConfidence: service.sixeskConfig.minMergeConfidence,
        },
        '6esk CRM service started'
      );
    }

    return service;
  }

  async stop(): Promise<void> {
    this.ticketContextCache.clear();
    this.ticketSummaries.clear();
    this.mergedTicketAliases.clear();
    this.mergeSignals.clear();
    this.callContexts.clear();
    this.callSummaryPosts.clear();
  }

  private isPriorityTicket(priority: string | null | undefined): boolean {
    const value = (priority || '').toLowerCase();
    return ['high', 'urgent', 'critical', 'p1', 'p0'].includes(value);
  }

  private summarizeOlderMessages(messages: SixeskMessage[]): string | null {
    if (!messages.length) return null;

    const quoteHeavy = messages.some((m) => {
      if (!m.text) return false;
      return stripQuotedText(m.text).quoteRatio >= 0.4;
    });
    const lengthBoost = quoteHeavy || messages.length >= 12;
    const inboundLimit = lengthBoost ? 4 : 3;
    const outboundLimit = lengthBoost ? 3 : 2;

    const inbound = messages
      .filter((m) => m.direction === 'inbound')
      .map((m) => truncateSnippet(m.text, this.summarySnippetChars))
      .filter(Boolean)
      .slice(-inboundLimit);

    const outbound = messages
      .filter((m) => m.direction === 'outbound')
      .map((m) => truncateSnippet(m.text, this.summarySnippetChars))
      .filter(Boolean)
      .slice(-outboundLimit);

    const parts: string[] = [];
    if (inbound.length) {
      parts.push(`Earlier customer notes: ${inbound.join(' | ')}`);
    }
    if (outbound.length) {
      parts.push(`Earlier support replies: ${outbound.join(' | ')}`);
    }

    return parts.length ? parts.join('\n') : null;
  }

  private buildRollingSummary(ticket: SixeskTicket, messages: SixeskMessage[]): SixeskTicketSummary {
    const lastMessageId = messages.at(-1)?.id ?? null;
    const existing = this.ticketSummaries.get(ticket.id);

    if (existing && existing.lastMessageId === lastMessageId) {
      return existing;
    }

    const older = messages.slice(0, Math.max(0, messages.length - RECENT_THREAD_LIMIT));
    const olderSummary = this.summarizeOlderMessages(older);

    const tags = Array.isArray(ticket.tags) && ticket.tags.length ? ticket.tags.slice(0, 4) : [];
    const statusLine = `Status: ${ticket.status}; Priority: ${ticket.priority}${tags.length ? `; Tags: ${tags.join(', ')}` : ''
      }`;

    const summaryLines = [statusLine];
    if (olderSummary) {
      summaryLines.push(olderSummary);
    }

    const summary: SixeskTicketSummary = {
      text: summaryLines.join('\n'),
      updatedAt: Date.now(),
      lastMessageId,
      totalMessages: messages.length,
    };

    this.ticketSummaries.set(ticket.id, summary);
    return summary;
  }

  private buildAgentHeaders(): Record<string, string> {
    return {
      'x-6esk-agent-key': this.sixeskConfig.agentKey,
      'Content-Type': 'application/json',
    };
  }

  private resolveCanonicalTicketId(ticketId: string): string {
    let current = ticketId;
    const visited = new Set<string>();
    while (!visited.has(current)) {
      visited.add(current);
      const next = this.mergedTicketAliases.get(current);
      if (!next) break;
      current = next;
    }
    return current;
  }

  private rememberMergedAlias(sourceTicketId: string | null | undefined, targetTicketId: string | null | undefined) {
    const source = asTrimmedString(sourceTicketId);
    const target = asTrimmedString(targetTicketId);
    if (!source || !target || source === target) return;
    this.mergedTicketAliases.set(source, target);
  }

  private getMergeReason(action: SixeskAction): string | null {
    const topLevel = asTrimmedString(action.reason);
    if (topLevel) return topLevel;
    return asTrimmedString(action.metadata?.reason);
  }

  private getMergeConfidence(action: SixeskAction): number | null {
    if (typeof action.confidence === 'number' && Number.isFinite(action.confidence)) {
      return action.confidence;
    }
    if (typeof action.metadata?.confidence === 'number' && Number.isFinite(action.metadata.confidence)) {
      return action.metadata.confidence as number;
    }
    return null;
  }

  private getTicketMergeIds(action: SixeskAction): { sourceTicketId: string; targetTicketId: string } | null {
    const sourceTicketId =
      asTrimmedString(action.sourceTicketId) ??
      asTrimmedString(action.metadata?.sourceTicketId);
    const targetTicketId =
      asTrimmedString(action.targetTicketId) ??
      asTrimmedString(action.metadata?.targetTicketId);
    if (!sourceTicketId || !targetTicketId) return null;
    return { sourceTicketId, targetTicketId };
  }

  private getCustomerMergeIds(
    action: SixeskAction
  ): { sourceCustomerId: string; targetCustomerId: string } | null {
    const sourceCustomerId =
      asTrimmedString(action.sourceCustomerId) ??
      asTrimmedString(action.metadata?.sourceCustomerId);
    const targetCustomerId =
      asTrimmedString(action.targetCustomerId) ??
      asTrimmedString(action.metadata?.targetCustomerId);
    if (!sourceCustomerId || !targetCustomerId) return null;
    return { sourceCustomerId, targetCustomerId };
  }

  private assertMergeReasonAndConfidence(action: SixeskAction): { reason: string; confidence: number } {
    const reason = this.getMergeReason(action);
    if (!reason) {
      throw new Error(`${action.type} requires an explicit reason.`);
    }
    const confidence = this.getMergeConfidence(action);
    if (confidence === null) {
      throw new Error(`${action.type} requires confidence.`);
    }
    if (confidence < this.sixeskConfig.minMergeConfidence) {
      throw new Error(
        `${action.type} confidence ${confidence.toFixed(2)} is below minimum ${this.sixeskConfig.minMergeConfidence.toFixed(2)}.`
      );
    }
    return { reason, confidence };
  }

  private isMergeAction(action: SixeskAction): boolean {
    return ['merge_tickets', 'merge_customers', 'propose_merge'].includes(action.type);
  }

  private async applyMergeSafetyPolicy(action: SixeskAction): Promise<SixeskAction> {
    if (!this.isMergeAction(action)) {
      return action;
    }

    const { reason, confidence } = this.assertMergeReasonAndConfidence(action);
    const metadata = { ...(action.metadata ?? {}), reason };

    if (action.type === 'merge_tickets') {
      if (!this.sixeskConfig.allowDirectMergeActions) {
        throw new Error('Direct merge_tickets is disabled by policy (propose-only mode).');
      }

      const ids = this.getTicketMergeIds(action);
      if (!ids) {
        throw new Error('merge_tickets requires sourceTicketId and targetTicketId.');
      }
      if (ids.sourceTicketId === ids.targetTicketId) {
        throw new Error('Source and target tickets must be different.');
      }

      const preflight = await this.preflightTicketMerge(ids.sourceTicketId, ids.targetTicketId);
      if (preflight.blockingCode === 'cross_channel_not_allowed') {
        return {
          ...action,
          type: 'link_tickets',
          reason,
          confidence,
          metadata: {
            ...metadata,
            proposalType: 'linked_case',
            downgradedFrom: 'merge_tickets',
            linkedTicketIds: {
              sourceTicketId: ids.sourceTicketId,
              targetTicketId: ids.targetTicketId,
            },
            policyHint:
              'Ticket channels differ. Link the tickets as one case without destructive merge.',
          },
          sourceTicketId: ids.sourceTicketId,
          targetTicketId: ids.targetTicketId,
        };
      }
      if (!preflight.allowed) {
        throw new Error(preflight.blockingReason || 'Ticket merge blocked by preflight.');
      }

      return {
        ...action,
        reason,
        confidence,
        metadata,
        sourceTicketId: ids.sourceTicketId,
        targetTicketId: ids.targetTicketId,
      };
    }

    if (action.type === 'link_tickets') {
      if (!this.sixeskConfig.allowDirectMergeActions) {
        throw new Error('Direct link_tickets is disabled by policy (propose-only mode).');
      }

      const ids = this.getTicketMergeIds(action);
      if (!ids) {
        throw new Error('link_tickets requires sourceTicketId and targetTicketId.');
      }
      if (ids.sourceTicketId === ids.targetTicketId) {
        throw new Error('Source and target tickets must be different.');
      }

      const preflight = await this.preflightTicketLink(ids.sourceTicketId, ids.targetTicketId);
      if (!preflight.allowed) {
        throw new Error(preflight.blockingReason || 'Ticket link blocked by preflight.');
      }

      return {
        ...action,
        reason,
        confidence,
        metadata: {
          ...metadata,
          proposalType: 'linked_case',
        },
        sourceTicketId: ids.sourceTicketId,
        targetTicketId: ids.targetTicketId,
      };
    }

    if (action.type === 'merge_customers') {
      if (!this.sixeskConfig.allowDirectMergeActions) {
        throw new Error('Direct merge_customers is disabled by policy (propose-only mode).');
      }

      const ids = this.getCustomerMergeIds(action);
      if (!ids) {
        throw new Error('merge_customers requires sourceCustomerId and targetCustomerId.');
      }
      if (ids.sourceCustomerId === ids.targetCustomerId) {
        throw new Error('Source and target customers must be different.');
      }

      const preflight = await this.preflightCustomerMerge(ids.sourceCustomerId, ids.targetCustomerId);
      if (!preflight.allowed) {
        throw new Error(preflight.blockingReason || 'Customer merge blocked by preflight.');
      }

      return {
        ...action,
        reason,
        confidence,
        metadata,
        sourceCustomerId: ids.sourceCustomerId,
        targetCustomerId: ids.targetCustomerId,
      };
    }

    // propose_merge: keep propose-only flow safe and downgrade cross-channel ticket proposals.
    const proposalType = asTrimmedString(action.metadata?.proposalType)?.toLowerCase();
    const ticketMergeIds = this.getTicketMergeIds(action);
    if (proposalType === 'ticket_merge' && ticketMergeIds) {
      const preflight = await this.preflightTicketMerge(
        ticketMergeIds.sourceTicketId,
        ticketMergeIds.targetTicketId
      );
      if (preflight.blockingCode === 'cross_channel_not_allowed') {
        return {
          ...action,
          reason,
          confidence,
          sourceTicketId: ticketMergeIds.sourceTicketId,
          targetTicketId: ticketMergeIds.targetTicketId,
          sourceCustomerId: asTrimmedString(preflight.sourceCustomerId),
          targetCustomerId: asTrimmedString(preflight.targetCustomerId),
          metadata: {
            ...metadata,
            proposalType: 'linked_case',
            linkedTicketIds: {
              sourceTicketId: ticketMergeIds.sourceTicketId,
              targetTicketId: ticketMergeIds.targetTicketId,
            },
            policyHint:
              'Ticket channels differ. Link the tickets as one case without destructive merge.'
          }
        };
      }
    }

    return {
      ...action,
      reason,
      confidence,
      metadata
    };
  }

  /**
   * Verify HMAC-SHA256 signature from 6esk webhook delivery.
   * Mirrors 6esk's signPayload(): createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")
   * with "sha256=" prefix.
   */
  verifyWebhookSignature(signature: string, timestamp: string, body: string): boolean {
    if (!this.sixeskConfig.sharedSecret) return false;

    const expected = createHmac('sha256', this.sixeskConfig.sharedSecret)
      .update(`${timestamp}.${body}`)
      .digest('hex');
    const expectedSig = `sha256=${expected}`;

    if (signature.length !== expectedSig.length) return false;
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig));
  }

  /** Fetch with retry and exponential backoff */
  private async fetchWithRetry(
    url: string,
    init: RequestInit,
    label: string,
    attempt = 0
  ): Promise<Response> {
    const response = await fetch(url, init);

    if (response.ok) return response;

    // Don't retry client errors (4xx) except rate limits (429)
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      const text = await response.text();
      throw new Error(`${label}: ${response.status} - ${text}`);
    }

    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempt] ?? 10_000;
      logger.warn(
        { src: 'plugin:6esk', attempt: attempt + 1, status: response.status, label },
        `Retrying 6esk API call in ${delay}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.fetchWithRetry(url, init, label, attempt + 1);
    }

    const text = await response.text();
    throw new Error(`${label} failed after ${MAX_RETRIES} retries: ${response.status} - ${text}`);
  }

  /** Fetch ticket details from 6esk context API */
  async fetchTicket(ticketId: string): Promise<SixeskTicket> {
    const url = `${this.sixeskConfig.baseUrl}/api/agent/v1/tickets/${ticketId}`;
    const response = await this.fetchWithRetry(
      url,
      {
        headers: this.buildAgentHeaders(),
      },
      `fetchTicket(${ticketId})`
    );
    const data = (await response.json()) as { ticket: SixeskTicket };
    return data.ticket;
  }

  /** Fetch ticket messages (email thread) from 6esk context API */
  async fetchTicketMessages(ticketId: string, limit = 50): Promise<SixeskMessage[]> {
    const url = `${this.sixeskConfig.baseUrl}/api/agent/v1/tickets/${ticketId}/messages?limit=${limit}`;
    const response = await this.fetchWithRetry(
      url,
      {
        headers: this.buildAgentHeaders(),
      },
      `fetchTicketMessages(${ticketId})`
    );
    const data = (await response.json()) as { messages: SixeskMessage[] };
    return data.messages;
  }

  async fetchTicketCallOptions(ticketId: string): Promise<SixeskTicketCallOptions> {
    const url = `${this.sixeskConfig.baseUrl}/api/agent/v1/tickets/${ticketId}/call-options`;
    const response = await this.fetchWithRetry(
      url,
      {
        headers: this.buildAgentHeaders(),
      },
      `fetchTicketCallOptions(${ticketId})`
    );
    return response.json() as Promise<SixeskTicketCallOptions>;
  }

  async fetchCustomerHistory(
    ticketId: string,
    limit = CUSTOMER_HISTORY_LIMIT
  ): Promise<SixeskCustomerHistoryResponse> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 30);
    const url = `${this.sixeskConfig.baseUrl}/api/tickets/${ticketId}/customer-history?limit=${boundedLimit}`;
    const response = await this.fetchWithRetry(
      url,
      {
        headers: this.buildAgentHeaders(),
      },
      `fetchCustomerHistory(${ticketId})`
    );
    return response.json() as Promise<SixeskCustomerHistoryResponse>;
  }

  async searchTickets(query: string, limit = 20): Promise<SixeskTicket[]> {
    const q = query.trim();
    if (!q) return [];
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const url = `${this.sixeskConfig.baseUrl}/api/tickets/search?q=${encodeURIComponent(q)}&limit=${boundedLimit}`;
    const response = await this.fetchWithRetry(
      url,
      {
        headers: this.buildAgentHeaders(),
      },
      `searchTickets(${q})`
    );
    const data = (await response.json()) as { tickets?: SixeskTicket[] };
    return Array.isArray(data.tickets) ? data.tickets : [];
  }

  async searchCustomers(query: string, limit = 20): Promise<SixeskCustomerProfile[]> {
    const q = query.trim();
    if (!q) return [];
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
    const url = `${this.sixeskConfig.baseUrl}/api/customers/search?q=${encodeURIComponent(q)}&limit=${boundedLimit}`;
    const response = await this.fetchWithRetry(
      url,
      {
        headers: this.buildAgentHeaders(),
      },
      `searchCustomers(${q})`
    );
    const data = (await response.json()) as { customers?: SixeskCustomerProfile[] };
    return Array.isArray(data.customers) ? data.customers : [];
  }

  async preflightTicketMerge(sourceTicketId: string, targetTicketId: string): Promise<TicketMergePreflight> {
    const url = `${this.sixeskConfig.baseUrl}/api/tickets/merge/preflight`;
    const response = await this.fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: this.buildAgentHeaders(),
        body: JSON.stringify({ sourceTicketId, targetTicketId }),
      },
      `preflightTicketMerge(${sourceTicketId},${targetTicketId})`
    );
    const data = (await response.json()) as { preflight: TicketMergePreflight };
    return data.preflight;
  }

  async preflightCustomerMerge(
    sourceCustomerId: string,
    targetCustomerId: string
  ): Promise<CustomerMergePreflight> {
    const url = `${this.sixeskConfig.baseUrl}/api/customers/merge/preflight`;
    const response = await this.fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: this.buildAgentHeaders(),
        body: JSON.stringify({ sourceCustomerId, targetCustomerId }),
      },
      `preflightCustomerMerge(${sourceCustomerId},${targetCustomerId})`
    );
    const data = (await response.json()) as { preflight: CustomerMergePreflight };
    return data.preflight;
  }

  /** Submit action(s) back to 6esk with retry */
  async submitActions(actions: SixeskAction[]): Promise<{ status: string; results: unknown[] }> {
    const guardedActions: SixeskAction[] = [];
    for (const action of actions) {
      guardedActions.push(await this.applyMergeSafetyPolicy(action));
    }

    const url = `${this.sixeskConfig.baseUrl}/api/agent/v1/actions`;
    const response = await this.fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: this.buildAgentHeaders(),
        body: JSON.stringify({ actions: guardedActions }),
      },
      'submitActions'
    );
    return response.json() as Promise<{ status: string; results: unknown[] }>;
  }

  /** Fetch and cache ticket context for provider consumption */
  async cacheTicketContext(ticketId: string): Promise<void> {
    const canonicalTicketId = this.resolveCanonicalTicketId(ticketId);
    const [ticket, messages] = await Promise.all([
      this.fetchTicket(canonicalTicketId),
      this.fetchTicketMessages(canonicalTicketId),
    ]);
    const history = await this.fetchCustomerHistory(canonicalTicketId, CUSTOMER_HISTORY_LIMIT).catch((error) => {
      logger.warn(
        {
          src: 'plugin:6esk',
          ticketId: canonicalTicketId,
          error: error instanceof Error ? error.message : String(error),
        },
        'Failed to fetch customer history context'
      );
      return null;
    });
    this.rememberMergedAlias(ticket.merged_into_ticket_id ?? null, canonicalTicketId);
    const isPriority = this.isPriorityTicket(ticket.priority);
    const summary = isPriority ? null : this.buildRollingSummary(ticket, messages);
    const callContext = this.getCallContext(canonicalTicketId);
    const context: SixeskTicketContext = {
      ticket,
      messages,
      customerHistory: history?.history ?? [],
      customerProfile: history?.customer ?? null,
      summary,
      isPriority,
      callContext,
      fetchedAt: Date.now(),
    };
    this.ticketContextCache.set(canonicalTicketId, context);
    this.ticketContextCache.set(ticketId, context);
  }

  /** Get cached ticket context (populated by webhook handler) */
  getTicketContext(ticketId: string): SixeskTicketContext | null {
    const canonicalTicketId = this.resolveCanonicalTicketId(ticketId);
    return this.ticketContextCache.get(ticketId) ?? this.ticketContextCache.get(canonicalTicketId) ?? null;
  }

  /** Clear cached ticket context after processing */
  clearTicketContext(ticketId: string): void {
    const canonicalTicketId = this.resolveCanonicalTicketId(ticketId);
    this.ticketContextCache.delete(ticketId);
    this.ticketContextCache.delete(canonicalTicketId);
  }

  getTicketSummary(ticketId: string): SixeskTicketSummary | null {
    const canonicalTicketId = this.resolveCanonicalTicketId(ticketId);
    return this.ticketSummaries.get(ticketId) ?? this.ticketSummaries.get(canonicalTicketId) ?? null;
  }

  recordMergeSignal(payload: SixeskWebhookPayload): void {
    const sourceFromPayload = asTrimmedString(payload.resource?.ticket_id);
    const mergeMetadata = (payload.metadata?.merge ?? null) as Record<string, unknown> | null;
    const sourceTicketId =
      asTrimmedString(mergeMetadata?.sourceTicketId) ?? sourceFromPayload;
    const targetTicketId =
      asTrimmedString(mergeMetadata?.targetTicketId) ??
      asTrimmedString(payload.pointers?.targetTicketId) ??
      asTrimmedString(payload.pointers?.canonicalTicketId) ??
      null;

    this.rememberMergedAlias(sourceTicketId, targetTicketId);
    if (sourceTicketId) {
      this.mergeSignals.set(sourceTicketId, {
        eventType: payload.event_type,
        occurredAt: payload.occurred_at,
        targetTicketId,
        note: asTrimmedString(mergeMetadata?.reason) ?? asTrimmedString(payload.excerpt),
      });
    }
  }

  getMergeSignal(ticketId: string): MergeSignal | null {
    return this.mergeSignals.get(ticketId) ?? null;
  }

  clearMergeSignal(ticketId: string): void {
    this.mergeSignals.delete(ticketId);
  }

  async preflightTicketLink(sourceTicketId: string, targetTicketId: string): Promise<TicketLinkPreflight> {
    const url = `${this.sixeskConfig.baseUrl}/api/tickets/link/preflight`;
    const response = await this.fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: this.buildAgentHeaders(),
        body: JSON.stringify({ sourceTicketId, targetTicketId }),
      },
      `preflightTicketLink(${sourceTicketId},${targetTicketId})`
    );
    const data = (await response.json()) as { preflight: TicketLinkPreflight };
    return data.preflight;
  }

  private extractThreadId(pointer: string | undefined): string | null {
    if (!pointer) return null;
    const match = pointer.match(/\/threads\/([a-zA-Z0-9-]+)/);
    return match?.[1] ?? null;
  }

  private deriveCallStatus(eventType: string): string | null {
    if (!eventType.startsWith('ticket.call.')) return null;
    if (eventType.endsWith('.started')) return 'in_progress';
    if (eventType.endsWith('.ended')) return 'completed';
    if (eventType.endsWith('.failed')) return 'failed';
    if (eventType.endsWith('.queued')) return 'queued';
    if (eventType.endsWith('.received')) return 'received';
    return null;
  }

  private deriveCallDirection(eventType: string): 'inbound' | 'outbound' | null {
    if (eventType === 'ticket.call.received') return 'inbound';
    if (eventType === 'ticket.call.queued') return 'outbound';
    return null;
  }

  private async fetchTranscriptExcerpt(url: string): Promise<string | null> {
    if (!/^https?:\/\//i.test(url)) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const text = await response.text();
      const cleaned = normalizeWhitespace(text);
      if (!cleaned) return null;
      return cleaned.length > 1200 ? `${cleaned.slice(0, 1200)}...` : cleaned;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async recordCallEvent(payload: SixeskWebhookPayload): Promise<void> {
    const ticketId = asTrimmedString(payload.resource?.ticket_id);
    if (!ticketId) return;
    const canonicalTicketId = this.resolveCanonicalTicketId(ticketId);

    const call = (payload.call || {}) as Record<string, unknown>;
    const callSessionId =
      asTrimmedString(call.id) ??
      this.extractThreadId(payload.pointers?.thread) ??
      null;
    if (!callSessionId) return;

    const existing = this.callContexts.get(ticketId);
    const status = asTrimmedString(call.status) ?? this.deriveCallStatus(payload.event_type) ?? existing?.status ?? null;
    const direction = this.deriveCallDirection(payload.event_type) ?? existing?.direction ?? null;
    const durationSeconds =
      typeof call.durationSeconds === 'number' && Number.isFinite(call.durationSeconds)
        ? call.durationSeconds
        : existing?.durationSeconds ?? null;

    const transcriptUrl = asTrimmedString(call.transcriptUrl) ?? existing?.transcriptUrl ?? null;
    const transcriptR2Key = asTrimmedString(call.transcriptR2Key) ?? existing?.transcriptR2Key ?? null;
    const recordingUrl = asTrimmedString(call.recordingUrl) ?? existing?.recordingUrl ?? null;
    const recordingR2Key = asTrimmedString(call.recordingR2Key) ?? existing?.recordingR2Key ?? null;

    let transcriptExcerpt = existing?.transcriptExcerpt ?? null;
    if (!transcriptExcerpt && transcriptUrl && payload.event_type === 'ticket.call.transcript.ready') {
      transcriptExcerpt = await this.fetchTranscriptExcerpt(transcriptUrl);
    }

    const next: SixeskCallContext = {
      callSessionId,
      status,
      direction,
      toPhone: asTrimmedString(call.toPhone) ?? existing?.toPhone ?? null,
      fromPhone: asTrimmedString(call.fromPhone) ?? existing?.fromPhone ?? null,
      durationSeconds,
      recordingUrl,
      recordingR2Key,
      transcriptUrl,
      transcriptR2Key,
      transcriptExcerpt,
      updatedAt: Date.now(),
      eventType: payload.event_type,
    };

    this.callContexts.set(canonicalTicketId, next);
    this.callContexts.set(ticketId, next);
  }

  getCallContext(ticketId: string): SixeskCallContext | null {
    const canonicalTicketId = this.resolveCanonicalTicketId(ticketId);
    return this.callContexts.get(ticketId) ?? this.callContexts.get(canonicalTicketId) ?? null;
  }

  hasCallSummaryPosted(callSessionId: string): boolean {
    return this.callSummaryPosts.has(callSessionId);
  }

  markCallSummaryPosted(callSessionId: string): void {
    this.callSummaryPosts.set(callSessionId, Date.now());
  }

  get policyMode(): 'draft_only' | 'auto_send' {
    return this.sixeskConfig.policyMode;
  }

  get allowDirectMergeActions(): boolean {
    return this.sixeskConfig.allowDirectMergeActions;
  }

  get isConfigured(): boolean {
    return !!(
      this.sixeskConfig.baseUrl &&
      this.sixeskConfig.agentKey &&
      this.sixeskConfig.sharedSecret
    );
  }
}
