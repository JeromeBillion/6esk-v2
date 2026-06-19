import { beforeEach, describe, expect, it, vi } from "vitest";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const MAILBOX_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  canManageTickets: vi.fn(),
  isLeadAdmin: vi.fn(),
  getCustomerById: vi.fn(),
  listCustomerIdentities: vi.fn(),
  updateCustomerProfile: vi.fn(),
  attachCustomerToTicket: vi.fn(),
  listCustomerHistory: vi.fn(),
  resolveOrCreateCustomerForInbound: vi.fn(),
  getTicketById: vi.fn(),
  recordTicketEvent: vi.fn(),
  addTagsToTicket: vi.fn(),
  removeTagsFromTicket: vi.fn(),
  getMessageById: vi.fn(),
  getTicketAssignment: vi.fn(),
  hasMailboxAccess: vi.fn(),
  dbQuery: vi.fn(),
  recordAuditLog: vi.fn(),
  getDraftById: vi.fn(),
  updateDraftContent: vi.fn(),
  updateDraftStatus: vi.fn(),
  sendTicketReply: vi.fn(),
  checkModuleEntitlement: vi.fn(),
  recordModuleUsageEvent: vi.fn(),
  getObjectBuffer: vi.fn(),
  getWhatsAppWindowStatus: vi.fn(),
  getTicketCallOptions: vi.fn(),
  listInboxMailboxesForUser: vi.fn(),
  upsertMailDraft: vi.fn(),
  deleteMailDraft: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  createOutboundEmailTicket: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  canManageTickets: mocks.canManageTickets,
  isLeadAdmin: mocks.isLeadAdmin
}));

vi.mock("@/server/customers", () => ({
  CustomerIdentityConflictError: class CustomerIdentityConflictError extends Error {},
  getCustomerById: mocks.getCustomerById,
  listCustomerIdentities: mocks.listCustomerIdentities,
  updateCustomerProfile: mocks.updateCustomerProfile,
  attachCustomerToTicket: mocks.attachCustomerToTicket,
  listCustomerHistory: mocks.listCustomerHistory,
  resolveOrCreateCustomerForInbound: mocks.resolveOrCreateCustomerForInbound
}));

vi.mock("@/server/tickets", () => ({
  getTicketById: mocks.getTicketById,
  recordTicketEvent: mocks.recordTicketEvent,
  addTagsToTicket: mocks.addTagsToTicket,
  removeTagsFromTicket: mocks.removeTagsFromTicket
}));

vi.mock("@/server/messages", () => ({
  getMessageById: mocks.getMessageById,
  getTicketAssignment: mocks.getTicketAssignment,
  hasMailboxAccess: mocks.hasMailboxAccess
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/agents/drafts", () => ({
  getDraftById: mocks.getDraftById,
  updateDraftContent: mocks.updateDraftContent,
  updateDraftStatus: mocks.updateDraftStatus
}));

vi.mock("@/server/email/replies", () => ({
  sendTicketReply: mocks.sendTicketReply
}));

vi.mock("@/server/tenant/module-guard", () => ({
  checkModuleEntitlement: mocks.checkModuleEntitlement
}));

vi.mock("@/server/module-metering", () => ({
  recordModuleUsageEvent: mocks.recordModuleUsageEvent,
  resolveAiProviderMode: vi.fn(() => "mock")
}));

vi.mock("@/server/storage/r2", () => ({
  getObjectBuffer: mocks.getObjectBuffer
}));

vi.mock("@/server/whatsapp/window", () => ({
  getWhatsAppWindowStatus: mocks.getWhatsAppWindowStatus
}));

vi.mock("@/server/calls/service", () => ({
  getTicketCallOptions: mocks.getTicketCallOptions
}));

vi.mock("@/server/mailboxes", () => ({
  listInboxMailboxesForUser: mocks.listInboxMailboxesForUser
}));

vi.mock("@/server/email/drafts", () => ({
  upsertMailDraft: mocks.upsertMailDraft,
  deleteMailDraft: mocks.deleteMailDraft
}));

vi.mock("@/server/agents/outbox", () => ({
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents
}));

