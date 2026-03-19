import { apiFetch } from "@/app/lib/api/http";

export type ApiTicket = {
  id: string;
  requester_email: string;
  subject: string | null;
  category: string | null;
  metadata: Record<string, unknown> | null;
  tags?: string[];
  has_whatsapp?: boolean;
  has_voice?: boolean;
  status: "new" | "open" | "pending" | "solved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  assigned_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ApiTicketMessage = {
  id: string;
  direction: "inbound" | "outbound";
  channel: "email" | "whatsapp" | "voice";
  origin: "human" | "ai";
  from_email: string;
  to_emails: string[] | null;
  subject: string | null;
  preview_text: string | null;
  received_at: string | null;
  sent_at: string | null;
  wa_status?: string | null;
  wa_timestamp?: string | null;
};

export type ApiTicketEvent = {
  id: string;
  event_type: string;
  actor_user_id: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
};

export type ApiDraft = {
  id: string;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  confidence: number | null;
  status: string;
  created_at: string;
};

export type TicketDetailsResponse = {
  ticket: ApiTicket;
  messages: ApiTicketMessage[];
  events: ApiTicketEvent[];
  drafts: ApiDraft[];
  auditLogs?: Array<{
    id: string;
    action: string;
    entity_type: string;
    entity_id: string | null;
    data: Record<string, unknown> | null;
    created_at: string;
    actor_name: string | null;
    actor_email: string | null;
  }>;
};

export type ApiMessageDetail = {
  message: {
    id: string;
    subject?: string | null;
    from: string;
    to: string[];
    direction?: "inbound" | "outbound";
    channel?: "email" | "whatsapp" | "voice";
    origin?: "human" | "ai";
    receivedAt: string | null;
    sentAt: string | null;
    waStatus: string | null;
    waTimestamp?: string | null;
    waContact?: string | null;
    conversationId?: string | null;
    provider?: string | null;
    text: string | null;
    html: string | null;
    aiMeta: Record<string, unknown> | null;
    callSession: {
      status: string;
      durationSeconds: number | null;
      recordingUrl?: string | null;
    } | null;
    transcript: { text: string | null } | null;
    statusEvents: Array<{ status: string }>;
  };
  attachments: Array<{
    id: string;
    filename: string;
    content_type: string | null;
    size_bytes: number | null;
  }>;
};

export type CustomerHistoryResponse = {
  customer: {
    id: string;
    kind: "registered" | "unregistered";
    external_system: string | null;
    external_user_id: string | null;
    display_name: string | null;
    primary_email: string | null;
    primary_phone: string | null;
    merged_into_customer_id: string | null;
    merged_at: string | null;
    identities: Array<{
      type: "email" | "phone";
      value: string;
      isPrimary: boolean;
    }>;
  } | null;
  history: Array<{
    ticketId: string;
    subject: string | null;
    status: string;
    channel: "email" | "whatsapp" | "voice";
    lastMessageAt: string | null;
    lastCustomerInboundAt: string | null;
  }>;
};

export type CustomerProfilePatchInput = {
  displayName?: string | null;
  primaryEmail?: string | null;
  primaryPhone?: string | null;
  ticketId?: string | null;
};

export type SupportMacro = {
  id: string;
  title: string;
  category: string | null;
  body: string;
  is_active: boolean;
};

