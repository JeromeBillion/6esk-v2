import { z } from "zod";
import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import {
  createAgentIntegration,
  listAgentIntegrations
} from "@/server/agents/integrations";

const createSchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url(),
  sharedSecret: z.string().min(8),
  provider: z.string().optional(),
  authType: z.string().optional(),
  status: z.enum(["active", "paused"]).optional(),
  policyMode: z.enum(["draft_only", "auto_send"]).optional(),
  scopes: z.record(z.unknown()).optional(),
  capabilities: z.record(z.unknown()).optional()
});

export async function GET() {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const agents = await listAgentIntegrations();
  return Response.json({ agents });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const agent = await createAgentIntegration(parsed.data);
  return Response.json({ status: "created", agent });
}
