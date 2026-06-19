import { timingSafeEqual } from "crypto";
import { getActiveAgentIntegration, getAgentIntegrationById } from "@/server/agents/integrations";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseBearer(authHeader: string | null) {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function secureCompare(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

function readTenantId(request: Request) {
  const value =
    request.headers.get("x-6esk-tenant-id") ??
    request.headers.get("x-6esk-tenant") ??
    "";
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

export async function getAgentFromRequest(request: Request) {
  const agentId = request.headers.get("x-6esk-agent-id");
  const agentKey =
    request.headers.get("x-6esk-agent-key") ??
    parseBearer(request.headers.get("authorization"));

  if (!agentKey) {
    return null;
  }
  const tenantId = readTenantId(request);
  if (!tenantId) {
    return null;
  }

  const integration = agentId
    ? await getAgentIntegrationById(agentId, tenantId)
    : await getActiveAgentIntegration(tenantId);

  if (!integration) {
    return null;
  }

  if (!secureCompare(agentKey, integration.shared_secret)) {
    return null;
  }

  return integration;
}
