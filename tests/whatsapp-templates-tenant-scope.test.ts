import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { scanFileContent } from "../scripts/tenant-query-scope-sweep.js";

describe("WhatsApp templates tenant scope", () => {
  it("keeps WhatsApp template SQL tenant-scoped", () => {
    const files = [
      "src/app/api/admin/whatsapp/templates/route.ts",
      "src/app/api/admin/whatsapp/templates/[templateId]/route.ts",
      "src/app/api/whatsapp/templates/route.ts"
    ];

    for (const relativePath of files) {
      const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
      const result = scanFileContent(relativePath, source);

      expect(result.findings).toEqual([]);
    }
  });
});
