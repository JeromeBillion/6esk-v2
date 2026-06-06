import { z } from "zod";
import { db } from "@/server/db";
import { createSession } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
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
  const result = await db.query(
    `SELECT id, password_hash, is_active
     FROM users
     WHERE lower(email) = $1
     LIMIT 1`,
    [email.toLowerCase()]
  );

  const user = result.rows[0];
  if (!user || !user.is_active) {
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!(await verifyPassword(password, user.password_hash))) {
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  }

  await createSession(user.id);
  return Response.json({ status: "ok" });
}
