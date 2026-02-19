import { db } from "@/server/db";
import { buildAgentEvent } from "@/server/agents/events";
import { deliverPendingAgentEvents, enqueueAgentEvent } from "@/server/agents/outbox";
import { appendMergedFromMetadata } from "@/server/tickets";
import type { PoolClient } from "pg";

type MergeErrorCode =
  | "not_found"
  | "invalid_input"
  | "already_merged"
  | "cross_channel_not_allowed"
  | "too_large";

export class MergeError extends Error {
  code: MergeErrorCode;

  constructor(code: MergeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function toCount(value: string | number | null | undefined) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseInt(value, 10) || 0;
  return 0;
}

const DEFAULT_TICKET_MERGE_MAX_MOVE_ROWS = 5000;

function getTicketMergeMaxMoveRows() {
  const parsed = Number.parseInt(
    process.env.TICKET_MERGE_MAX_MOVE_ROWS ?? `${DEFAULT_TICKET_MERGE_MAX_MOVE_ROWS}`,
    10
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TICKET_MERGE_MAX_MOVE_ROWS;
  }
  return parsed;
}

async function getTicketChannel(client: PoolClient, ticketId: string) {
  const result = await client.query<{ has_whatsapp: boolean; has_voice: boolean }>(
    `SELECT
       EXISTS (
         SELECT 1
         FROM messages
         WHERE ticket_id = $1
           AND channel = 'whatsapp'
       ) OR t.requester_email ILIKE 'whatsapp:%' AS has_whatsapp,
       EXISTS (
         SELECT 1
         FROM messages
         WHERE ticket_id = $1
           AND channel = 'voice'
       ) OR t.requester_email ILIKE 'voice:%' AS has_voice
     FROM tickets t
     WHERE t.id = $1
     LIMIT 1`,
    [ticketId]
  );
  if (result.rows[0]?.has_whatsapp) {
    return "whatsapp" as const;
  }
  if (result.rows[0]?.has_voice) {
    return "voice" as const;
  }
  return "email" as const;
}

async function publishAgentMergeEvent({
  eventType,
  payload
}: {
  eventType: string;
  payload: Record<string, unknown>;
}) {
  try {
    await enqueueAgentEvent({ eventType, payload });
    void deliverPendingAgentEvents().catch(() => {});
  } catch {
    // Never fail merge execution because of event delivery issues.
  }
}

export type TicketMergePreflight = {
  sourceTicketId: string;
  targetTicketId: string;
  sourceChannel: "email" | "whatsapp" | "voice";
  targetChannel: "email" | "whatsapp" | "voice";
  sourceTicket: {
    subject: string | null;
    requesterEmail: string;
    status: string;
    priority: string;
    assignedUserId: string | null;
    mergedIntoTicketId: string | null;
  };
  targetTicket: {
    subject: string | null;
    requesterEmail: string;
    status: string;
    priority: string;
    assignedUserId: string | null;
    mergedIntoTicketId: string | null;
  };
  moveCounts: {
    messages: number;
    replies: number;
    events: number;
    drafts: number;
    sourceTags: number;
    newTagsOnTarget: number;
  };
  allowed: boolean;
  blockingCode: "already_merged" | "cross_channel_not_allowed" | "too_large" | null;
  blockingReason: string | null;
};

export async function preflightTicketMerge({
  sourceTicketId,
  targetTicketId
}: {
  sourceTicketId: string;
  targetTicketId: string;
}): Promise<TicketMergePreflight> {
  if (sourceTicketId === targetTicketId) {
    throw new MergeError("invalid_input", "Source and target tickets must be different.");
  }

  const client = await db.connect();
  try {
    const ticketResult = await client.query<{
      id: string;
      merged_into_ticket_id: string | null;
      subject: string | null;
      requester_email: string;
      status: string;
      priority: string;
      assigned_user_id: string | null;
    }>(
      `SELECT
         id,
         merged_into_ticket_id,
         subject,
         requester_email,
         status,
         priority,
         assigned_user_id
       FROM tickets
       WHERE id = ANY($1::uuid[])`,
      [[sourceTicketId, targetTicketId]]
    );

    if (ticketResult.rowCount !== 2) {
      throw new MergeError("not_found", "Source or target ticket was not found.");
    }

    const source = ticketResult.rows.find((row) => row.id === sourceTicketId);
    const target = ticketResult.rows.find((row) => row.id === targetTicketId);
    if (!source || !target) {
      throw new MergeError("not_found", "Source or target ticket was not found.");
    }

    const [sourceChannel, targetChannel] = await Promise.all([
      getTicketChannel(client, sourceTicketId),
      getTicketChannel(client, targetTicketId)
    ]);

    const countsResult = await client.query<{
      messages_count: string;
      replies_count: string;
      events_count: string;
      drafts_count: string;
      source_tag_count: string;
      new_tag_count: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM messages WHERE ticket_id = $1) AS messages_count,
         (SELECT COUNT(*) FROM replies WHERE ticket_id = $1) AS replies_count,
         (SELECT COUNT(*) FROM ticket_events WHERE ticket_id = $1) AS events_count,
         (SELECT COUNT(*) FROM agent_drafts WHERE ticket_id = $1) AS drafts_count,
         (SELECT COUNT(*) FROM ticket_tags WHERE ticket_id = $1) AS source_tag_count,
         (
           SELECT COUNT(*)
           FROM ticket_tags source_tags
           LEFT JOIN ticket_tags target_tags
             ON target_tags.ticket_id = $2
            AND target_tags.tag_id = source_tags.tag_id
           WHERE source_tags.ticket_id = $1
             AND target_tags.tag_id IS NULL
         ) AS new_tag_count`,
      [sourceTicketId, targetTicketId]
    );

    const counts = countsResult.rows[0];
    let blockingCode: "already_merged" | "cross_channel_not_allowed" | "too_large" | null = null;
    let blockingReason: string | null = null;
    const moveRowTotal =
      toCount(counts?.messages_count) +
      toCount(counts?.replies_count) +
      toCount(counts?.events_count) +
      toCount(counts?.drafts_count);
    const maxMoveRows = getTicketMergeMaxMoveRows();

    if (source.merged_into_ticket_id || target.merged_into_ticket_id) {
      blockingCode = "already_merged";
      blockingReason = "Source or target ticket is already merged.";
    } else if (sourceChannel !== targetChannel) {
      blockingCode = "cross_channel_not_allowed";
      blockingReason =
        "Cross-channel ticket merge is disabled. Merge customer profiles instead.";
    } else if (moveRowTotal > maxMoveRows) {
      blockingCode = "too_large";
      blockingReason = `Merge impact exceeds configured cap (${moveRowTotal} rows > ${maxMoveRows}).`;
    }

    return {
      sourceTicketId,
      targetTicketId,
      sourceChannel,
      targetChannel,
      sourceTicket: {
        subject: source.subject,
        requesterEmail: source.requester_email,
        status: source.status,
        priority: source.priority,
        assignedUserId: source.assigned_user_id,
        mergedIntoTicketId: source.merged_into_ticket_id
      },
      targetTicket: {
        subject: target.subject,
        requesterEmail: target.requester_email,
        status: target.status,
        priority: target.priority,
        assignedUserId: target.assigned_user_id,
        mergedIntoTicketId: target.merged_into_ticket_id
      },
      moveCounts: {
        messages: toCount(counts?.messages_count),
        replies: toCount(counts?.replies_count),
        events: toCount(counts?.events_count),
        drafts: toCount(counts?.drafts_count),
        sourceTags: toCount(counts?.source_tag_count),
        newTagsOnTarget: toCount(counts?.new_tag_count)
      },
      allowed: !blockingCode,
      blockingCode,
      blockingReason
    };
  } finally {
    client.release();
  }
}

export type CustomerMergePreflight = {
  sourceCustomerId: string;
  targetCustomerId: string;
  sourceCustomer: {
    kind: "registered" | "unregistered";
    displayName: string | null;
    primaryEmail: string | null;
    primaryPhone: string | null;
    mergedIntoCustomerId: string | null;
  };
  targetCustomer: {
    kind: "registered" | "unregistered";
    displayName: string | null;
    primaryEmail: string | null;
    primaryPhone: string | null;
    mergedIntoCustomerId: string | null;
  };
  moveCounts: {
    totalTickets: number;
    activeTickets: number;
    activeEmailTickets: number;
    activeWhatsappTickets: number;
    sourceIdentities: number;
    identitiesToMove: number;
    identityConflicts: number;
  };
  allowed: boolean;
  blockingCode: "already_merged" | null;
  blockingReason: string | null;
};

export async function preflightCustomerMerge({
  sourceCustomerId,
  targetCustomerId
}: {
  sourceCustomerId: string;
  targetCustomerId: string;
}): Promise<CustomerMergePreflight> {
  if (sourceCustomerId === targetCustomerId) {
    throw new MergeError("invalid_input", "Source and target customers must be different.");
  }

  const client = await db.connect();
  try {
    const customerResult = await client.query<{
      id: string;
      kind: "registered" | "unregistered";
      display_name: string | null;
      primary_email: string | null;
      primary_phone: string | null;
      merged_into_customer_id: string | null;
    }>(
      `SELECT
         id,
         kind,
         display_name,
         primary_email,
         primary_phone,
         merged_into_customer_id
       FROM customers
       WHERE id = ANY($1::uuid[])`,
      [[sourceCustomerId, targetCustomerId]]
    );

    if (customerResult.rowCount !== 2) {
      throw new MergeError("not_found", "Source or target customer was not found.");
    }

    const source = customerResult.rows.find((row) => row.id === sourceCustomerId);
    const target = customerResult.rows.find((row) => row.id === targetCustomerId);
    if (!source || !target) {
      throw new MergeError("not_found", "Source or target customer was not found.");
    }

    const countsResult = await client.query<{
      total_tickets: string;
      active_tickets: string;
      active_whatsapp_tickets: string;
      active_email_tickets: string;
      source_identity_count: string;
      identities_to_move_count: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM tickets WHERE customer_id = $1) AS total_tickets,
         (
           SELECT COUNT(*)
           FROM tickets
           WHERE customer_id = $1
             AND merged_into_ticket_id IS NULL
         ) AS active_tickets,
         (
           SELECT COUNT(*)
           FROM tickets t
           WHERE t.customer_id = $1
             AND t.merged_into_ticket_id IS NULL
             AND EXISTS (
               SELECT 1
               FROM messages m
               WHERE m.ticket_id = t.id
                 AND m.channel = 'whatsapp'
             )
         ) AS active_whatsapp_tickets,
          (
            SELECT COUNT(*)
            FROM tickets t
            WHERE t.customer_id = $1
              AND t.merged_into_ticket_id IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM messages m
                WHERE m.ticket_id = t.id
                  AND m.channel = 'whatsapp'
              )
              AND NOT EXISTS (
                SELECT 1
                FROM messages m
                WHERE m.ticket_id = t.id
                  AND m.channel = 'voice'
              )
          ) AS active_email_tickets,
         (
           SELECT COUNT(*)
           FROM customer_identities
           WHERE customer_id = $1
         ) AS source_identity_count,
         (
           SELECT COUNT(*)
           FROM customer_identities source_identity
           WHERE source_identity.customer_id = $1
             AND NOT EXISTS (
               SELECT 1
               FROM customer_identities target_identity
               WHERE target_identity.customer_id = $2
                 AND target_identity.identity_type = source_identity.identity_type
                 AND target_identity.identity_value = source_identity.identity_value
             )
         ) AS identities_to_move_count`,
      [sourceCustomerId, targetCustomerId]
    );

    const counts = countsResult.rows[0];
    const sourceIdentities = toCount(counts?.source_identity_count);
    const identitiesToMove = toCount(counts?.identities_to_move_count);
    let blockingCode: "already_merged" | null = null;
    let blockingReason: string | null = null;

    if (source.merged_into_customer_id || target.merged_into_customer_id) {
      blockingCode = "already_merged";
      blockingReason = "Source or target customer is already merged.";
    }

    return {
      sourceCustomerId,
      targetCustomerId,
      sourceCustomer: {
        kind: source.kind,
        displayName: source.display_name,
        primaryEmail: source.primary_email,
        primaryPhone: source.primary_phone,
        mergedIntoCustomerId: source.merged_into_customer_id
      },
      targetCustomer: {
        kind: target.kind,
        displayName: target.display_name,
        primaryEmail: target.primary_email,
        primaryPhone: target.primary_phone,
        mergedIntoCustomerId: target.merged_into_customer_id
      },
      moveCounts: {
        totalTickets: toCount(counts?.total_tickets),
        activeTickets: toCount(counts?.active_tickets),
        activeEmailTickets: toCount(counts?.active_email_tickets),
        activeWhatsappTickets: toCount(counts?.active_whatsapp_tickets),
        sourceIdentities,
        identitiesToMove,
        identityConflicts: Math.max(0, sourceIdentities - identitiesToMove)
      },
      allowed: !blockingCode,
      blockingCode,
      blockingReason
    };
  } finally {
    client.release();
  }
}

