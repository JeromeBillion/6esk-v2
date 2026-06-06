import { getEmailOutboxMetrics } from "@/server/email/outbox";
import { getWhatsAppOutboxMetrics } from "@/server/whatsapp/outbox-metrics";
import { getCallOutboxMetrics } from "@/server/calls/outbox";
import { getDexterRuntimeStatus } from "@/server/dexter-runtime";

export async function getOpsHealthSnapshot(input?: { tenantId?: string | null }) {
  const tenantId = input?.tenantId ?? null;
  const [email, whatsapp, calls] = await Promise.all([
    getEmailOutboxMetrics(tenantId),
    getWhatsAppOutboxMetrics(tenantId),
    getCallOutboxMetrics(tenantId)
  ]);
  const dexter = getDexterRuntimeStatus();

  const failureCount =
    (email.queue.failed ?? 0) + (whatsapp.queue.failed ?? 0) + (calls.queue.failed ?? 0);

  const ready =
    dexter.state !== "failed" &&
    failureCount === 0;

  return {
    ready,
    generatedAt: new Date().toISOString(),
    tenantId,
    queues: {
      email: email.queue,
      whatsapp: whatsapp.queue,
      calls: calls.queue
    },
    runtime: {
      dexter
    }
  };
}
