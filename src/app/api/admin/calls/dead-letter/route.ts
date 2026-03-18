import { getSessionUser } from "@/server/auth/session";
import { isLeadAdmin } from "@/server/auth/roles";
import { db } from "@/server/db";
import { redactCallData } from "@/server/calls/redaction";
import { recordAuditLog } from "@/server/audit";

export type DeadLetterEvent = {
  id: string;
  call_session_id: string | null;
  direction: "inbound" | "outbound";
  status: "failed" | "poison" | "quarantined";
  reason: string | null;
  attempt_count: number;
  max_attempts: number;
  last_error: string | null;
  last_error_code: string | null;
  payload: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  next_attempt_at: Date | null;
};

export type DeadLetterSummary = {
  total: number;
  byStatus: {
    failed: number;
    poison: number;
    quarantined: number;
  };
  byErrorCode: Array<{
    code: string;
    count: number;
  }>;
  oldestEvent: {
    id: string;
    createdAt: Date;
    age_minutes: number;
  } | null;
};

/**
 * Get dead-letter events (failed calls with exhausted retries or poison conditions)
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action") ?? "list";
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam ?? 50) || 50, 1), 200);
  const statusFilter = url.searchParams.get("status") ?? "all";
  const callSessionId = url.searchParams.get("callSessionId");

  let query = `
    SELECT
      id,
      call_session_id,
      direction,
      status,
      reason,
      attempt_count,
      (CASE WHEN direction = 'outbound' THEN 5 ELSE 3 END)::int AS max_attempts,
      last_error,
      last_error_code,
      payload,
      created_at,
      updated_at,
      next_attempt_at,
      EXTRACT(EPOCH FROM (now() - created_at)) / 60.0 AS age_minutes
    FROM call_outbox_events
    WHERE (status = 'failed' OR last_error IS NOT NULL)
  `;

  const params: (string | number)[] = [];

  if (statusFilter !== "all") {
    query += ` AND status = $${params.length + 1}`;
    params.push(statusFilter);
  }

  if (callSessionId) {
    query += ` AND call_session_id = $${params.length + 1}`;
    params.push(callSessionId);
  }

  if (action === "list") {
    query += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await db.query<DeadLetterEvent>(query, params);
    return Response.json({
      status: "ok",
      action: "list",
      events: result.rows.map((row) => ({
        ...row,
        payload: redactCallData(row.payload)
      }))
    });
  }

  if (action === "summary") {
    // Count by status
    const statusResult = await db.query<{
      status: string;
      count: number;
    }>(
      `SELECT status, COUNT(*)::int AS count
       FROM call_outbox_events
       WHERE (status = 'failed' OR last_error IS NOT NULL)
       GROUP BY status`
    );

    // Count by error code
    const errorCodeResult = await db.query<{
      code: string | null;
      count: number;
    }>(
      `SELECT last_error_code AS code, COUNT(*)::int AS count
       FROM call_outbox_events
       WHERE (status = 'failed' OR last_error IS NOT NULL)
       GROUP BY last_error_code
       ORDER BY count DESC
       LIMIT 10`
    );

    // Find oldest event
    const oldestResult = await db.query<{
      id: string;
      created_at: Date;
      age_minutes: number;
    }>(
      `SELECT id, created_at,
              EXTRACT(EPOCH FROM (now() - created_at)) / 60.0 AS age_minutes
       FROM call_outbox_events
       WHERE (status = 'failed' OR last_error IS NOT NULL)
       ORDER BY created_at ASC
       LIMIT 1`
    );

    const summary: DeadLetterSummary = {
      total: statusResult.rows.reduce((sum, row) => sum + row.count, 0),
      byStatus: {
        failed: statusResult.rows.find((r) => r.status === "failed")?.count ?? 0,
        poison: statusResult.rows.find((r) => r.status === "poison")?.count ?? 0,
        quarantined: statusResult.rows.find((r) => r.status === "quarantined")?.count ?? 0
      },
      byErrorCode: errorCodeResult.rows
        .filter((row) => row.code)
        .map((row) => ({
          code: row.code!,
          count: row.count
        })),
      oldestEvent: oldestResult.rows[0]
        ? {
            id: oldestResult.rows[0].id,
            createdAt: oldestResult.rows[0].created_at,
            age_minutes: oldestResult.rows[0].age_minutes
          }
        : null
    };

    return Response.json({
      status: "ok",
      action: "summary",
      summary
    });
  }

  return Response.json(
    { error: `Unknown action: ${action}` },
    { status: 400 }
  );
}

/**
 * Mark dead-letter event as recoverable and reset for retry
 */
