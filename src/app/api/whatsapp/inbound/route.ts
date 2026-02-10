import { db } from "@/server/db";

async function getVerifyToken() {
  const result = await db.query(
    `SELECT verify_token FROM whatsapp_accounts ORDER BY created_at DESC LIMIT 1`
  );
  const stored = result.rows[0]?.verify_token ?? "";
  return stored || process.env.WHATSAPP_VERIFY_TOKEN || "";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token) {
    const verifyToken = await getVerifyToken();
    if (verifyToken && token === verifyToken) {
      return new Response(challenge ?? "", { status: 200 });
    }
  }

  return Response.json({ error: "Forbidden" }, { status: 403 });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  await db.query(
    `INSERT INTO whatsapp_events (direction, payload, status)
     VALUES ($1, $2, $3)`,
    ["inbound", payload, "received"]
  );

  return Response.json({ status: "received" });
}
