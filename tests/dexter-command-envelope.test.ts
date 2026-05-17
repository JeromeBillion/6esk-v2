import { describe, expect, it } from "vitest";
import {
  buildOutboxRunCreateCommand,
  parseDexterCommandEnvelope
} from "@/server/agents/command-envelope";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const INTEGRATION_ID = "11111111-1111-4111-8111-111111111111";
const OUTBOX_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const TICKET_ID = "44444444-4444-4444-8444-444444444444";

describe("Dexter command envelope", () => {
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
