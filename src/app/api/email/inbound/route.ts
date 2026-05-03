import { processInboundEmailPayload } from "@/server/email/process-inbound";
import { canAcceptUnsignedWebhookTraffic } from "@/server/security/webhooks";

function getSharedSecret() {
  return process.env.INBOUND_SHARED_SECRET ?? "";
}

export async function POST(request: Request) {
  const sharedSecret = getSharedSecret();
  if (sharedSecret) {
    const provided = request.headers.get("x-6esk-secret");
    if (provided !== sharedSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (!canAcceptUnsignedWebhookTraffic(process.env.INBOUND_ALLOW_UNAUTHENTICATED)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await processInboundEmailPayload(payload);
  return Response.json(result.body, { status: result.status });
}
