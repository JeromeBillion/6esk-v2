import { describe, expect, it } from "vitest";
import { buildAgentKnowledgeQuery } from "../src/server/agents/rag-context";

describe("agent RAG context", () => {
  it("uses event excerpts as the preferred retrieval query", () => {
    expect(
      buildAgentKnowledgeQuery({
        eventType: "ticket.created",
        payload: {
          excerpt: "Customer is asking for the refund SLA after a failed payout.",
          resource: { ticket_id: "ticket-1" }
        }
      })
    ).toBe("Customer is asking for the refund SLA after a failed payout.");
  });

  it("falls back to tenant-safe resource hints when no excerpt is present", () => {
    expect(
      buildAgentKnowledgeQuery({
        eventType: "ticket.message.created",
        payload: {
          resource: { ticket_id: "ticket-1", mailbox_id: "mailbox-1" }
        }
      })
    ).toBe("ticket.message.created ticket-1 mailbox-1");
  });
});
