import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const CONSOLE_CALL_RE = /\bconsole\.(log|error|warn|debug|info)\s*\(/g;
const SCANNED_DIRS = ["src/server", "src/app/api", "src/dexter"] as const;
const ALLOWED_CONSOLE_SINKS = new Set(["src/server/logger.ts"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

function toPosixPath(value: string) {
  return value.split(path.sep).join("/");
}

function walkFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

describe("server logging boundary", () => {
  it("routes server, API, and Dexter runtime logs through the privacy-safe logger", () => {
    const root = process.cwd();
    const violations: string[] = [];

    for (const relativeDir of SCANNED_DIRS) {
      const absoluteDir = path.join(root, relativeDir);
      if (!statSync(absoluteDir).isDirectory()) continue;

      for (const file of walkFiles(absoluteDir)) {
        const relativeFile = toPosixPath(path.relative(root, file));
        if (ALLOWED_CONSOLE_SINKS.has(relativeFile)) continue;

        const source = readFileSync(file, "utf8");
        const matches = source.match(CONSOLE_CALL_RE);
        if (matches) {
          violations.push(`${relativeFile}: ${matches.join(", ")}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
