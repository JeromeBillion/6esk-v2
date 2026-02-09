import { z } from "zod";

const envSchema = z.object({
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  RESEND_API_KEY: z.string().min(1),
  RESEND_WEBHOOK_SECRET: z.string().min(1),
  RESEND_FROM_DOMAIN: z.string().min(1),
  SUPPORT_ADDRESS: z.string().min(1).optional(),
  INBOUND_SHARED_SECRET: z.string().min(1).optional(),
  AGENT_SECRET_KEY: z.string().min(16).optional(),
  ADMIN_IP_ALLOWLIST: z.string().optional(),
  AGENT_IP_ALLOWLIST: z.string().optional(),
  INBOUND_ALERT_WEBHOOK: z.union([z.string().url(), z.literal("")]).optional(),
  INBOUND_ALERT_THRESHOLD: z.string().optional(),
  INBOUND_ALERT_WINDOW_MINUTES: z.string().optional(),
  INBOUND_ALERT_COOLDOWN_MINUTES: z.string().optional(),
  R2_ENDPOINT: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1)
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function getEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Missing or invalid env vars: ${issues}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
