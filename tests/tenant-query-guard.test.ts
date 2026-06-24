import { describe, expect, it, vi } from "vitest";
import {
  enforceTenantQueryGuard,
  inspectTenantQueryScope,
  resolveTenantQueryGuardMode,
  TenantQueryGuardError
} from "@/server/tenant-query-guard";

describe("tenant query guard", () => {
  it("allows queries that do not reference tenant-scoped tables", () => {
    const inspection = enforceTenantQueryGuard("SELECT now()", { mode: "strict" });

    expect(inspection.missingTenantScope).toBe(false);
    expect(inspection.tables).toEqual([]);
  });

  it("allows tenant-scoped table queries that include tenant_id evidence", () => {
    const inspection = enforceTenantQueryGuard(
      "SELECT id FROM tickets WHERE id = $1 AND tenant_id = $2",
      { mode: "strict" }
    );

    expect(inspection.missingTenantScope).toBe(false);
    expect(inspection.tables).toContain("tickets");
  });

  it("blocks tenant-scoped table queries without tenant_id evidence in strict mode", () => {
    expect(() =>
      enforceTenantQueryGuard("SELECT id FROM tickets WHERE id = $1", { mode: "strict" })
    ).toThrow(TenantQueryGuardError);
  });

  it("treats real v2 agent, knowledge, auth, and billing tables as tenant-scoped", () => {
    expect(() =>
      enforceTenantQueryGuard("SELECT id FROM agent_tool_policy_decisions WHERE run_id = $1", {
        mode: "strict"
      })
    ).toThrow(TenantQueryGuardError);
    expect(() =>
      enforceTenantQueryGuard("SELECT id FROM agent_action_idempotency WHERE idempotency_key = $1", {
        mode: "strict"
      })
    ).toThrow(TenantQueryGuardError);
    expect(() =>
      enforceTenantQueryGuard("SELECT id FROM agent_prompt_templates WHERE template_key = $1", {
        mode: "strict"
      })
    ).toThrow(TenantQueryGuardError);
    expect(() =>
      enforceTenantQueryGuard("SELECT id FROM knowledge_quarantine_events WHERE reason_code = $1", {
        mode: "strict"
      })
    ).toThrow(TenantQueryGuardError);
    expect(() =>
      enforceTenantQueryGuard("SELECT id FROM roles WHERE name = $1", {
        mode: "strict"
      })
    ).toThrow(TenantQueryGuardError);
    expect(() =>
      enforceTenantQueryGuard("SELECT id FROM organizations WHERE domain = $1", {
        mode: "strict"
      })
    ).toThrow(TenantQueryGuardError);
    expect(() =>
      enforceTenantQueryGuard("SELECT id FROM tenant_invoices WHERE id = $1", {
        mode: "strict"
      })
    ).toThrow(TenantQueryGuardError);
    expect(() =>
      enforceTenantQueryGuard("SELECT id FROM tenant_billing_action_idempotency WHERE idempotency_key = $1", {
        mode: "strict"
      })
    ).toThrow(TenantQueryGuardError);
  });

  it("does not retain wrong-folder table aliases that are absent from v2 migrations", () => {
    expect(inspectTenantQueryScope("SELECT id FROM ai_guard_events WHERE id = $1").tables).toEqual([]);
    expect(inspectTenantQueryScope("SELECT id FROM ai_knowledge_documents WHERE id = $1").tables).toEqual([]);
    expect(inspectTenantQueryScope("SELECT id FROM workspace_billing_invoices WHERE id = $1").tables).toEqual([]);
    expect(inspectTenantQueryScope("SELECT id FROM auth_identity_accounts WHERE id = $1").tables).toEqual([]);
  });

  it("treats public ingress origin allowlists as tenant-scoped", () => {
    expect(() =>
      enforceTenantQueryGuard("SELECT id FROM tenant_public_ingress_origins WHERE origin = $1", {
        mode: "strict"
      })
    ).toThrow(TenantQueryGuardError);
  });

  it("warns instead of blocking in warn mode", () => {
    const logger = { warn: vi.fn() };
    const inspection = enforceTenantQueryGuard("SELECT id FROM customers WHERE id = $1", {
      mode: "warn",
      logger
    });

    expect(inspection.missingTenantScope).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("customers"));
  });

  it("supports pg query config objects", () => {
    const inspection = inspectTenantQueryScope({
      text: "UPDATE users SET name = $1 WHERE id = $2 AND tenant_id = $3",
      values: ["Alice", "user-1", "tenant-a"]
    });

    expect(inspection.tables).toContain("users");
    expect(inspection.missingTenantScope).toBe(false);
  });

  it("allows explicit SQL suppression comments for intentional global admin reads", () => {
    const inspection = enforceTenantQueryGuard(
      "/* tenant-query-guard: ignore internal-admin inventory */ SELECT id FROM users WHERE id = $1",
      { mode: "strict" }
    );

    expect(inspection.suppressed).toBe(true);
    expect(inspection.missingTenantScope).toBe(false);
  });

  it("defaults to strict in production and off outside production", () => {
    expect(resolveTenantQueryGuardMode({ NODE_ENV: "production" })).toBe("strict");
    expect(resolveTenantQueryGuardMode({ NODE_ENV: "test" })).toBe("off");
    expect(resolveTenantQueryGuardMode({ NODE_ENV: "production", TENANT_QUERY_GUARD_MODE: "warn" })).toBe(
      "warn"
    );
  });
});
