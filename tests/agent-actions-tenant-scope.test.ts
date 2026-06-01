import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { scanFileContent } from "../scripts/tenant-query-scope-sweep.js";

describe("agent actions tenant scope", () => {
  it("keeps agent action callback SQL tenant-scoped", () => {
    const relativePath = "src/app/api/agent/v1/actions/route.ts";
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    const result = scanFileContent(relativePath, source);

    expect(result.findings).toEqual([]);
  });
});