vi.mock("@/server/tickets/outbound-email", () => ({
  createOutboundEmailTicket: mocks.createOutboundEmailTicket
}));

import { PATCH as patchCustomerProfile } from "@/app/api/customers/[customerId]/route";
import { PATCH as patchMessageSpam } from "@/app/api/messages/[messageId]/spam/route";
import { POST as postWhatsAppResend } from "@/app/api/messages/[messageId]/whatsapp-resend/route";
import { GET as getMailboxes } from "@/app/api/mailboxes/route";
import { GET as getMailboxMessages } from "@/app/api/mailboxes/[mailboxId]/messages/route";
import { POST as postMailboxDraft } from "@/app/api/mailboxes/[mailboxId]/drafts/route";
import { DELETE as deleteMailboxDraft } from "@/app/api/mailboxes/[mailboxId]/drafts/[draftId]/route";
import { POST as postBulkEmail } from "@/app/api/tickets/bulk-email/route";
import { GET as getTicketCallOptionsRoute } from "@/app/api/tickets/[ticketId]/call-options/route";
import { GET as getCustomerHistory } from "@/app/api/tickets/[ticketId]/customer-history/route";
import { PATCH as patchTicketTags } from "@/app/api/tickets/[ticketId]/tags/route";
import { PATCH as patchTicketDraft } from "@/app/api/tickets/[ticketId]/drafts/[draftId]/route";
import { POST as sendTicketDraft } from "@/app/api/tickets/[ticketId]/drafts/[draftId]/send/route";

function tenantlessUser() {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "agent@example.com",
    display_name: "Agent",
    role_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    role_name: "agent",
    tenant_id: null
  };
}

function tenantUser() {
  return {
    ...tenantlessUser(),
    tenant_id: "99999999-9999-4999-8999-999999999999"
  };
}

async function expectForbidden(response: Response) {
  const body = await response.json();
  expect(response.status).toBe(403);
  expect(body).toMatchObject({ error: "Forbidden" });
}

