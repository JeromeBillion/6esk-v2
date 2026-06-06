import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { scanFileContent } from "../scripts/tenant-query-scope-sweep.js";

describe("agent run ledger tenant scope", () => {
  it("keeps agent run ledger and replay SQL tenant-scoped", () => {
    const files = [
      "src/server/agents/run-ledger.ts",
      "src/server/agents/policy-replay.ts"
    ];

    for (const relativePath of files) {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
      const result = scanFileContent(relativePath, source);

      expect(result.findings).toEqual([]);
    }
  });
});
