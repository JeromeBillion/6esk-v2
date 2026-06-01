import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { scanFileContent } from "../scripts/tenant-query-scope-sweep.js";

describe("admin calls dead-letter tenant scope", () => {
  it("keeps dead-letter SQL tenant-scoped", () => {
    const relativePath = "src/app/api/admin/calls/dead-letter/route.ts";
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    const result = scanFileContent(relativePath, source);

    expect(result.findings).toEqual([]);
  });
});
