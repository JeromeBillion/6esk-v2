import { describe, expect, it } from "vitest";
import { appendMergedFromMetadata, inferTagsFromText } from "../src/server/tickets";

describe("inferTagsFromText", () => {
  it("returns kyc tag when KYC keywords are present", () => {
    const tags = inferTagsFromText({ subject: "KYC verification needed", text: "" });
    expect(tags).toContain("kyc");
  });

  it("returns payments tag for wallet/withdrawal keywords", () => {
    const tags = inferTagsFromText({ subject: "Withdrawal pending", text: "Wallet issue" });
    expect(tags).toContain("payments");
  });

  it("returns general when no keywords match", () => {
    const tags = inferTagsFromText({ subject: "Hello", text: "Just checking in" });
    expect(tags).toContain("general");
  });
});

describe("appendMergedFromMetadata", () => {
  it("creates mergedFrom when metadata is empty", () => {
    const merged = appendMergedFromMetadata(null, {
      sourceTicketId: "source-1",
      sourceChannel: "email",
      mergedAt: "2026-02-14T00:00:00.000Z",
      reason: "Duplicate ticket",
      movedMessages: 2,
      movedReplies: 1,
      movedEvents: 3,
      movedDrafts: 0
    });
    expect(merged).toEqual({
      mergedFrom: [
        {
          sourceTicketId: "source-1",
          sourceChannel: "email",
          mergedAt: "2026-02-14T00:00:00.000Z",
          reason: "Duplicate ticket",
          movedMessages: 2,
          movedReplies: 1,
          movedEvents: 3,
          movedDrafts: 0
        }
      ]
    });
  });

  it("appends to existing mergedFrom and preserves metadata keys", () => {
    const merged = appendMergedFromMetadata(
      {
        externalProfile: { id: "u-1" },
        mergedFrom: [{ sourceTicketId: "old" }]
      },
      {
        sourceTicketId: "source-2",
        sourceChannel: "whatsapp",
        mergedAt: "2026-02-14T10:00:00.000Z",
        reason: null,
        movedMessages: 4,
        movedReplies: 0,
        movedEvents: 2,
        movedDrafts: 1
      }
    );

    expect(merged.externalProfile).toEqual({ id: "u-1" });
    expect(Array.isArray(merged.mergedFrom)).toBe(true);
    expect((merged.mergedFrom as unknown[]).length).toBe(2);
    expect((merged.mergedFrom as Array<Record<string, unknown>>)[1]).toMatchObject({
      sourceTicketId: "source-2",
      sourceChannel: "whatsapp"
    });
  });
});
