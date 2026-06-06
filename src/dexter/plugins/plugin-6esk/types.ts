/** Event types delivered by 6esk agent outbox */
export type SixeskEventType =
  | 'ticket.created'
  | 'ticket.message.created'
  | 'ticket.status.changed'
  | 'ticket.merged'
  | 'ticket.linked_case'
  | 'ticket.call.received'
  | 'ticket.call.queued'
  | 'ticket.call.started'
  | 'ticket.call.ended'
  | 'ticket.call.failed'
  | 'ticket.call.recording.ready'
  | 'ticket.call.transcript.ready'
  | 'customer.merged'
  | 'customer.identity.resolved'
  | 'merge.review.required';

/** Webhook payload from 6esk outbox delivery (mirrors AgentEventPayload in 6esk) */
export interface SixeskWebhookPayload {
  event_id: string;
  event_type: SixeskEventType;
  occurred_at: string;
  org_id: string;
  resource: {
    ticket_id?: string | null;
    message_id?: string | null;
    mailbox_id?: string | null;
  };
  actor: { type: 'system' | 'user'; id?: string | null };
  conversation_ref?: string | null;
  excerpt?: string | null;
  pointers?: Record<string, string>;
  metadata?: Record<string, unknown> | null;
  call?: SixeskCallPayload | null;
}

/** Ticket from GET /api/agent/v1/tickets/{id} */
export interface SixeskTicket {
  id: string;
  subject: string | null;
  status: string;
  priority: string;
  category: string | null;
  requester_email: string;
  assigned_user_id: string | null;
  mailbox_id: string | null;
  metadata: Record<string, unknown> | null;
  merged_into_ticket_id?: string | null;
  merged_at?: string | null;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

/** Customer history row from GET /api/tickets/{ticketId}/customer-history */
export interface SixeskCustomerHistoryItem {
  ticketId: string;
  subject: string | null;
  status: string;
  priority: string;
  requesterEmail: string;
  channel: 'email' | 'whatsapp' | 'voice';
  lastMessageAt: string | null;
  lastCustomerInboundPreview: string | null;
  lastCustomerInboundAt: string | null;
}

export interface SixeskCustomerIdentity {
  type: 'email' | 'phone';
  value: string;
  isPrimary: boolean;
}

export interface SixeskCustomerProfile {
  id: string;
  kind: 'registered' | 'unregistered';
  external_system: string | null;
  external_user_id: string | null;
  display_name: string | null;
  primary_email: string | null;
  primary_phone: string | null;
  merged_into_customer_id: string | null;
  merged_at: string | null;
  identities?: SixeskCustomerIdentity[];
}

export interface SixeskCustomerHistoryResponse {
  customer: SixeskCustomerProfile | null;
  history: SixeskCustomerHistoryItem[];
  nextCursor: string | null;
}

/** Message from GET /api/agent/v1/tickets/{id}/messages (camelCase per 6esk API) */
export interface SixeskMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  channel: 'email' | 'whatsapp' | 'voice';
  origin: 'human' | 'ai';
  from: string;
  to: string[];
  subject: string | null;
  receivedAt: string | null;
  sentAt: string | null;
  text: string | null;
  html: string | null;
}

export interface SixeskCallPayload {
  id?: string | null;
  status?: string | null;
  toPhone?: string | null;
  fromPhone?: string | null;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  recordingR2Key?: string | null;
  transcriptUrl?: string | null;
  transcriptR2Key?: string | null;
}

export interface SixeskCallConsentState {
  state: 'granted' | 'revoked' | 'unknown';
  callbackPhone: string | null;
  termsVersion: string | null;
  source: string | null;
  updatedAt: string | null;
  identityType: 'phone' | 'email' | null;
  identityValue: string | null;
  customerId: string | null;
}

export interface SixeskCallCandidate {
  candidateId: string;
  phone: string;
  label: string;
  source: 'customer_primary' | 'customer_identity' | 'ticket_metadata' | 'ticket_requester';
  isPrimary: boolean;
}