export type SupportSavedView = {
  id: string;
  name: string;
  filters: {
    status?: "all" | "open" | "pending" | "resolved" | "closed";
    priority?: "all" | "low" | "medium" | "high" | "urgent";
    channel?: "all" | "email" | "whatsapp" | "voice";
    tag?: string;
    assigned?: "mine" | "any";
    query?: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type TicketCallCandidate = {
  candidateId: string;
  phone: string;
  label: string;
  source: "customer_primary" | "customer_identity" | "ticket_metadata" | "ticket_requester";
  isPrimary: boolean;
};

export type TicketCallOptions = {
  ticketId: string;
  selectionRequired: boolean;
  defaultCandidateId: string | null;
  canManualDial: boolean;
  candidates: TicketCallCandidate[];
  consent: {
    allowed: boolean;
    status: string;
    reason: string | null;
    updatedAt: string | null;
    source: string | null;
  };
};

export type QueueOutboundCallResponse =
  | {
      status: "queued";
      callSessionId: string;
      messageId: string;
      toPhone: string;
      idempotent: boolean;
    }
  | {
      status: "selection_required";
      errorCode: "selection_required";
      detail: string;
      defaultCandidateId: string | null;
      candidates: TicketCallCandidate[];
    }
  | {
      status: "blocked" | "failed";
      errorCode?: string;
      detail: string;
    };

export async function listTickets(input?: {
  status?: "open" | "pending" | "resolved" | "closed";
  priority?: "low" | "medium" | "high" | "urgent";
  tag?: string;
  channel?: "email" | "whatsapp" | "voice";
  assigned?: "all" | "mine";
  query?: string;
  signal?: AbortSignal;
}) {
  const params = new URLSearchParams();
  if (input?.status) {
    params.set("status", input.status === "resolved" ? "solved" : input.status);
  }
  if (input?.priority) {
    params.set("priority", input.priority === "medium" ? "normal" : input.priority);
  }
  if (input?.tag?.trim()) {
    params.set("tag", input.tag.trim());
  }
  if (input?.channel) {
    params.set("channel", input.channel);
  }
  if (input?.assigned === "mine") {
    params.set("assigned", "mine");
  }
  if (input?.query?.trim()) {
    params.set("q", input.query.trim());
  }
  const queryString = params.toString();
  const payload = await apiFetch<{ tickets: ApiTicket[] }>(
    `/api/tickets${queryString ? `?${queryString}` : ""}`,
    { signal: input?.signal }
  );
  return payload.tickets ?? [];
}

export function getTicketDetails(ticketId: string, signal?: AbortSignal) {
  return apiFetch<TicketDetailsResponse>(`/api/tickets/${ticketId}`, { signal });
}

export function getMessageDetail(messageId: string, signal?: AbortSignal) {
  return apiFetch<ApiMessageDetail>(`/api/messages/${messageId}`, { signal });
}

export function getTicketCustomerHistory(ticketId: string, limit = 30, signal?: AbortSignal) {
  return apiFetch<CustomerHistoryResponse>(`/api/tickets/${ticketId}/customer-history?limit=${limit}`, {
    signal
  });
}

export function patchCustomerProfile(customerId: string, input: CustomerProfilePatchInput) {
  return apiFetch<{
    customer: CustomerHistoryResponse["customer"];
  }>(`/api/customers/${customerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function patchTicket(
  ticketId: string,
  patch: Partial<{
    status: ApiTicket["status"];
    priority: ApiTicket["priority"];
    assignedUserId: string | null;
    category: string;
    metadata: Record<string, unknown>;
  }>
) {
  return apiFetch<{ ticket: ApiTicket }>(`/api/tickets/${ticketId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
}

export function sendTicketReply(
  ticketId: string,
  input: {
    text?: string | null;
    html?: string | null;
    subject?: string | null;
    recipient?: string | null;
    template?: {
      name: string;
      language: string;
      components?: Array<Record<string, unknown>>;
    } | null;
    attachments?: Array<{
      filename: string;
      contentType?: string | null;
      size?: number | null;
      contentBase64: string;
    }> | null;
  }
) {
  return apiFetch<{ status: string }>(`/api/tickets/${ticketId}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function patchTicketDraft(ticketId: string, draftId: string, status: "used" | "dismissed") {
  return apiFetch<{ status: string }>(`/api/tickets/${ticketId}/drafts/${draftId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
}

export function patchTicketTags(
  ticketId: string,
  input: { addTags?: string[]; removeTags?: string[] }
) {
  return apiFetch<{ status: string }>(`/api/tickets/${ticketId}/tags`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function patchTicketsBulk(input: {
  ticketIds: string[];
  status?: ApiTicket["status"];
  priority?: ApiTicket["priority"];
  assignedUserId?: string | null;
  addTags?: string[];
  removeTags?: string[];
}) {
  return apiFetch<{ status: string; updatedTicketIds: string[]; updatedCount: number }>("/api/tickets/bulk", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function listSupportMacros(signal?: AbortSignal) {
  return apiFetch<{ macros: SupportMacro[] }>("/api/support/macros", { signal }).then(
    (payload) => payload.macros ?? []
  );
}

export function listSupportSavedViews(signal?: AbortSignal) {
  return apiFetch<{ views: SupportSavedView[] }>("/api/support/saved-views", { signal }).then(
    (payload) => payload.views ?? []
  );
}

export function createSupportSavedView(input: {
  name: string;
  filters: SupportSavedView["filters"];
}) {
  return apiFetch<{ view: SupportSavedView }>("/api/support/saved-views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function deleteSupportSavedView(viewId: string) {
  return apiFetch<{ status: string }>(`/api/support/saved-views/${viewId}`, {
    method: "DELETE"
  });
}

export function getTicketCallOptions(ticketId: string, signal?: AbortSignal) {
  return apiFetch<TicketCallOptions>(`/api/tickets/${ticketId}/call-options`, { signal });
}

export function queueOutboundCall(input: {
  ticketId: string;
  candidateId?: string | null;
  toPhone?: string | null;
  fromPhone?: string | null;
  reason: string;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  return apiFetch<QueueOutboundCallResponse>("/api/calls/outbound", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function sendWhatsAppMessage(input: {
  ticketId?: string | null;
  to: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    contentType?: string | null;
    size?: number | null;
    contentBase64: string;
  }> | null;
  template?: {
    name: string;
    language: string;
    components?: Array<Record<string, unknown>>;
  } | null;
}) {
  return apiFetch<{ status: string }>("/api/whatsapp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function resendWhatsAppMessage(messageId: string) {
  return apiFetch<{ status: string }>(`/api/messages/${messageId}/whatsapp-resend`, {
    method: "POST"
  });
}
