import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { canManageTickets } from "@/server/auth/roles";
import {
  getLatestVoiceConsentState,
  normalizeVoiceConsentEmail,
  normalizeVoiceConsentPhone,
  recordVoiceConsentEvent,
  resolveExistingCustomerIdForVoiceConsent
} from "@/server/calls/consent";
import {
  isTenantPublicIngressError,
  tenantScopeFromPublicIngressRequest
} from "@/server/tenant-public-ingress";

const voiceConsentSchema = z.object({
  action: z.enum(["grant", "revoke"]),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  callbackPhone: z.string().optional().nullable(),
  termsVersion: z.string().max(120).optional().nullable(),
  source: z.string().max(120).optional().nullable(),
  occurredAt: z.string().datetime().optional().nullable(),
  customerId: z.string().uuid().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable()
});

function readSource(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  const canManage = sessionUser ? canManageTickets(sessionUser) : false;
  const sharedSecret = process.env.INBOUND_SHARED_SECRET ?? "";
  const providedSecret = request.headers.get("x-6esk-secret");
  const trustedSecret = Boolean(sharedSecret && providedSecret === sharedSecret);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = voiceConsentSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  if (data.action === "grant" && !canManage && !trustedSecret) {
    return Response.json(
      { error: "Granting consent requires authenticated support access." },
      { status: 403 }
    );
  }

  let tenantId = sessionUser ? sessionTenantId(sessionUser) : null;
  if (canManage && !tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!tenantId) {
    try {
      tenantId = (await tenantScopeFromPublicIngressRequest(request)).tenantId;
    } catch (error) {
      if (isTenantPublicIngressError(error)) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  }

  const email = normalizeVoiceConsentEmail(data.email ?? null);
  const phone = normalizeVoiceConsentPhone(data.phone ?? null);
  const callbackPhone = normalizeVoiceConsentPhone(data.callbackPhone ?? null) ?? phone;

  if (!email && !phone && !callbackPhone) {
    return Response.json(
      { error: "At least one valid email or phone value is required." },
      { status: 400 }
    );
  }

  const customerId =
    data.customerId ??
    (await resolveExistingCustomerIdForVoiceConsent({
      tenantId,
      email,
      phone: callbackPhone ?? phone
    }));

  const occurredAt = data.occurredAt ? new Date(data.occurredAt) : new Date();
  const source =
    readSource(data.source) ??
    (canManage ? "agent_portal" : trustedSecret ? "trusted_api" : "help_center_self_service");
  const termsVersion = data.termsVersion ?? process.env.CALLS_CONSENT_TERMS_VERSION ?? null;

  await recordVoiceConsentEvent({
    tenantId,
    decision: data.action === "grant" ? "granted" : "revoked",
    customerId,
    email,
    phone: callbackPhone ?? phone,
    callbackPhone,
    termsVersion,
    source,
    occurredAt,
    metadata: {
      actorUserId: canManage ? sessionUser?.id ?? null : null,
      actorType: canManage ? "agent" : trustedSecret ? "trusted_api" : "public",
      userAgent: request.headers.get("user-agent") ?? null,
      ...(data.metadata ?? {})
    }
  });

  const consent = await getLatestVoiceConsentState({
    tenantId,
    customerId,
    phone: callbackPhone ?? phone,
    email
  });

  return Response.json({
    status: "updated",
    action: data.action,
    consent
  });
}
