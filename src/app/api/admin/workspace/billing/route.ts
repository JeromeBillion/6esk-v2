import { z } from "zod";
import { db } from "@/server/db";
import { getSessionUser } from "@/server/auth/session";
import { isTenantAdmin } from "@/server/auth/roles";
import { getTenantById } from "@/server/tenant/lifecycle";
import { encrypt } from "@/server/security/encryption";
import { recordAuditLog } from "@/server/audit";
import {
  getCustomerSafeInvoiceExport,
  getTenantBillingLifecycleSnapshot
} from "@/server/billing/lifecycle";

const billingSettingsSchema = z.object({
  aiProviderMode: z.enum(["managed", "byo", "none"]).optional(),
  aiProviderApiKey: z.string().optional(),
  aiProviderModel: z.string().optional(),
  aiProviderBaseUrl: z.string().url().optional()
});

function safeAttachmentStem(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 100) || "invoice";
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isTenantAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = user?.tenant_id?.trim();
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const invoiceId = url.searchParams.get("invoiceId");
  if (invoiceId) {
    const parsedInvoiceId = z.string().uuid().safeParse(invoiceId);
    if (!parsedInvoiceId.success) {
      return Response.json({ error: "Invalid invoiceId" }, { status: 400 });
    }
    const invoiceExport = await getCustomerSafeInvoiceExport({
      tenantId,
      invoiceId: parsedInvoiceId.data
    });
    await recordAuditLog({
      tenantId,
      actorUserId: user?.id ?? null,
      action: "billing_invoice_exported",
      entityType: "tenant_invoice",
      entityId: parsedInvoiceId.data,
      data: {
        formatVersion: invoiceExport.formatVersion,
        workspaceKey: invoiceExport.workspaceKey,
        status: invoiceExport.invoice.status,
        lineCount: invoiceExport.invoice.lines.length
      }
    });
    const invoiceStem = safeAttachmentStem(invoiceExport.invoice.invoiceNumber);
    return Response.json(invoiceExport, {
      headers: {
        "content-disposition": `attachment; filename="6esk-invoice-${invoiceStem}.json"`
      }
    });
  }

  const tenant = await getTenantById(tenantId);
  
  if (!tenant) {
    return Response.json({ error: "Tenant not found" }, { status: 404 });
  }

  return Response.json({
    plan: tenant.plan,
    status: tenant.status,
    aiProviderMode: tenant.settings?.aiProviderMode || "managed",
    hasCustomKey: !!tenant.settings?.aiProviderApiKey,
    customModel: tenant.settings?.aiProviderModel || null,
    customBaseUrl: tenant.settings?.aiProviderBaseUrl || null,
    billingLifecycle: await getTenantBillingLifecycleSnapshot({ tenantId })
  });
}

export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!isTenantAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = user?.tenant_id?.trim();
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = billingSettingsSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.issues }, { status: 400 });
  }

  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return Response.json({ error: "Tenant not found" }, { status: 404 });
  }

  const settings = { ...tenant.settings };

  if (parsed.data.aiProviderMode) {
    settings.aiProviderMode = parsed.data.aiProviderMode;
  }

  if (parsed.data.aiProviderModel !== undefined) {
    settings.aiProviderModel = parsed.data.aiProviderModel;
  }

  if (parsed.data.aiProviderBaseUrl !== undefined) {
    settings.aiProviderBaseUrl = parsed.data.aiProviderBaseUrl;
  }

  // Encrypt the API key before storing it
  if (parsed.data.aiProviderApiKey) {
    settings.aiProviderApiKey = encrypt(parsed.data.aiProviderApiKey);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    
    await client.query(
      `UPDATE tenants SET settings = $1::jsonb, updated_at = now() WHERE id = $2`,
      [JSON.stringify(settings), tenantId]
    );

    await client.query("COMMIT");

    await recordAuditLog({
      tenantId,
      actorUserId: user?.id ?? null,
      action: "tenant_billing_settings_updated",
      entityType: "tenant",
      entityId: tenantId,
      data: { aiProviderMode: settings.aiProviderMode }
    });

    return Response.json({ status: "updated" });
  } catch (err) {
    await client.query("ROLLBACK");
    return Response.json({ error: "Internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}
