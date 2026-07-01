import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const seedScript = readFileSync(join(repoRoot, "scripts", "seed-admin.js"), "utf8");
const macroTenantMigration = readFileSync(
  join(repoRoot, "db", "migrations", "0073_macros_tenant_unique.sql"),
  "utf8"
);

describe("admin seed bootstrap tenant scope", () => {
  it("pins bootstrap data to an explicit tenant and transaction", () => {
    expect(seedScript).toContain("const DEFAULT_TENANT_ID");
    expect(seedScript).toContain("SELECT id FROM tenants WHERE id = $1 LIMIT 1");
    expect(seedScript).toContain('await client.query("BEGIN")');
    expect(seedScript).toContain('await client.query("COMMIT")');
    expect(seedScript).toContain('await client.query("ROLLBACK").catch(() => {})');
  });

  it("uses tenant-owned support catalog conflict targets", () => {
    expect(seedScript).toContain("INSERT INTO tags (tenant_id, name, description)");
    expect(seedScript).toContain("ON CONFLICT (tenant_id, name)");
    expect(seedScript).toContain("INSERT INTO macros (tenant_id, title, category, body)");
    expect(seedScript).toContain("ON CONFLICT (tenant_id, title)");
    expect(macroTenantMigration).toContain("DROP CONSTRAINT IF EXISTS macros_title_key");
    expect(macroTenantMigration).toContain("ON macros(tenant_id, title)");
  });

  it("creates tenant-owned users, mailboxes, memberships, and SLA config", () => {
    expect(seedScript).toContain(
      "INSERT INTO sla_configs (tenant_id, first_response_target_minutes, resolution_target_minutes, is_active)"
    );
    expect(seedScript).toContain("INSERT INTO users (tenant_id, email, display_name, password_hash, role_id)");
    expect(seedScript).toContain("WHERE users.tenant_id = EXCLUDED.tenant_id");
    expect(seedScript).toContain("INSERT INTO mailboxes (tenant_id, type, address, owner_user_id)");
    expect(seedScript).toContain("WHERE mailboxes.tenant_id = EXCLUDED.tenant_id");
    expect(seedScript).toContain(
      "INSERT INTO mailbox_memberships (tenant_id, mailbox_id, user_id, access_level)"
    );
  });
});