describe("CRM route tenant session boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(tenantlessUser());
    mocks.canManageTickets.mockReturnValue(true);
    mocks.isLeadAdmin.mockReturnValue(true);
  });

  it("rejects customer profile updates before customer lookup", async () => {
    const response = await patchCustomerProfile(
      new Request(`http://localhost/api/customers/${CUSTOMER_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: "Updated" })
      }),
      { params: Promise.resolve({ customerId: CUSTOMER_ID }) }
    );

    await expectForbidden(response);
    expect(mocks.getCustomerById).not.toHaveBeenCalled();
  });

  it("rejects customer history reads before ticket lookup", async () => {
    const response = await getCustomerHistory(
      new Request(`http://localhost/api/tickets/${TICKET_ID}/customer-history`),
      { params: Promise.resolve({ ticketId: TICKET_ID }) }
    );

    await expectForbidden(response);
    expect(mocks.getTicketById).not.toHaveBeenCalled();
  });

  it("rejects message spam mutation before message lookup", async () => {
    const response = await patchMessageSpam(
      new Request(`http://localhost/api/messages/${MESSAGE_ID}/spam`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isSpam: true })
      }),
      { params: Promise.resolve({ messageId: MESSAGE_ID }) }
    );

    await expectForbidden(response);
    expect(mocks.getMessageById).not.toHaveBeenCalled();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("rejects WhatsApp resend before entitlement or message lookup", async () => {
    const response = await postWhatsAppResend(
      new Request(`http://localhost/api/messages/${MESSAGE_ID}/whatsapp-resend`, {
        method: "POST"
      }),
      { params: Promise.resolve({ messageId: MESSAGE_ID }) }
    );

    await expectForbidden(response);
    expect(mocks.checkModuleEntitlement).not.toHaveBeenCalled();
    expect(mocks.getMessageById).not.toHaveBeenCalled();
  });

  it("rejects mailbox draft save/delete before mailbox access lookup", async () => {
    const saveResponse = await postMailboxDraft(
      new Request(`http://localhost/api/mailboxes/${MAILBOX_ID}/drafts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: "Draft" })
      }),
      { params: Promise.resolve({ mailboxId: MAILBOX_ID }) }
    );
    const deleteResponse = await deleteMailboxDraft(
      new Request(`http://localhost/api/mailboxes/${MAILBOX_ID}/drafts/${DRAFT_ID}`, {
        method: "DELETE"
      }),
      { params: Promise.resolve({ mailboxId: MAILBOX_ID, draftId: DRAFT_ID }) }
    );

    await expectForbidden(saveResponse);
    await expectForbidden(deleteResponse);
    expect(mocks.listInboxMailboxesForUser).not.toHaveBeenCalled();
    expect(mocks.upsertMailDraft).not.toHaveBeenCalled();
    expect(mocks.deleteMailDraft).not.toHaveBeenCalled();
  });

  it("rejects mailbox listing and message reads before mailbox access lookup", async () => {
    const listResponse = await getMailboxes();
    const messagesResponse = await getMailboxMessages(
      new Request(`http://localhost/api/mailboxes/${MAILBOX_ID}/messages`),
      { params: Promise.resolve({ mailboxId: MAILBOX_ID }) }
    );

    await expectForbidden(listResponse);
    await expectForbidden(messagesResponse);
    expect(mocks.listInboxMailboxesForUser).not.toHaveBeenCalled();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("filters mailbox message reads by tenant after mailbox authorization", async () => {
    mocks.getSessionUser.mockResolvedValue(tenantUser());
    mocks.listInboxMailboxesForUser.mockResolvedValue([{ id: MAILBOX_ID }]);
    mocks.dbQuery.mockResolvedValue({ rows: [] });

    const response = await getMailboxMessages(
      new Request(`http://localhost/api/mailboxes/${MAILBOX_ID}/messages`),
      { params: Promise.resolve({ mailboxId: MAILBOX_ID }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("m.tenant_id = $2"),
      [MAILBOX_ID, "99999999-9999-4999-8999-999999999999"]
    );
    expect(mocks.dbQuery.mock.calls[0]?.[0]).toContain("a.tenant_id = $2");
  });

  it("rejects bulk email before entitlement or ticket selection", async () => {
    const response = await postBulkEmail(
      new Request("http://localhost/api/tickets/bulk-email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticketIds: [TICKET_ID],
          subject: "Update",
          text: "Body"
        })
      })
    );

    await expectForbidden(response);
    expect(mocks.checkModuleEntitlement).not.toHaveBeenCalled();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("rejects call options before ticket and call-option lookup", async () => {
    const response = await getTicketCallOptionsRoute(
      new Request(`http://localhost/api/tickets/${TICKET_ID}/call-options`),
      { params: Promise.resolve({ ticketId: TICKET_ID }) }
    );

    await expectForbidden(response);
    expect(mocks.getTicketById).not.toHaveBeenCalled();
    expect(mocks.getTicketCallOptions).not.toHaveBeenCalled();
  });

  it("rejects tag and AI draft mutations before ticket lookup", async () => {
    const tagsResponse = await patchTicketTags(
      new Request(`http://localhost/api/tickets/${TICKET_ID}/tags`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addTags: ["urgent"] })
      }),
      { params: Promise.resolve({ ticketId: TICKET_ID }) }
    );
    const draftResponse = await patchTicketDraft(
      new Request(`http://localhost/api/tickets/${TICKET_ID}/drafts/${DRAFT_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "dismissed" })
      }),
      { params: Promise.resolve({ ticketId: TICKET_ID, draftId: DRAFT_ID }) }
    );
    const sendResponse = await sendTicketDraft(
      new Request(`http://localhost/api/tickets/${TICKET_ID}/drafts/${DRAFT_ID}/send`, {
        method: "POST"
      }),
      { params: Promise.resolve({ ticketId: TICKET_ID, draftId: DRAFT_ID }) }
    );

    await expectForbidden(tagsResponse);
    await expectForbidden(draftResponse);
    await expectForbidden(sendResponse);
    expect(mocks.getTicketById).not.toHaveBeenCalled();
    expect(mocks.getDraftById).not.toHaveBeenCalled();
    expect(mocks.sendTicketReply).not.toHaveBeenCalled();
  });
});
