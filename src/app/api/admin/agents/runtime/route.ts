import { resolveTenantAiProviderPlan, type AiProviderPlan } from "@/server/ai/provider-gateway";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { getDexterRuntimeStatus } from "@/server/dexter-runtime";

function serializeProviderGatewayStatus(plan: AiProviderPlan) {
  return {
    status: plan.status,
    providerMode: plan.providerMode,
    provider: plan.provider,
    model: plan.model,
    timeoutMs: plan.timeoutMs,
    fallbackModels: plan.fallbackModels,
    costCapture: plan.costCapture,
    denialReason: plan.denialReason
  };
}

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const providerPlan = await resolveTenantAiProviderPlan(tenantId);
  return Response.json({
    runtime: getDexterRuntimeStatus(),
    providerGateway: serializeProviderGatewayStatus(providerPlan)
  });
}
