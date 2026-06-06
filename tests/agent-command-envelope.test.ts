import { describe, expect, it } from "vitest";
import {
  buildAgentCommandEnvelope,
  buildLaneKey,
  mapEventTypeToCommandType
} from "../src/server/agents/command-envelope";
import { buildAgentPromptSandbox } from "../src/server/agents/prompt-sandbox";

describe("agent command envelopes", () => {
  it("maps legacy and review events into typed command names", () => {
    expect(mapEventTypeToCommandType("merge.review.required")).toBe("agent.approval.requested");
    expect(mapEventTypeToCommandType("agent.tool.completed")).toBe("agent.tool.completed");
    expect(mapEventTypeToCommandType("ticket.created")).toBe("agent.run.create");
  });

  it("derives stable tenant-safe lane keys from payload resources", () => {
    expect(
      buildLaneKey({
        tenantKey: "tenant-a",
        eventType: "ticket.created",
        payload: { resource: { ticket_id: "ticket-1", mailbox_id: "mailbox-1" } }
      })
    ).toBe("tenant-a:ticket:ticket-1");
  });

  it("builds a canonical full-auto command envelope", () => {
    const promptSandbox = buildAgentPromptSandbox({
      tenantKey: "tenant-a",
      workspaceKey: "workspace-a",
      mode: "full_auto",
      eventType: "ticket.created",
      payload: { event_type: "ticket.created" }
    });
    const envelope = buildAgentCommandEnvelope({
      commandType: "agent.run.create",
      tenantKey: "tenant-a",
      integrationId: "agent-1",
      laneKey: "tenant-a:ticket:ticket-1",
      policyMode: "auto_send",
      resource: { ticket_id: "ticket-1" },
      payload: { event_type: "ticket.created" },
      promptSandbox
    });

    expect(envelope.schema_version).toBe("agent-command.v1");
    expect(envelope.mode).toBe("full_auto");
    expect(envelope.tenant_key).toBe("tenant-a");
    expect(envelope.lane_key).toBe("tenant-a:ticket:ticket-1");
    expect(envelope.run_id).toBeTruthy();
    expect(envelope.prompt_sandbox?.schema_version).toBe("agent-prompt-sandbox.v1");
    expect(envelope.prompt_sandbox?.tool_contract.requires_policy_decision).toBe(true);
  });
});
