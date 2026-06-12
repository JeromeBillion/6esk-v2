import { describe, expect, it } from "vitest";
import {
  buildDexterCommandEnvelope,
  buildOutboxRunCreateCommand,
  mapEventTypeToDexterCommand,
  parseDexterCommandEnvelope
} from "@/server/agents/command-envelope";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const OUTBOX_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const TICKET_ID = "44444444-4444-4444-8444-444444444444";
const TOOL_CALL_ID = "55555555-5555-4555-8555-555555555555";

describe("Dexter command envelope", () => {
  it("maps runtime and review events into typed command names", () => {
    expect(mapEventTypeToDexterCommand("merge.review.required")).toBe("agent.approval.requested");
    expect(mapEventTypeToDexterCommand("agent.tool.completed")).toBe("agent.tool.completed");
    expect(mapEventTypeToDexterCommand("ticket.message.created")).toBe("agent.run.create");
  });

  it("builds a validated run-create command for outbox work", () => {
    const command = buildOutboxRunCreateCommand({
      tenantId: TENANT_ID,
      integrationId: INTEGRATION_ID,
      runId: RUN_ID,
      outboxEventId: OUTBOX_ID,
      eventType: "ticket.message.created",
      sourceChannel: "ticket",
      resourceType: "ticket",
      resourceId: TICKET_ID,
      idempotencyKey: "ticket-message-1",
      requestedScopes: ["tickets:read", "", { bad: true }],
      rolloutMode: "limited_auto",
      providerMode: "byo_ai",
      laneKey: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`,
      payloadSchema: "ticket.v1",
      createdAt: new Date("2026-05-14T09:00:00.000Z")
    });

    expect(command).toMatchObject({
      protocol: "6esk.dexter.control-plane",
      version: "2026-05-14",
      command: "agent.run.create",
      tenantId: TENANT_ID,
      runId: RUN_ID,
      actor: {
        type: "agent",
        id: INTEGRATION_ID
      },
      idempotencyKey: "ticket-message-1",
      source: {
        channel: "ticket",
        triggerEventType: "ticket.message.created",
        outboxEventId: OUTBOX_ID,
        payloadSchema: "ticket.v1"
      },
      resourceRefs: [{ type: "ticket", id: TICKET_ID }],
      requestedScopes: ["tickets:read"],
      rolloutMode: "full_auto",
      providerMode: "byo",
      laneKey: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`,
      createdAt: "2026-05-14T09:00:00.000Z"
    });
  });

  it("builds validated tool command envelopes with bounded command data", () => {
    const command = buildDexterCommandEnvelope({
      command: "agent.tool.requested",
      tenantId: TENANT_ID,
      runId: RUN_ID,
      actor: {
        type: "agent",
        id: INTEGRATION_ID,
        displayName: "Dexter runtime"
      },
      idempotencyKey: "tool:send-reply:1",
      sourceChannel: "ticket",
      triggerEventType: "agent.tool.requested",
      resourceRefs: [{ type: "ticket", id: TICKET_ID }],
      requestedScopes: ["tickets:write", "email:send"],
      rolloutMode: "full_auto",
      providerMode: "managed",
      laneKey: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`,
      commandData: {
        toolName: "send_reply",
        toolCallId: TOOL_CALL_ID,
        metadata: {
          toolClass: "external_send"
        }
      },
      createdAt: new Date("2026-05-14T09:01:00.000Z")
    });

    expect(command).toMatchObject({
      command: "agent.tool.requested",
      idempotencyKey: "tool:send-reply:1",
      requestedScopes: ["tickets:write", "email:send"],
      commandData: {
        toolName: "send_reply",
        toolCallId: TOOL_CALL_ID,
        metadata: {
          toolClass: "external_send"
        }
      }
    });
  });

  it("rejects oversized command metadata", () => {
    expect(() =>
      buildDexterCommandEnvelope({
        command: "agent.tool.completed",
        tenantId: TENANT_ID,
        runId: RUN_ID,
        actor: {
          type: "agent",
          id: INTEGRATION_ID
        },
        idempotencyKey: "tool:send-reply:1",
        sourceChannel: "ticket",
        triggerEventType: "agent.tool.completed",
        requestedScopes: ["tickets:write"],
        rolloutMode: "full_auto",
        providerMode: "managed",
        laneKey: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`,
        commandData: {
          toolName: "send_reply",
          metadata: {
            blob: "x".repeat(4097)
          }
        }
      })
    ).toThrow("Invalid Dexter command envelope");
  });

  it("fails closed when required control-plane fields are invalid", () => {
    expect(() =>
      parseDexterCommandEnvelope({
        protocol: "6esk.dexter.control-plane",
        version: "2026-05-14",
        command: "agent.run.create",
        tenantId: "not-a-uuid",
        runId: RUN_ID,
        actor: { type: "agent", id: INTEGRATION_ID },
        idempotencyKey: "key-1",
        source: {
          channel: "ticket",
          triggerEventType: "ticket.message.created",
          outboxEventId: OUTBOX_ID
        },
        resourceRefs: [],
        requestedScopes: [],
        rolloutMode: "full_auto",
        providerMode: "managed",
        laneKey: `tenant:${TENANT_ID}:ticket:${TICKET_ID}`,
        createdAt: "2026-05-14T09:00:00.000Z"
      })
    ).toThrow(/Invalid Dexter command envelope/);
  });
});
