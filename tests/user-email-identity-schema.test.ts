import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "db", "migrations", "0075_users_email_case_insensitive_unique.sql"),
  "utf8"
);

describe("user email identity schema", () => {
  it("fails migration before collapsing case-insensitive duplicate users", () => {
    expect(migration).toContain("GROUP BY lower(email)");
    expect(migration).toContain("HAVING count(*) > 1");
    expect(migration).toContain(
      "users.email contains case-insensitive duplicates; resolve before applying 0075"
    );
  });

  it("normalizes stored user emails and enforces case-insensitive identity", () => {
    expect(migration).toContain("UPDATE users");
    expect(migration).toContain("SET email = lower(email)");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower");
    expect(migration).toContain("ON users(lower(email))");
  });
});
