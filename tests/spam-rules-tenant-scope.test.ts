import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { scanFileContent } from "../scripts/tenant-query-scope-sweep.js";

describe("spam rules tenant scope", () => {
  it("keeps spam rule SQL tenant-scoped", () => {
    const files = [
      "src/app/api/admin/spam-rules/route.ts",
      "src/app/api/admin/spam-rules/[ruleId]/route.ts",
      "src/server/email/spam.ts"
    ];

    for (const relativePath of files) {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
      const result = scanFileContent(relativePath, source);

      expect(result.findings).toEqual([]);
    }
  });
});
