import { db } from "@/server/db";

type SecurityReadinessCheck = {
  key: string;
  ok: boolean;
  detail: string;
};

type CountRow = {
  count: string | number;
};

function isExplicitlyEnabled(value: string | undefined) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function numberFromCount(value: string | number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getSecurityReadinessSnapshot() {
  const requiredSecrets = [
    "SESSION_SECRET",
    "INBOUND_SHARED_SECRET",
    "AGENT_SECRET_KEY",
    "CRON_SECRET",
    "WHATSAPP_APP_SECRET",
    "CALLS_WEBHOOK_SECRET",
    "CALLS_OUTBOX_SECRET"
  ];
  const missingSecrets = requiredSecrets.filter((key) => !hasValue(process.env[key]));

  const oauthKey = process.env.OAUTH_ENCRYPTION_KEY ?? "";
  const oauthKeyValid = /^[a-f0-9]{64}$/i.test(oauthKey);

  const unsafeWebhookToggles = [
    "WHATSAPP_ALLOW_UNSIGNED_WEBHOOKS",
    "CALLS_WEBHOOK_ALLOW_UNAUTHENTICATED",
    "CALLS_WEBHOOK_ALLOW_LEGACY_BODY_SIGNATURE"
  ].filter((key) => isExplicitlyEnabled(process.env[key]));

  const [
    impersonationResult,
    activeGrantResult,
    pendingReviewResult,
    failedCallOutboxResult,
    failedWhatsAppOutboxResult,
    failedEmailOutboxResult
  ] =
    await Promise.all([
      db.query<CountRow>(
        `/* tenant-query-guard: ignore internal-security-readiness global impersonation count */
         SELECT COUNT(*)::bigint AS count
         FROM auth_sessions
         WHERE impersonated_tenant_id IS NOT NULL
           AND impersonation_expires_at > now()`
      ),
      db.query<CountRow>(
        `/* tenant-query-guard: ignore internal-security-readiness global privileged-access count */
         SELECT COUNT(*)::bigint AS count
         FROM privileged_access_grants
         WHERE status = 'active'
           AND expires_at > now()`
      ),
      db.query<CountRow>(
        `/* tenant-query-guard: ignore internal-security-readiness global privileged-access review count */
         SELECT COUNT(*)::bigint AS count
         FROM privileged_access_grants
         WHERE status IN ('expired', 'revoked')
           AND metadata->'postEventReview' IS NULL`
      ),
      db.query<CountRow>(
        `/* tenant-query-guard: ignore internal-security-readiness global failed-call-outbox count */
         SELECT COUNT(*)::bigint AS count
         FROM call_outbox_events
         WHERE direction = 'outbound'
           AND status = 'failed'`
      ),
      db.query<CountRow>(
        `/* tenant-query-guard: ignore internal-security-readiness global failed-whatsapp-outbox count */
         SELECT COUNT(*)::bigint AS count
         FROM whatsapp_events
         WHERE direction = 'outbound'
           AND status = 'failed'`
      ),
      db.query<CountRow>(
        `/* tenant-query-guard: ignore internal-security-readiness global failed-email-outbox count */
         SELECT COUNT(*)::bigint AS count
         FROM email_outbox_events
         WHERE direction = 'outbound'
           AND status = 'failed'`
      )
    ]);

  const activeImpersonations = numberFromCount(impersonationResult.rows[0]?.count ?? 0);
  const activePrivilegedAccessGrants = numberFromCount(activeGrantResult.rows[0]?.count ?? 0);
  const privilegedAccessGrantsNeedingReview = numberFromCount(pendingReviewResult.rows[0]?.count ?? 0);
  const failedCallOutbox = numberFromCount(failedCallOutboxResult.rows[0]?.count ?? 0);
  const failedWhatsAppOutbox = numberFromCount(failedWhatsAppOutboxResult.rows[0]?.count ?? 0);
  const failedEmailOutbox = numberFromCount(failedEmailOutboxResult.rows[0]?.count ?? 0);

  const checks: SecurityReadinessCheck[] = [
    {
      key: "required_secrets_present",
      ok: missingSecrets.length === 0,
      detail: missingSecrets.length ? `Missing: ${missingSecrets.join(", ")}` : "All required secrets present"
    },
    {
      key: "oauth_encryption_key_valid",
      ok: oauthKeyValid,
      detail: oauthKeyValid ? "OAUTH_ENCRYPTION_KEY is valid 64-char hex" : "OAUTH_ENCRYPTION_KEY missing/invalid"
    },
    {
      key: "unsafe_webhook_toggles_disabled",
      ok: unsafeWebhookToggles.length === 0,
      detail: unsafeWebhookToggles.length
        ? `Unsafe toggles enabled: ${unsafeWebhookToggles.join(", ")}`
        : "Webhook bypass toggles are disabled"
    }
  ];

  const failedOutboxTotal = failedCallOutbox + failedWhatsAppOutbox + failedEmailOutbox;
  const healthy = checks.every((check) => check.ok);

  return {
    healthy,
    generatedAt: new Date().toISOString(),
    checks,
    operations: {
      activeImpersonations,
      activePrivilegedAccessGrants,
      privilegedAccessGrantsNeedingReview,
      failedOutbox: {
        total: failedOutboxTotal,
        calls: failedCallOutbox,
        whatsapp: failedWhatsAppOutbox,
        email: failedEmailOutbox
      }
    }
  };
}
