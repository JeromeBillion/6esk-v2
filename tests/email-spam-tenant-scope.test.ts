import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

import { evaluateSpam } from "@/server/email/spam";

describe("email spam tenant scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("evaluates only active spam rules in the resolved tenant workspace", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "rule-1",
          rule_type: "block",
          scope: "domain",
          pattern: "blocked.example"
        }
      ]
    });

    const result = await evaluateSpam({
      fromEmail: "sender@blocked.example",
      subject: "Hello",
      text: "Body",
      tenantKey: "tenant-mail",
      workspaceKey: "workspace-mail"
    });

    expect(result).toEqual({ isSpam: true, reason: "block:rule-1" });
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("WHERE tenant_key = $1"),
      ["tenant-mail", "workspace-mail"]
    );
  });
});
