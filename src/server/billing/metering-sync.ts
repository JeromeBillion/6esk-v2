import { db } from "@/server/db";
import { recordAuditLog } from "@/server/audit";
import { getTenantById } from "@/server/tenant/lifecycle";

export interface MeteringProvider {
  reportUsage(params: {
    tenantId: string;
    workspaceKey: string;
    moduleKey: string;
    usageKind: string;
    quantity: number;
    occurredAt: Date;
    eventId: string;
  }): Promise<boolean>;
}

// A mock provider that simulates sending usage to Stripe/Metronome/Orb
class MockMeteringProvider implements MeteringProvider {
  async reportUsage(params: Parameters<MeteringProvider["reportUsage"]>[0]) {
    // In production, this would call Stripe.billing.MeterEvents.create(...)
    // or an equivalent endpoint.
    console.log(`[MeteringEngine] Reported ${params.quantity} ${params.usageKind} for ${params.tenantId} (module: ${params.moduleKey})`);
    return true;
  }
}

export async function syncPendingMeteringEvents(limit = 100) {
  const provider = new MockMeteringProvider();
  
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const pendingResult = await client.query<{
      id: string;
      tenant_id: string;
      workspace_key: string;
      module_key: string;
      usage_kind: string;
      quantity: number;
      created_at: Date;
    }>(
      `SELECT id, tenant_id, workspace_key, module_key, usage_kind, quantity, created_at
       FROM workspace_module_usage_events
       WHERE sync_status = 'pending'
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit]
    );

    if (pendingResult.rows.length === 0) {
      await client.query("COMMIT");
      return { synced: 0, failed: 0 };
    }

    let synced = 0;
    let failed = 0;

    for (const event of pendingResult.rows) {
      try {
        const tenant = await getTenantById(event.tenant_id);
        if (!tenant || tenant.status !== "active") {
          // If tenant doesn't exist or is closed, mark as failed so we don't block the queue
          await client.query(
            `UPDATE workspace_module_usage_events SET sync_status = 'failed', synced_at = now() WHERE id = $1`,
            [event.id]
          );
          failed++;
          continue;
        }

        const success = await provider.reportUsage({
          tenantId: event.tenant_id,
          workspaceKey: event.workspace_key,
          moduleKey: event.module_key,
          usageKind: event.usage_kind,
          quantity: event.quantity,
          occurredAt: event.created_at,
          eventId: event.id
        });

        if (success) {
          await client.query(
            `UPDATE workspace_module_usage_events SET sync_status = 'synced', synced_at = now() WHERE id = $1`,
            [event.id]
          );
          synced++;
        } else {
          await client.query(
            `UPDATE workspace_module_usage_events SET sync_status = 'failed', synced_at = now() WHERE id = $1`,
            [event.id]
          );
          failed++;
        }
      } catch (err) {
        await client.query(
          `UPDATE workspace_module_usage_events SET sync_status = 'failed', synced_at = now() WHERE id = $1`,
          [event.id]
        );
        failed++;
      }
    }

    await client.query("COMMIT");
    return { synced, failed };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
