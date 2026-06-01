import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { scanFileContent } from "../scripts/tenant-query-scope-sweep.js";

describe("call policy tenant scope", () => {
  it("keeps call policy SQL tenant-scoped", () => {
    const relativePath = "src/server/calls/policy.ts";
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    const result = scanFileContent(relativePath, source);

    expect(result.findings).toEqual([]);
  });
});
