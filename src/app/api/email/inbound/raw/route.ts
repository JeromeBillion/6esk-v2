import { processInboundEmailPayload } from "@/server/email/process-inbound";
import { parseRawInboundEmail } from "@/server/email/raw-inbound";

type RawInboundRequest = {
  raw: string;
  metadata?: Record<string, unknown> | null;
};

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
  }

  let payload: RawInboundRequest;
  try {
    payload = (await request.json()) as RawInboundRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!payload || typeof payload.raw !== "string" || !payload.raw.trim()) {
    return Response.json({ error: "raw is required" }, { status: 400 });
  }

  try {
    const decodedRaw = Buffer.from(payload.raw, "base64").toString("utf8");
    const parsed = await parseRawInboundEmail(decodedRaw, payload.metadata ?? null);
    const result = await processInboundEmailPayload(parsed);
    return Response.json(result.body, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to parse raw inbound email";
    return Response.json({ error: "Failed to process raw inbound email", details: message }, { status: 500 });
  }
}
