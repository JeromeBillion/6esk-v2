import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { recordAuditLog } from "@/server/audit";
import { tenantScopeFromUser } from "@/server/tenant-context";
import {
  listTenantIngressSigningSecrets,
  revokeTenantIngressSigningSecret,
  rotateTenantIngressSigningSecret,
  TenantIngressSecretConfigurationError
} from "@/server/tenant-ingress-secrets";

const rotateSecretSchema = z.object({
  label: z.string().min(1).max(120).optional().nullable(),
  retireExisting: z.boolean().optional().default(true),
  expiresAt: z.string().datetime().optional().nullable(),
  reason: z.string().max(500).optional().nullable()
});

function readSecretId(request: Request) {
  return new URL(request.url).searchParams.get("id")?.trim() ?? "";
}

function configurationErrorResponse(error: unknown) {
  if (error instanceof TenantIngressSecretConfigurationError) {
    return Response.json(
      {
        error: error.message,
        code: "tenant_ingress_secret_configuration_missing"
      },
      { status: 503 }
    );
  }
  return null;
}

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const scope = tenantScopeFromUser(user);
  const secrets = await listTenantIngressSigningSecrets(scope);
  return Response.json({ secrets });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

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

  const scope = tenantScopeFromUser(user);
  try {
    const result = await rotateTenantIngressSigningSecret({
      scope,
      label: parsed.data.label,
      actorUserId: user?.id ?? null,
      retireExisting: parsed.data.retireExisting,
      expiresAt: parsed.data.expiresAt ?? null
    });

    await recordAuditLog({
      tenantKey: scope.tenantKey,
      workspaceKey: scope.workspaceKey,
      actorUserId: user?.id ?? null,
      action: "tenant_ingress_signing_secret_rotated",
      entityType: "tenant_ingress_signing_secret",
      entityId: result.secret.id,
      data: {
        label: result.secret.label,
        fingerprint: result.secret.fingerprint,
        retireExisting: parsed.data.retireExisting,
        expiresAt: result.secret.expiresAt,
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
        { error: "Tenant ingress signing secret fingerprint already exists.", code: "secret_conflict" },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const secretId = readSecretId(request);
  if (!secretId) {
    return Response.json({ error: "id is required" }, { status: 400 });
  }

  const scope = tenantScopeFromUser(user);
  const secret = await revokeTenantIngressSigningSecret({ scope, secretId });
  if (!secret) {
    return Response.json({ error: "Tenant ingress signing secret not found" }, { status: 404 });
  }

  await recordAuditLog({
    tenantKey: scope.tenantKey,
    workspaceKey: scope.workspaceKey,
    actorUserId: user?.id ?? null,
    action: "tenant_ingress_signing_secret_revoked",
    entityType: "tenant_ingress_signing_secret",
    entityId: secret.id,
    data: {
      label: secret.label,
      fingerprint: secret.fingerprint,
      previousStatus: "active_or_retiring"
    }
  });

  return Response.json({ status: "revoked", secret });
}
