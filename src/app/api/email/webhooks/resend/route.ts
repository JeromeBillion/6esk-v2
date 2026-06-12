import type { EmailReceivedEvent } from "resend";
import { z } from "zod";
import { processInboundEmailPayload } from "@/server/email/process-inbound";
import { mapReceivedEmailToInboundPayload, verifyResendWebhookPayload } from "@/server/email/resend-webhook";
import { normalizeAddressList } from "@/server/email/normalize";
import { findMailbox } from "@/server/email/mailbox";
import {
  integrationError,
  integrationSuccess,
  validateIntegrationApiVersion
} from "@/server/api-contract";
import {
  listActiveProviderWebhookSecrets,
  markProviderWebhookSecretUsed,
  ProviderWebhookSecretConfigurationError,
  shouldRequireTenantProviderWebhookSecrets,
  type ActiveProviderWebhookSecret
} from "@/server/provider-webhook-secrets";

type TenantProviderWebhookScope = {
  tenantId: string;
  workspaceKey: string;
};

const tenantIdSchema = z.string().uuid();

class ScopedResendTenantMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopedResendTenantMismatchError";
  }
}

function readTenantProviderWebhookScope(request: Request): TenantProviderWebhookScope | null {
  const url = new URL(request.url);
  const tenantId =
    request.headers.get("x-6esk-tenant")?.trim() ||
    request.headers.get("x-6esk-tenant-id")?.trim() ||
    url.searchParams.get("tenantId")?.trim() ||
    url.searchParams.get("tenant")?.trim() ||
    "";
  const workspaceKey =
    request.headers.get("x-6esk-workspace")?.trim() ||
    url.searchParams.get("workspaceKey")?.trim() ||
    url.searchParams.get("workspace")?.trim() ||
    "";

  if (!tenantId && !workspaceKey) {
    return null;
  }
  if (!tenantId || !workspaceKey) {
    throw new Error("Both tenantId and workspaceKey are required for tenant-scoped Resend webhooks.");
  }

  const parsedTenantId = tenantIdSchema.safeParse(tenantId);
  if (!parsedTenantId.success) {
    throw new Error("Tenant scope must use a valid tenant UUID.");
  }

  return {
    tenantId: parsedTenantId.data,
    workspaceKey
  };
}

async function assertInboundEmailBelongsToScope(
  inboundPayload: Awaited<ReturnType<typeof mapReceivedEmailToInboundPayload>>,
  scope: TenantProviderWebhookScope
) {
  const primaryRecipient = normalizeAddressList(inboundPayload.to)[0] ?? null;
  if (!primaryRecipient) {
    throw new ScopedResendTenantMismatchError("Scoped Resend webhook payload does not contain a recipient.");
  }

  const mailbox = await findMailbox(primaryRecipient);
  if (!mailbox) {
    throw new ScopedResendTenantMismatchError("Scoped Resend webhook recipient mailbox is not configured.");
  }
  if (mailbox.tenant_id !== scope.tenantId) {
    throw new ScopedResendTenantMismatchError(
      "Scoped Resend webhook recipient mailbox does not match the tenant scope."
    );
  }
}

export async function POST(request: Request) {
  const versionError = validateIntegrationApiVersion(request);
  if (versionError) {
    return versionError;
  }

  const payload = await request.text();

  let scope: TenantProviderWebhookScope | null = null;
  try {
    scope = readTenantProviderWebhookScope(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid tenant scope";
    return integrationError(request, {
      status: 400,
      code: "provider_webhook_tenant_scope_invalid",
      message: "Invalid tenant scope",
      details: message
    });
  }

  const requireTenantSecrets = shouldRequireTenantProviderWebhookSecrets();
  if (!scope && requireTenantSecrets) {
    return integrationError(request, {
      status: 400,
      code: "provider_webhook_tenant_scope_required",
      message: "Tenant scope is required for Resend webhooks."
    });
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
        return integrationError(request, {
          status: 503,
          code: "provider_webhook_secret_configuration_missing",
          message: error.message
        });
      }
      throw error;
    }
  }

  const globalWebhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (globalWebhookSecret && !requireTenantSecrets) {
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
    } else if (requireTenantSecrets) {
      return integrationError(request, {
        status: 503,
        code: "provider_webhook_secret_missing",
        message: "Provider webhook secret is not configured for this tenant."
      });
    } else {
      event = verifyResendWebhookPayload({
        payload,
        headers: request.headers
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook signature";
    return integrationError(request, {
      status: 401,
      code: "unauthorized",
      message: "Unauthorized",
      details: message
    });
  }
  if (matchedSecret && scope) {
    markProviderWebhookSecretUsed(matchedSecret.id, scope).catch(() => {});
  }

  if (event.type !== "email.received") {
    return integrationSuccess(request, { status: "ignored", event: event.type });
  }

  try {
    const inboundPayload = await mapReceivedEmailToInboundPayload(event as EmailReceivedEvent);
    if (scope) {
      await assertInboundEmailBelongsToScope(inboundPayload, scope);
    }
    const result = await processInboundEmailPayload(inboundPayload);
    return integrationSuccess(
      request,
      {
        ...result.body,
        event: event.type,
        emailId: event.data.email_id
      },
      {
        status: result.status
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process Resend webhook";
    const tenantMismatch = error instanceof ScopedResendTenantMismatchError;
    return integrationError(request, {
      status: tenantMismatch ? 403 : 500,
      code: tenantMismatch ? "provider_webhook_tenant_mismatch" : "webhook_processing_failed",
      message: tenantMismatch ? "Webhook payload does not match tenant scope" : "Failed to process webhook",
      details: message
    });
  }
}
