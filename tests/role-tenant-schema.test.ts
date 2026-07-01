import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "db", "migrations", "0074_roles_tenant_unique.sql"),
  "utf8"
);

describe("role tenant schema", () => {
  it("replaces global role names with tenant-scoped role names", () => {
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS roles_name_key");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_tenant_name");
    expect(migration).toContain("ON roles(tenant_id, name)");
  });

  it("guards user role assignments against cross-tenant roles", () => {
    expect(migration).toContain("users.role_id contains cross-tenant role assignments");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_tenant_id_id");
    expect(migration).toContain("FOREIGN KEY (tenant_id, role_id)");
    expect(migration).toContain("REFERENCES roles(tenant_id, id)");
  });
});
