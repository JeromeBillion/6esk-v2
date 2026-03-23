import { apiFetch } from "@/app/lib/api/http";

export type CreateTicketAttachmentInput = {
  filename: string;
  contentType?: string | null;
  contentBase64: string;
};

export type CreateTicketInput = {
  contactMode?: "email" | "whatsapp" | "call";
  to?: string;
  toPhone?: string;
  subject: string;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
  metadata?: Record<string, unknown> | null;
  attachments?: CreateTicketAttachmentInput[] | null;
};

export type CreateTicketSuccessResponse =
  | {
      status: "created";
      ticketId: string;
      messageId: string | null;
      channel?: "email";
    }
  | {
      status: "created";
      ticketId: string;
      messageId: string | null;
      channel: "whatsapp";
    }
  | {
      status: "created";
      ticketId: string;
      messageId: string;
      callSessionId: string;
      channel: "voice";
    };

export function createTicket(input: CreateTicketInput) {
  return apiFetch<CreateTicketSuccessResponse>("/api/tickets/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}
