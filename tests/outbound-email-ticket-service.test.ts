import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOrCreateMailbox: vi.fn(),
  addTagsToTicket: vi.fn(),
  createTicket: vi.fn(),
  inferTagsFromText: vi.fn(),
  recordTicketEvent: vi.fn(),
  resolveOrCreateCustomerForInbound: vi.fn(),
  syncVoiceConsentFromMetadata: vi.fn(),
  sendTicketReply: vi.fn(),
  buildAgentEvent: vi.fn(),
  deliverPendingAgentEvents: vi.fn(),
  enqueueAgentEvent: vi.fn(),
  runInBackground: vi.fn()
}));

vi.mock("@/server/email/mailbox", () => ({
  getOrCreateMailbox: mocks.getOrCreateMailbox
}));

vi.mock("@/server/tickets", () => ({
  addTagsToTicket: mocks.addTagsToTicket,
  createTicket: mocks.createTicket,
  inferTagsFromText: mocks.inferTagsFromText,
  recordTicketEvent: mocks.recordTicketEvent
}));

vi.mock("@/server/customers", () => ({
  resolveOrCreateCustomerForInbound: mocks.resolveOrCreateCustomerForInbound
}));

vi.mock("@/server/calls/consent", () => ({
  syncVoiceConsentFromMetadata: mocks.syncVoiceConsentFromMetadata
}));

vi.mock("@/server/email/replies", () => ({
  sendTicketReply: mocks.sendTicketReply
}));

vi.mock("@/server/agents/events", () => ({
  buildAgentEvent: mocks.buildAgentEvent
}));

vi.mock("@/server/agents/outbox", () => ({
  deliverPendingAgentEvents: mocks.deliverPendingAgentEvents,
  enqueueAgentEvent: mocks.enqueueAgentEvent
}));

vi.mock("@/server/async", () => ({
  runInBackground: mocks.runInBackground
}));

import { createOutboundEmailTicket } from "@/server/tickets/outbound-email";

describe("outbound email ticket service tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing tenant scope before CRM side effects", async () => {
    await expect(
      createOutboundEmailTicket({
        tenantId: "",
        actorUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        toEmail: "customer@example.com",
        subject: "Missing tenant",
        text: "Hello"
      })
    ).rejects.toThrow("Create outbound email ticket requires tenantId");

    expect(mocks.getOrCreateMailbox).not.toHaveBeenCalled();
    expect(mocks.resolveOrCreateCustomerForInbound).not.toHaveBeenCalled();
    expect(mocks.createTicket).not.toHaveBeenCalled();
    expect(mocks.recordTicketEvent).not.toHaveBeenCalled();
    expect(mocks.sendTicketReply).not.toHaveBeenCalled();
    expect(mocks.enqueueAgentEvent).not.toHaveBeenCalled();
  });
});
