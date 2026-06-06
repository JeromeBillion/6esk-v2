import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  canManageTickets: vi.fn(),
  isLeadAdmin: vi.fn(),
  isWorkspaceModuleEnabled: vi.fn(),
  hasMailboxAccess: vi.fn(),
  findMailbox: vi.fn(),
  getOrCreateMailbox: vi.fn(),
  dbQuery: vi.fn(),
  putObject: vi.fn(),
  getTicketById: vi.fn(),
  sendTicketReply: vi.fn(),
  getTicketCallOptions: vi.fn(),
  resolveCallPhoneForRequest: vi.fn(),
  getLatestVoiceConsentState: vi.fn(),
  evaluateVoiceCallPolicy: vi.fn(),
  getHumanVoicePolicyFromEnv: vi.fn(),
  deliverPendingCallEvents: vi.fn(),
  queueOutboundCall: vi.fn(),
  queueWhatsAppSend: vi.fn(),
  recordAuditLog: vi.fn(),
  getWhatsAppWindowStatus: vi.fn(),
  recordModuleUsageEvent: vi.fn()
}));

const TENANT_ID = "00000000-0000-0000-0000-000000000001";

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  canManageTickets: mocks.canManageTickets,
  isLeadAdmin: mocks.isLeadAdmin
}));

vi.mock("@/server/workspace-modules", () => ({
  DEFAULT_WORKSPACE_KEY: "primary",
  isWorkspaceModuleEnabled: mocks.isWorkspaceModuleEnabled
}));

vi.mock("@/server/module-metering", () => ({
  recordModuleUsageEvent: mocks.recordModuleUsageEvent
}));

vi.mock("@/server/messages", () => ({
  hasMailboxAccess: mocks.hasMailboxAccess
}));

vi.mock("@/server/email/mailbox", () => ({
  findMailbox: mocks.findMailbox,
  getOrCreateMailbox: mocks.getOrCreateMailbox
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/storage/r2", () => ({
  putObject: mocks.putObject
}));

vi.mock("@/server/tickets", () => ({
  getTicketById: mocks.getTicketById
}));

vi.mock("@/server/email/replies", () => ({
  sendTicketReply: mocks.sendTicketReply
}));

vi.mock("@/server/calls/service", () => ({
  getTicketCallOptions: mocks.getTicketCallOptions,
  queueOutboundCall: mocks.queueOutboundCall,
  resolveCallPhoneForRequest: mocks.resolveCallPhoneForRequest
}));

vi.mock("@/server/calls/consent", () => ({
  getLatestVoiceConsentState: mocks.getLatestVoiceConsentState
}));

vi.mock("@/server/calls/policy", () => ({
  evaluateVoiceCallPolicy: mocks.evaluateVoiceCallPolicy,
  getHumanVoicePolicyFromEnv: mocks.getHumanVoicePolicyFromEnv
}));

vi.mock("@/server/calls/outbox", () => ({
  deliverPendingCallEvents: mocks.deliverPendingCallEvents
}));

vi.mock("@/server/whatsapp/send", () => ({
  queueWhatsAppSend: mocks.queueWhatsAppSend
}));

vi.mock("@/server/audit", () => ({
  recordAuditLog: mocks.recordAuditLog
}));

vi.mock("@/server/whatsapp/window", () => ({
  getWhatsAppWindowStatus: mocks.getWhatsAppWindowStatus
}));

import { POST as postEmailSend } from "@/app/api/email/send/route";
import { POST as postWhatsAppSend } from "@/app/api/whatsapp/send/route";
import { POST as postCallOutbound } from "@/app/api/calls/outbound/route";
import { POST as postTicketReply } from "@/app/api/tickets/[ticketId]/replies/route";

function buildUser() {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "agent@6ex.co.za",
    display_name: "Agent",
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: "agent",
    tenant_id: TENANT_ID
  };
}

