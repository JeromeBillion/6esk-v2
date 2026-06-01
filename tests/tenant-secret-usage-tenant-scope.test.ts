import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { scanFileContent } from "../scripts/tenant-query-scope-sweep.js";

describe("tenant secret usage tenant scope", () => {
  it("keeps tenant secret usage SQL tenant-scoped", () => {
    const files = [
      "src/server/provider-webhook-secrets.ts",
      "src/server/tenant-ingress-secrets.ts"
    ];

    for (const relativePath of files) {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
      const result = scanFileContent(relativePath, source);

      expect(result.findings).toEqual([]);
    }
  });
});
