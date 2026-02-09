import { describe, expect, it } from "vitest";
import { hasMailboxScope } from "../src/server/agents/scopes";

describe("hasMailboxScope", () => {
  it("allows access when scopes are empty", () => {
    const integration = { scopes: {} };
    expect(hasMailboxScope(integration, "mailbox-123")).toBe(true);
  });

  it("blocks access when mailbox id is not allowed", () => {
    const integration = { scopes: { mailbox_ids: ["allowed"] } };
    expect(hasMailboxScope(integration, "blocked")).toBe(false);
  });

  it("allows access when mailbox id is allowed", () => {
    const integration = { scopes: { mailbox_ids: ["allowed"] } };
    expect(hasMailboxScope(integration, "allowed")).toBe(true);
  });
});
