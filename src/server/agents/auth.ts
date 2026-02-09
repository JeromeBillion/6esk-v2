import { timingSafeEqual } from "crypto";
import { getActiveAgentIntegration, getAgentIntegrationById } from "@/server/agents/integrations";

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

export async function getAgentFromRequest(request: Request) {
  const agentId = request.headers.get("x-6esk-agent-id");
  const agentKey =
    request.headers.get("x-6esk-agent-key") ??
    parseBearer(request.headers.get("authorization"));

  if (!agentKey) {
    return null;
  }

  const integration = agentId
    ? await getAgentIntegrationById(agentId)
    : await getActiveAgentIntegration();

  if (!integration) {
    return null;
  }

  if (!secureCompare(agentKey, integration.shared_secret)) {
    return null;
  }

  return integration;
}
