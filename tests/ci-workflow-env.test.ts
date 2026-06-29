import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { validateEnv } from "@/server/env";

function unquote(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readTopLevelWorkflowEnv(path: string) {
  const env: Record<string, string> = {};
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "env:");
  if (start === -1) {
    throw new Error("Workflow is missing a top-level env block.");
  }

  for (const line of lines.slice(start + 1)) {
    if (line === "jobs:") break;
    if (!line.startsWith("  ")) continue;
    const trimmed = line.trim();
    const separator = trimmed.indexOf(":");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);
    env[key] = unquote(value);
  }

  return env;
}

describe("production CI workflow env", () => {
  it("satisfies the strict production env contract used by release gates", () => {
    const env = readTopLevelWorkflowEnv(".github/workflows/ci.yml");

    expect(() =>
      validateEnv(
        {
          ...env,
          NODE_ENV: "production"
        },
        { strictProduction: true }
      )
    ).not.toThrow();
  });

  it("keeps the full release-candidate command set in the workflow", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("npm test");
    expect(workflow).toContain("npm run audit:security");
    expect(workflow).toContain("npm run build:web");
    expect(workflow).toContain("npm run build:backoffice");
  });
});