describe("channel module guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.canManageTickets.mockReturnValue(true);
    mocks.isLeadAdmin.mockReturnValue(false);
    mocks.hasMailboxAccess.mockResolvedValue(true);
    mocks.findMailbox.mockResolvedValue(null);
    mocks.getOrCreateMailbox.mockResolvedValue({ id: "mailbox-1", tenant_id: TENANT_ID });
    mocks.getTicketById.mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      tenant_id: TENANT_ID,
      mailbox_id: "mailbox-1",
      assigned_user_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      requester_email: "customer@example.com",
      metadata: null
    });
    mocks.sendTicketReply.mockResolvedValue({ messageId: "message-1" });
    mocks.getTicketCallOptions.mockResolvedValue({ candidates: [], selectionRequired: false });
    mocks.resolveCallPhoneForRequest.mockReturnValue({
      status: "selection_required",
      errorCode: "selection_required",
      detail: "Choose a number",
      defaultCandidateId: null,
      candidates: []
    });
    mocks.getLatestVoiceConsentState.mockResolvedValue(null);
    mocks.evaluateVoiceCallPolicy.mockResolvedValue({ allowed: true });
    mocks.getHumanVoicePolicyFromEnv.mockReturnValue({});
    mocks.deliverPendingCallEvents.mockResolvedValue(undefined);
    mocks.queueOutboundCall.mockResolvedValue({
      status: "queued",
      callSessionId: "call-session-1",
      messageId: "message-1",
      toPhone: "+27123456789",
      idempotent: false
    });
    mocks.recordAuditLog.mockResolvedValue(undefined);
    mocks.recordModuleUsageEvent.mockResolvedValue(undefined);
    mocks.queueWhatsAppSend.mockResolvedValue(undefined);
    mocks.getWhatsAppWindowStatus.mockResolvedValue({ isOpen: true });
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(true);
  });

  it("blocks /api/email/send when email module is disabled", async () => {
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(false);

    const response = await postEmailSend(
      new Request("http://localhost/api/email/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          from: "support@6ex.co.za",
          to: ["customer@example.com"],
          subject: "Hello",
          text: "Hi"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "module_disabled",
      module: "email"
    });
    expect(mocks.findMailbox).not.toHaveBeenCalled();
  });

  it("blocks /api/whatsapp/send when WhatsApp module is disabled", async () => {
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(false);

    const response = await postWhatsAppSend(
      new Request("http://localhost/api/whatsapp/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticketId: "11111111-1111-1111-1111-111111111111",
          to: "+27123456789",
          text: "Hello"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "module_disabled",
      module: "whatsapp"
    });
    expect(mocks.queueWhatsAppSend).not.toHaveBeenCalled();
  });

  it("blocks /api/calls/outbound when voice module is disabled", async () => {
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(false);

    const response = await postCallOutbound(
      new Request("http://localhost/api/calls/outbound", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticketId: "11111111-1111-1111-1111-111111111111",
          reason: "Follow up"
        })
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "module_disabled",
      module: "voice"
    });
    expect(mocks.getTicketCallOptions).not.toHaveBeenCalled();
  });

  it("blocks ticket replies when the inferred email module is disabled", async () => {
    mocks.isWorkspaceModuleEnabled.mockImplementation(async (moduleKey: string) => moduleKey !== "email");

    const response = await postTicketReply(
      new Request("http://localhost/api/tickets/11111111-1111-1111-1111-111111111111/replies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "Reply body"
        })
      }),
      { params: Promise.resolve({ ticketId: "11111111-1111-1111-1111-111111111111" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      code: "module_disabled",
      module: "email"
    });
    expect(mocks.sendTicketReply).not.toHaveBeenCalled();
  });

  it("records metering when ticket replies are sent successfully", async () => {
    const response = await postTicketReply(
      new Request("http://localhost/api/tickets/11111111-1111-1111-1111-111111111111/replies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "Reply body"
        })
      }),
      { params: Promise.resolve({ ticketId: "11111111-1111-1111-1111-111111111111" }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.recordModuleUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleKey: "email",
        usageKind: "reply_sent",
        actorType: "human"
      })
    );
  });

  it("records metering for direct WhatsApp sends", async () => {
    const response = await postWhatsAppSend(
      new Request("http://localhost/api/whatsapp/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticketId: "11111111-1111-1111-1111-111111111111",
          to: "+27123456789",
          text: "Hello"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.recordModuleUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleKey: "whatsapp",
        usageKind: "direct_send",
        actorType: "human"
      })
    );
  });

  it("records metering for outbound calls", async () => {
    mocks.resolveCallPhoneForRequest.mockReturnValue({
      status: "resolved",
      phone: "+27123456789",
      selectedCandidateId: "candidate-1"
    });

    const response = await postCallOutbound(
      new Request("http://localhost/api/calls/outbound", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticketId: "11111111-1111-1111-1111-111111111111",
          reason: "Follow up"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.recordModuleUsageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleKey: "voice",
        usageKind: "call_queued",
        actorType: "human"
      })
    );
  });
});