export interface SixeskTicketCallOptions {
  ticketId: string;
  selectionRequired: boolean;
  defaultCandidateId: string | null;
  canManualDial: boolean;
  candidates: SixeskCallCandidate[];
  consent: SixeskCallConsentState;
}

/** Action types accepted by POST /api/agent/v1/actions */
export type SixeskActionType =
  | 'draft_reply'
  | 'send_reply'
  | 'initiate_call'
  | 'set_tags'
  | 'set_priority'
  | 'assign_to'
  | 'request_human_review'
  | 'merge_tickets'
  | 'link_tickets'
  | 'merge_customers'
  | 'propose_merge';

/** Single action to submit to 6esk */
export interface SixeskAction {
  type: SixeskActionType;
  ticketId: string;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  candidateId?: string | null;
  toPhone?: string | null;
  fromPhone?: string | null;
  idempotencyKey?: string | null;
  tags?: string[] | null;
  priority?: 'low' | 'normal' | 'high' | 'urgent' | null;
  assignedUserId?: string | null;
  sourceTicketId?: string | null;
  targetTicketId?: string | null;
  sourceCustomerId?: string | null;
  targetCustomerId?: string | null;
  reason?: string | null;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
}

/** Runtime configuration for the 6esk plugin */
export interface SixeskConfig {
  baseUrl: string;
  agentKey: string;
  sharedSecret: string;
  policyMode: 'draft_only' | 'auto_send';
  allowDirectMergeActions: boolean;
  minMergeConfidence: number;
}

/** Cached ticket context */
export interface SixeskTicketContext {
  ticket: SixeskTicket;
  messages: SixeskMessage[];
  customerHistory?: SixeskCustomerHistoryItem[];
  customerProfile?: SixeskCustomerProfile | null;
  summary?: SixeskTicketSummary | null;
  isPriority?: boolean;
  callContext?: SixeskCallContext | null;
  fetchedAt: number;
}

/** Rolling summary persisted per ticket to trim long threads */
export interface SixeskTicketSummary {
  text: string;
  updatedAt: number;
  lastMessageId: string | null;
  totalMessages: number;
}

export interface SixeskCallContext {
  callSessionId: string;
  status?: string | null;
  direction?: 'inbound' | 'outbound' | null;
  toPhone?: string | null;
  fromPhone?: string | null;
  durationSeconds?: number | null;
  recordingUrl?: string | null;
  recordingR2Key?: string | null;
  transcriptUrl?: string | null;
  transcriptR2Key?: string | null;
  transcriptExcerpt?: string | null;
  updatedAt: number;
  eventType?: string | null;
}

export interface TicketMergePreflight {
  sourceTicketId: string;
  targetTicketId: string;
  sourceCustomerId?: string | null;
  targetCustomerId?: string | null;
  sourceChannel: 'email' | 'whatsapp' | 'voice';
  targetChannel: 'email' | 'whatsapp' | 'voice';
  allowed: boolean;
  blockingCode: 'already_merged' | 'cross_channel_not_allowed' | 'too_large' | null;
  blockingReason: string | null;
}

export interface TicketLinkPreflight {
  sourceTicketId: string;
  targetTicketId: string;
  sourceCustomerId?: string | null;
  targetCustomerId?: string | null;
  sourceChannel: 'email' | 'whatsapp' | 'voice';
  targetChannel: 'email' | 'whatsapp' | 'voice';
  recommendedAction: 'merge_ticket' | 'linked_case';
  allowed: boolean;
  blockingCode: 'already_merged' | 'already_linked' | null;
  blockingReason: string | null;
}

export interface CustomerMergePreflight {
  sourceCustomerId: string;
  targetCustomerId: string;
  allowed: boolean;
  blockingCode: 'already_merged' | null;
  blockingReason: string | null;
}
