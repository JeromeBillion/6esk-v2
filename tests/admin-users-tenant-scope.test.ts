import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { scanFileContent } from "../scripts/tenant-query-scope-sweep.js";

describe("admin users tenant scope", () => {
  it("keeps admin user and password reset SQL tenant-scoped", () => {
    const files = [
      "src/app/api/admin/users/[userId]/route.ts",
      "src/app/api/admin/users/[userId]/password-reset/route.ts",
      "src/app/api/auth/password-reset/route.ts"
    ];

    for (const relativePath of files) {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
      const result = scanFileContent(relativePath, source);

      expect(result.findings).toEqual([]);
    }
  });
});
