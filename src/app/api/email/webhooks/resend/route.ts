import type { EmailReceivedEvent } from "resend";
import { processInboundEmailPayload } from "@/server/email/process-inbound";
import { mapReceivedEmailToInboundPayload, verifyResendWebhookPayload } from "@/server/email/resend-webhook";
import { resolveTenantScope, type TenantScope } from "@/server/tenant-context";
import {
  listActiveProviderWebhookSecrets,
  markProviderWebhookSecretUsed,
  ProviderWebhookSecretConfigurationError,
  shouldRequireTenantProviderWebhookSecrets,
  type ActiveProviderWebhookSecret
} from "@/server/provider-webhook-secrets";

function readTenantScopeHint(request: Request): TenantScope | null {
  const url = new URL(request.url);
  const tenantKey =
    request.headers.get("x-6esk-tenant")?.trim() ||
    url.searchParams.get("tenant")?.trim() ||
    url.searchParams.get("tenantKey")?.trim() ||
    "";
  const workspaceKey =
    request.headers.get("x-6esk-workspace")?.trim() ||
    url.searchParams.get("workspace")?.trim() ||
    url.searchParams.get("workspaceKey")?.trim() ||
    "";
  if (!tenantKey && !workspaceKey) {
    return null;
  }
  if (!tenantKey || !workspaceKey) {
    throw new Error("Both tenant and workspace are required for tenant-scoped Resend webhooks.");
  }
  return resolveTenantScope({ tenantKey, workspaceKey });
}

export async function POST(request: Request) {
  const payload = await request.text();

  let scope: TenantScope | null = null;
  try {
    scope = readTenantScopeHint(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid tenant scope";
    return Response.json(
      { error: "Invalid tenant scope", code: "provider_webhook_tenant_scope_invalid", details: message },
      { status: 400 }
    );
  }
  if (!scope && shouldRequireTenantProviderWebhookSecrets()) {
    return Response.json(
      {
        error: "Tenant scope is required for Resend webhooks.",
        code: "provider_webhook_tenant_scope_required"
      },
      { status: 400 }
    );
  }

  let providerSecrets: ActiveProviderWebhookSecret[] = [];
  if (scope) {
    try {
      providerSecrets = await listActiveProviderWebhookSecrets({
        scope,
        provider: "resend",
        secretType: "webhook_secret"
      });
    } catch (error) {
      if (error instanceof ProviderWebhookSecretConfigurationError) {
        return Response.json(
          {
            error: error.message,
            code: "provider_webhook_secret_configuration_missing"
          },
          { status: 503 }
        );
      }
      throw error;
    }
  }

  const globalWebhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (globalWebhookSecret && !shouldRequireTenantProviderWebhookSecrets()) {
    providerSecrets.push({
      id: "env:RESEND_WEBHOOK_SECRET",
      secret: globalWebhookSecret,
      source: "env"
    });
  }

  let event;
  let matchedSecret: ActiveProviderWebhookSecret | null = null;
  try {
    if (providerSecrets.length) {
      let lastError: unknown = null;
      for (const secret of providerSecrets) {
        try {
          event = verifyResendWebhookPayload({
            payload,
            headers: request.headers,
            webhookSecret: secret.secret
          });
          matchedSecret = secret;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!event) {
        throw lastError instanceof Error ? lastError : new Error("Invalid webhook signature");
      }
    } else if (shouldRequireTenantProviderWebhookSecrets()) {
      return Response.json(
        {
          error: "Provider webhook secret is not configured for this tenant.",
          code: "provider_webhook_secret_missing"
        },
        { status: 503 }
      );
    } else {
      event = verifyResendWebhookPayload({
        payload,
        headers: request.headers
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook signature";
    return Response.json({ error: "Unauthorized", details: message }, { status: 401 });
  }
  if (matchedSecret && scope) {
    await markProviderWebhookSecretUsed(matchedSecret.id, scope).catch(() => {});
  }

  if (event.type !== "email.received") {
    return Response.json({ status: "ignored", event: event.type });
  }

  try {
    const inboundPayload = await mapReceivedEmailToInboundPayload(event as EmailReceivedEvent);
    const result = await processInboundEmailPayload(inboundPayload, scope ?? undefined);
    return Response.json(
      {
        ...result.body,
        event: event.type,
        emailId: event.data.email_id
      },
      { status: result.status }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process Resend webhook";
    return Response.json({ error: "Failed to process webhook", details: message }, { status: 500 });
  }
}
