import { z } from "zod";
import { db } from "@/server/db";
import { createSession } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantKey: z.string().min(1).optional()
});

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const { email, password } = parsed.data;
  const tenantKey = parsed.data.tenantKey?.trim() || "primary";
  const result = await db.query(
    `SELECT id, password_hash, is_active
     FROM users
     WHERE tenant_key = $1
       AND lower(email) = $2
     LIMIT 1`,
    [tenantKey, email.toLowerCase()]
  );

  const user = result.rows[0];
  if (!user || !user.is_active) {
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!verifyPassword(password, user.password_hash)) {
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await createSession(user.id);
  return Response.json({ status: "ok" });
}