export async function mergeTickets({
  sourceTicketId,
  targetTicketId,
  actorUserId,
  reason
}: {
  sourceTicketId: string;
  targetTicketId: string;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  if (sourceTicketId === targetTicketId) {
    throw new MergeError("invalid_input", "Source and target tickets must be different.");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const lockResult = await client.query<{
      id: string;
      customer_id: string | null;
      merged_into_ticket_id: string | null;
      mailbox_id: string | null;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT id, customer_id, merged_into_ticket_id, mailbox_id, metadata
       FROM tickets
       WHERE id = ANY($1::uuid[])
       FOR UPDATE`,
      [[sourceTicketId, targetTicketId]]
    );

    if (lockResult.rowCount !== 2) {
      throw new MergeError("not_found", "Source or target ticket was not found.");
    }

    const source = lockResult.rows.find((row) => row.id === sourceTicketId);
    const target = lockResult.rows.find((row) => row.id === targetTicketId);
    if (!source || !target) {
      throw new MergeError("not_found", "Source or target ticket was not found.");
    }

    if (source.merged_into_ticket_id || target.merged_into_ticket_id) {
      throw new MergeError("already_merged", "Source or target ticket is already merged.");
    }

    const [sourceChannel, targetChannel] = await Promise.all([
      getTicketChannel(client, sourceTicketId),
      getTicketChannel(client, targetTicketId)
    ]);

    if (sourceChannel !== targetChannel) {
      throw new MergeError(
        "cross_channel_not_allowed",
        "Cross-channel ticket merge is disabled. Merge customer profiles instead."
      );
    }

    const moveCountResult = await client.query<{
      messages_count: string;
      replies_count: string;
      events_count: string;
      drafts_count: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM messages WHERE ticket_id = $1) AS messages_count,
         (SELECT COUNT(*) FROM replies WHERE ticket_id = $1) AS replies_count,
         (SELECT COUNT(*) FROM ticket_events WHERE ticket_id = $1) AS events_count,
         (SELECT COUNT(*) FROM agent_drafts WHERE ticket_id = $1) AS drafts_count`,
      [sourceTicketId]
    );
    const sourceMoveCounts = moveCountResult.rows[0];
    const moveRowTotal =
      toCount(sourceMoveCounts?.messages_count) +
      toCount(sourceMoveCounts?.replies_count) +
      toCount(sourceMoveCounts?.events_count) +
      toCount(sourceMoveCounts?.drafts_count);
    const maxMoveRows = getTicketMergeMaxMoveRows();
    if (moveRowTotal > maxMoveRows) {
      throw new MergeError(
        "too_large",
        `Merge impact exceeds configured cap (${moveRowTotal} rows > ${maxMoveRows}).`
      );
    }

    const movedMessages = await client.query(
      `UPDATE messages
       SET ticket_id = $1
       WHERE ticket_id = $2`,
      [targetTicketId, sourceTicketId]
    );

    const movedReplies = await client.query(
      `UPDATE replies
       SET ticket_id = $1
       WHERE ticket_id = $2`,
      [targetTicketId, sourceTicketId]
    );

    const movedEvents = await client.query(
      `UPDATE ticket_events
       SET ticket_id = $1
       WHERE ticket_id = $2`,
      [targetTicketId, sourceTicketId]
    );

    const movedDrafts = await client.query(
      `UPDATE agent_drafts
       SET ticket_id = $1
       WHERE ticket_id = $2`,
      [targetTicketId, sourceTicketId]
    );

    await client.query(
      `INSERT INTO ticket_tags (ticket_id, tag_id)
       SELECT $1, tag_id
       FROM ticket_tags
       WHERE ticket_id = $2
       ON CONFLICT (ticket_id, tag_id) DO NOTHING`,
      [targetTicketId, sourceTicketId]
    );

    await client.query(
      `DELETE FROM ticket_tags
       WHERE ticket_id = $1`,
      [sourceTicketId]
    );

    const summary = {
      movedMessages: movedMessages.rowCount ?? 0,
      movedReplies: movedReplies.rowCount ?? 0,
      movedEvents: movedEvents.rowCount ?? 0,
      movedDrafts: movedDrafts.rowCount ?? 0
    };
    const mergedAt = new Date().toISOString();
    const targetMetadata = appendMergedFromMetadata(target.metadata, {
      sourceTicketId,
      sourceChannel,
      mergedAt,
      reason: reason ?? null,
      ...summary
    });

    await client.query(
      `UPDATE tickets
       SET customer_id = COALESCE(customer_id, $2),
           metadata = $3::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [targetTicketId, source.customer_id, JSON.stringify(targetMetadata)]
    );

    await client.query(
      `UPDATE tickets
       SET merged_into_ticket_id = $1,
           merged_by_user_id = $2,
           merged_at = $3,
           status = 'closed',
           updated_at = now()
       WHERE id = $4`,
      [targetTicketId, actorUserId ?? null, mergedAt, sourceTicketId]
    );

    await client.query(
      `INSERT INTO ticket_merges (
        source_ticket_id,
        target_ticket_id,
        source_channel,
        target_channel,
        reason,
        actor_user_id,
        summary
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7
      )`,
      [
        sourceTicketId,
        targetTicketId,
        sourceChannel,
        targetChannel,
        reason ?? null,
        actorUserId ?? null,
        summary
      ]
    );

    await client.query(
      `INSERT INTO ticket_events (ticket_id, event_type, actor_user_id, data)
       VALUES
       ($1, 'ticket_merged', $2, $3),
       ($4, 'ticket_merged_into', $2, $5)`,
      [
        sourceTicketId,
        actorUserId ?? null,
        { targetTicketId, reason: reason ?? null, mergedAt },
        targetTicketId,
        { sourceTicketId, reason: reason ?? null, mergedAt, ...summary }
      ]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'ticket_merged', 'ticket', $2, $3)`,
      [
        actorUserId ?? null,
        sourceTicketId,
        { sourceTicketId, targetTicketId, reason: reason ?? null, mergedAt, ...summary }
      ]
    );

    await client.query("COMMIT");

    const mergeEvent = buildAgentEvent({
      eventType: "ticket.merged",
      ticketId: targetTicketId,
      mailboxId: target.mailbox_id ?? source.mailbox_id ?? null,
      actorUserId: actorUserId ?? null,
      threadId: targetTicketId,
      excerpt: `Merged ticket ${sourceTicketId} into ${targetTicketId}`
    });
    await publishAgentMergeEvent({
      eventType: "ticket.merged",
      payload: {
        ...mergeEvent,
        merge: {
          sourceTicketId,
          targetTicketId,
          sourceChannel,
          targetChannel,
          reason: reason ?? null,
          mergedAt,
          ...summary
        }
      }
    });

    return {
      sourceTicketId,
      targetTicketId,
      channel: sourceChannel,
      ...summary
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function mergeCustomers({
  sourceCustomerId,
  targetCustomerId,
  actorUserId,
  reason
}: {
  sourceCustomerId: string;
  targetCustomerId: string;
  actorUserId?: string | null;
  reason?: string | null;
}) {
  if (sourceCustomerId === targetCustomerId) {
    throw new MergeError("invalid_input", "Source and target customers must be different.");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const customerLock = await client.query<{
      id: string;
      primary_email: string | null;
      primary_phone: string | null;
      merged_into_customer_id: string | null;
    }>(
      `SELECT id, primary_email, primary_phone, merged_into_customer_id
       FROM customers
       WHERE id = ANY($1::uuid[])
       FOR UPDATE`,
      [[sourceCustomerId, targetCustomerId]]
    );

    if (customerLock.rowCount !== 2) {
      throw new MergeError("not_found", "Source or target customer was not found.");
    }

    const source = customerLock.rows.find((row) => row.id === sourceCustomerId);
    const target = customerLock.rows.find((row) => row.id === targetCustomerId);
    if (!source || !target) {
      throw new MergeError("not_found", "Source or target customer was not found.");
    }

    if (source.merged_into_customer_id || target.merged_into_customer_id) {
      throw new MergeError("already_merged", "Source or target customer is already merged.");
    }

    const movedTickets = await client.query(
      `UPDATE tickets
       SET customer_id = $1,
           updated_at = now()
       WHERE customer_id = $2`,
      [targetCustomerId, sourceCustomerId]
    );

    const targetRepresentativeTicket = await client.query<{
      id: string;
      mailbox_id: string | null;
    }>(
      `SELECT id, mailbox_id
       FROM tickets
       WHERE customer_id = $1
         AND merged_into_ticket_id IS NULL
       ORDER BY COALESCE(updated_at, created_at) DESC
       LIMIT 1`,
      [targetCustomerId]
    );

    const movedIdentityInsert = await client.query(
      `INSERT INTO customer_identities (
        customer_id,
        identity_type,
        identity_value,
        is_primary,
        source,
        created_at,
        updated_at
      )
      SELECT
        $1,
        identity_type,
        identity_value,
        is_primary,
        'manual_merge',
        created_at,
        now()
      FROM customer_identities
      WHERE customer_id = $2
      ON CONFLICT (identity_type, identity_value) DO NOTHING`,
      [targetCustomerId, sourceCustomerId]
    );

    await client.query(
      `DELETE FROM customer_identities
       WHERE customer_id = $1`,
      [sourceCustomerId]
    );

    await client.query(
      `UPDATE customers
       SET primary_email = COALESCE(primary_email, $2),
           primary_phone = COALESCE(primary_phone, $3),
           updated_at = now()
       WHERE id = $1`,
      [targetCustomerId, source.primary_email, source.primary_phone]
    );

    await client.query(
      `UPDATE customers
       SET merged_into_customer_id = $1,
           merge_reason = $2,
           merged_by_user_id = $3,
           merged_at = now(),
           updated_at = now()
       WHERE id = $4`,
      [targetCustomerId, reason ?? null, actorUserId ?? null, sourceCustomerId]
    );

    await client.query(
      `INSERT INTO customer_merges (
        source_customer_id,
        target_customer_id,
        reason,
        actor_user_id
      ) VALUES (
        $1, $2, $3, $4
      )`,
      [sourceCustomerId, targetCustomerId, reason ?? null, actorUserId ?? null]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'customer_merged', 'customer', $2, $3)`,
      [
        actorUserId ?? null,
        sourceCustomerId,
        {
          sourceCustomerId,
          targetCustomerId,
          reason: reason ?? null,
          movedTickets: movedTickets.rowCount ?? 0,
          movedIdentities: movedIdentityInsert.rowCount ?? 0
        }
      ]
    );

    await client.query("COMMIT");

    const representative = targetRepresentativeTicket.rows[0];
    const mergeEvent = buildAgentEvent({
      eventType: "customer.merged",
      ticketId: representative?.id ?? null,
      mailboxId: representative?.mailbox_id ?? null,
      actorUserId: actorUserId ?? null,
      threadId: representative?.id ?? null,
      excerpt: `Merged customer ${sourceCustomerId} into ${targetCustomerId}`
    });
    await publishAgentMergeEvent({
      eventType: "customer.merged",
      payload: {
        ...mergeEvent,
        merge: {
          sourceCustomerId,
          targetCustomerId,
          reason: reason ?? null,
          movedTickets: movedTickets.rowCount ?? 0,
          movedIdentities: movedIdentityInsert.rowCount ?? 0
        }
      }
    });

    return {
      sourceCustomerId,
      targetCustomerId,
      movedTickets: movedTickets.rowCount ?? 0,
      movedIdentities: movedIdentityInsert.rowCount ?? 0
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
