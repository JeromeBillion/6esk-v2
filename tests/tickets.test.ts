import { describe, expect, it } from "vitest";
import { inferTagsFromText } from "../src/server/tickets";

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
