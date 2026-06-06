import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { hasTenantAdminAccess } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { DEFAULT_WORKSPACE_KEY } from "@/server/workspace-modules";
import {
  listProviderWebhookSecrets,
  ProviderWebhookSecretConfigurationError,
  revokeProviderWebhookSecret,
  rotateProviderWebhookSecret
} from "@/server/provider-webhook-secrets";

const rotateSecretSchema = z.object({
  provider: z.string().min(1).max(80),
  secretType: z.string().min(1).max(80),
  providerAccountId: z.string().max(160).optional().nullable(),
  label: z.string().min(1).max(120).optional().nullable(),
  secret: z.string().min(1).max(4096).optional().nullable(),
  retireExisting: z.boolean().optional().default(true),
  expiresAt: z.string().datetime().optional().nullable(),
  reason: z.string().max(500).optional().nullable()
});

async function requireTenantAdmin() {
  const user = await getSessionUser();
  if (!user || !hasTenantAdminAccess(user) || !user.tenant_id) {
    return {
      ok: false as const,
      response: Response.json({ error: "Forbidden" }, { status: 403 })
    };
  }
  return {
    ok: true as const,
    user,
    scope: {
      tenantId: user.tenant_id,
      workspaceKey: DEFAULT_WORKSPACE_KEY
    }
  };
}

function readSecretId(request: Request) {
  return new URL(request.url).searchParams.get("id")?.trim() ?? "";
}

function configurationErrorResponse(error: unknown) {
  if (error instanceof ProviderWebhookSecretConfigurationError) {
    return Response.json(
      {
        error: error.message,
        code: "provider_webhook_secret_configuration_missing"
      },
      { status: 503 }
    );
  }
  return null;
}

export async function GET() {
  const auth = await requireTenantAdmin();
  if (!auth.ok) return auth.response;

  const secrets = await listProviderWebhookSecrets(auth.scope);
  return Response.json({ secrets });
}

export async function POST(request: Request) {
  const auth = await requireTenantAdmin();
  if (!auth.ok) return auth.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = rotateSecretSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await rotateProviderWebhookSecret({
      scope: auth.scope,
      provider: parsed.data.provider,
      secretType: parsed.data.secretType,
      providerAccountId: parsed.data.providerAccountId,
      label: parsed.data.label,
      secret: parsed.data.secret,
      actorUserId: auth.user.id,
      retireExisting: parsed.data.retireExisting,
      expiresAt: parsed.data.expiresAt ?? null
    });

    await recordAuditLog({
      tenantId: auth.scope.tenantId,
      actorUserId: auth.user.id,
      action: "provider_webhook_secret_rotated",
      entityType: "tenant_provider_webhook_secret",
      entityId: result.secret.id,
      data: {
        provider: result.secret.provider,
        secretType: result.secret.secretType,
        providerAccountId: result.secret.providerAccountId,
        label: result.secret.label,
        fingerprint: result.secret.fingerprint,
        retireExisting: parsed.data.retireExisting,
        expiresAt: result.secret.expiresAt,
        generated: result.generated,
        reason: parsed.data.reason ?? null
      }
    });

    return Response.json(
      {
        status: "rotated",
        secret: result.secret,
        plaintextSecret: result.plaintextSecret,
        plaintextReturnedOnce: true
      },
      { status: 201 }
    );
  } catch (error) {
    const response = configurationErrorResponse(error);
    if (response) return response;
    if ((error as { code?: string }).code === "23505") {
      return Response.json(
        { error: "Provider webhook secret fingerprint already exists.", code: "secret_conflict" },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const auth = await requireTenantAdmin();
  if (!auth.ok) return auth.response;

  const secretId = readSecretId(request);
  if (!secretId) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const secret = await revokeProviderWebhookSecret({ scope: auth.scope, secretId });
  if (!secret) {
    return Response.json({ error: "Provider webhook secret not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantId: auth.scope.tenantId,
    actorUserId: auth.user.id,
    action: "provider_webhook_secret_revoked",
    entityType: "tenant_provider_webhook_secret",
    entityId: secret.id,
    data: {
      provider: secret.provider,
      secretType: secret.secretType,
      providerAccountId: secret.providerAccountId,
      label: secret.label,
      fingerprint: secret.fingerprint
    }
  });

  return Response.json({ status: "revoked", secret });
}