export async function PATCH(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { eventId, action: patchAction, notes } = body as {
    eventId?: string;
    action?: string;
    notes?: string;
  };

  if (!eventId || !patchAction) {
    return Response.json({ error: "Missing eventId or action" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Verify event exists
    const event = await client.query(
      `SELECT id, call_session_id FROM call_outbox_events WHERE id = $1`,
      [eventId]
    );

    if (event.rows.length === 0) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Event not found" }, { status: 404 });
    }

    const eventRow = event.rows[0];

    if (patchAction === "recover") {
      // Reset to queued for retry
      await client.query(
        `UPDATE call_outbox_events
         SET status = 'queued',
             attempt_count = LEAST(attempt_count, 2),
             last_error = NULL,
             last_error_code = NULL,
             next_attempt_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [eventId]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user?.id ?? null,
          "dead_letter_recovered",
          "call_outbox_events",
          eventId,
          {
            notes,
            callSessionId: eventRow.call_session_id,
            recoveredAt: new Date().toISOString()
          }
        ]
      );
    } else if (patchAction === "quarantine") {
      // Mark as quarantined (do not retry automatically)
      await client.query(
        `UPDATE call_outbox_events
         SET status = 'quarantined',
             reason = $1,
             updated_at = now()
         WHERE id = $2`,
        [notes || "Manual quarantine", eventId]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user?.id ?? null,
          "dead_letter_quarantined",
          "call_outbox_events",
          eventId,
          {
            reason: notes,
            callSessionId: eventRow.call_session_id,
            quarantinedAt: new Date().toISOString()
          }
        ]
      );
    } else if (patchAction === "discard") {
      // Remove the event (irreversible, use with caution)
      await client.query(
        `DELETE FROM call_outbox_events WHERE id = $1`,
        [eventId]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user?.id ?? null,
          "dead_letter_discarded",
          "call_outbox_events",
          eventId,
          {
            reason: notes || "Manual discard",
            callSessionId: eventRow.call_session_id,
            discardedAt: new Date().toISOString()
          }
        ]
      );
    } else {
      await client.query("ROLLBACK");
      return Response.json({ error: `Unknown action: ${patchAction}` }, { status: 400 });
    }

    await client.query("COMMIT");

    return Response.json({
      status: "ok",
      action: patchAction,
      eventId,
      message: `Dead-letter event ${patchAction}ed successfully`
    });
  } catch (error) {
    await client.query("ROLLBACK");
    const detail = error instanceof Error ? error.message : "Database error";
    return Response.json({ error: detail }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * Batch recover multiple dead-letter events
 */
export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!isLeadAdmin(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, eventIds, filter, notes } = body as {
    action?: string;
    eventIds?: string[];
    filter?: { status?: string; maxAgeMinutes?: number };
    notes?: string;
  };

  if (!action) {
    return Response.json({ error: "Missing action" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    let whereClause = "(status = 'failed' OR last_error IS NOT NULL)";
    const params: (string | number | string[])[] = [];

    if (eventIds && eventIds.length > 0) {
      whereClause = `id = ANY($${params.length + 1})`;
      params.push(eventIds);
    } else if (filter) {
      if (filter.status) {
        whereClause += ` AND status = $${params.length + 1}`;
        params.push(filter.status);
      }
      if (filter.maxAgeMinutes) {
        whereClause += ` AND (now() - created_at) <= $${params.length + 1} * INTERVAL '1 minute'`;
        params.push(filter.maxAgeMinutes);
      }
    } else {
      await client.query("ROLLBACK");
      return Response.json(
        { error: "Must provide eventIds or filter" },
        { status: 400 }
      );
    }

    if (action === "recover") {
      const updateParams = [...params];
      const result = await client.query<{ id: string }>(
        `UPDATE call_outbox_events
         SET status = 'queued',
             attempt_count = LEAST(attempt_count, 2),
             last_error = NULL,
             last_error_code = NULL,
             next_attempt_at = now(),
             updated_at = now()
         WHERE ${whereClause}
         RETURNING id`,
        updateParams
      );

      const recoveredCount = result.rows.length;

      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          user?.id ?? null,
          "dead_letter_batch_recovered",
          "call_outbox_events",
          null,
          {
            count: recoveredCount,
            notes,
            recoveredAt: new Date().toISOString(),
            eventIds: result.rows.map((r) => r.id)
          }
        ]
      );

      await client.query("COMMIT");

      return Response.json({
        status: "ok",
        action: "batch_recover",
        recoveredCount,
        message: `Recovered ${recoveredCount} dead-letter event(s)`
      });
    } else {
      await client.query("ROLLBACK");
      return Response.json({ error: `Unknown batch action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    await client.query("ROLLBACK");
    const detail = error instanceof Error ? error.message : "Database error";
    return Response.json({ error: detail }, { status: 500 });
  } finally {
    client.release();
  }
}
