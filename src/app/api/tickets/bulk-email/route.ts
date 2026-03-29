import { z } from "zod";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit";
import { db } from "@/server/db";
import { normalizeAddressList } from "@/server/email/normalize";
import { getCustomerById, listCustomerIdentities } from "@/server/customers";
import { recordTicketEvent } from "@/server/tickets";
import { deliverPendingAgentEvents } from "@/server/agents/outbox";
import { createOutboundEmailTicket } from "@/server/tickets/outbound-email";
import { isWorkspaceModuleEnabled } from "@/server/workspace-modules";
import { recordModuleUsageEvent } from "@/server/module-metering";

const bulkEmailSchema = z.object({
  ticketIds: z.array(z.string().uuid()).min(1).max(100),
  subject: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1),
  attachments: z
    .array(
      z.object({
        filename: z.string().min(1),
        contentType: z.string().optional().nullable(),
        contentBase64: z.string().min(1)
      })
    )
    .optional()
    .nullable()
});

type TicketSelectionRow = {
  id: string;
  customer_id: string | null;
  requester_email: string;
  subject: string | null;
  assigned_user_id: string | null;
};

function normalizeRecipientEmail(value: string | null | undefined) {
  const normalized = normalizeAddressList(value ?? "")[0];
  return normalized || null;
}

async function resolveRecipientEmail(row: TicketSelectionRow) {
  const fallbackTicketEmail =
    row.requester_email.startsWith("whatsapp:") || row.requester_email.startsWith("voice:")
      ? null
      : normalizeRecipientEmail(row.requester_email);

  if (!row.customer_id) {
    return fallbackTicketEmail;
  }

  const customer = await getCustomerById(row.customer_id);
  const primaryEmail = normalizeRecipientEmail(customer?.primary_email);
  if (primaryEmail) {
    return primaryEmail;
  }

  const identities = await listCustomerIdentities(row.customer_id);
  const identityEmail = identities.find((identity) => identity.identity_type === "email")?.identity_value;
  return normalizeRecipientEmail(identityEmail) ?? fallbackTicketEmail;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await isWorkspaceModuleEnabled("email"))) {
    return Response.json(
      {
        error: "Email module is not enabled for this workspace.",
        code: "module_disabled",
        module: "email"
      },
      { status: 409 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bulkEmailSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const uniqueTicketIds = Array.from(new Set(parsed.data.ticketIds));
  const ticketsResult = await db.query<TicketSelectionRow>(
    `SELECT id, customer_id, requester_email, subject, assigned_user_id
     FROM tickets
     WHERE id = ANY($1::uuid[])
       AND merged_into_ticket_id IS NULL`,
    [uniqueTicketIds]
  );
  const rows = ticketsResult.rows;

  if (rows.length !== uniqueTicketIds.length) {
    const found = new Set(rows.map((row) => row.id));
    const missing = uniqueTicketIds.filter((id) => !found.has(id));
    return Response.json(
      {
        error: "Some tickets were not found.",
        missingTicketIds: missing
      },
      { status: 404 }
    );
  }

  const admin = isLeadAdmin(user);
  if (!admin && rows.some((row) => row.assigned_user_id !== user.id)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const seenRecipients = new Map<string, string>();
  const results: Array<{
    sourceTicketId: string;
    sourceSubject: string | null;
    status: "created" | "skipped" | "failed";
    recipientEmail: string | null;
    createdTicketId: string | null;
    messageId: string | null;
    detail: string | null;
  }> = [];

  for (const row of rows) {
    const recipientEmail = await resolveRecipientEmail(row);
    if (!recipientEmail) {
      results.push({
        sourceTicketId: row.id,
        sourceSubject: row.subject,
        status: "skipped",
        recipientEmail: null,
        createdTicketId: null,
        messageId: null,
        detail: "No email recipient is available for this customer."
      });
      continue;
    }

    const duplicateSource = seenRecipients.get(recipientEmail);
    if (duplicateSource) {
      results.push({
        sourceTicketId: row.id,
        sourceSubject: row.subject,
        status: "skipped",
        recipientEmail,
        createdTicketId: null,
        messageId: null,
        detail: `Recipient already covered by ${duplicateSource}.`
      });
      continue;
    }

    try {
      const created = await createOutboundEmailTicket({
        actorUserId: user.id,
        toEmail: recipientEmail,
        subject: parsed.data.subject,
        text: parsed.data.text,
        attachments: parsed.data.attachments ?? null,
        customerId: row.customer_id,
        metadata: {
          source: "bulk_outbound_email",
          createdByUserId: user.id,
          bulkEmail: {
            sourceTicketId: row.id,
            sourceTicketSubject: row.subject,
            selectionCount: uniqueTicketIds.length
          }
        },
        contextRoute: "/api/tickets/bulk-email",
        deliverAgentEvents: false
      });

      seenRecipients.set(recipientEmail, row.id);
      results.push({
        sourceTicketId: row.id,
        sourceSubject: row.subject,
        status: "created",
        recipientEmail,
        createdTicketId: created.ticketId,
        messageId: created.messageId,
        detail: null
      });

      await recordTicketEvent({
        ticketId: row.id,
        eventType: "bulk_email_ticket_created",
        actorUserId: user.id,
        data: {
          recipientEmail,
          createdTicketId: created.ticketId,
          subject: parsed.data.subject
        }
      });

      await recordAuditLog({
        actorUserId: user.id,
        action: "ticket_bulk_email_created",
        entityType: "ticket",
        entityId: row.id,
        data: {
          ticketId: row.id,
          recipientEmail,
          createdTicketId: created.ticketId,
          subject: parsed.data.subject
        }
      });

      await recordAuditLog({
        actorUserId: user.id,
        action: "ticket_bulk_email_created",
        entityType: "ticket",
        entityId: created.ticketId,
        data: {
          ticketId: created.ticketId,
          sourceTicketId: row.id,
          recipientEmail,
          subject: parsed.data.subject
        }
      });
      await recordModuleUsageEvent({
        moduleKey: "email",
        usageKind: "bulk_email_created",
        actorType: "human",
        metadata: {
          route: "/api/tickets/bulk-email",
          sourceTicketId: row.id,
          createdTicketId: created.ticketId,
          messageId: created.messageId,
          recipientEmail,
          selectionCount: uniqueTicketIds.length
        }
      });
    } catch (error) {
      results.push({
        sourceTicketId: row.id,
        sourceSubject: row.subject,
        status: "failed",
        recipientEmail,
        createdTicketId: null,
        messageId: null,
        detail: error instanceof Error ? error.message : "Bulk email send failed."
      });
    }
  }

  const created = results.filter((result) => result.status === "created");
  const skipped = results.filter((result) => result.status === "skipped");
  const failed = results.filter((result) => result.status === "failed");

  if (created.length > 0) {
    void deliverPendingAgentEvents().catch(() => {});
  }

  return Response.json({
    status:
      created.length === 0 ? "failed" : skipped.length > 0 || failed.length > 0 ? "partial" : "created",
    createdCount: created.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    createdTicketIds: created.map((result) => result.createdTicketId).filter(Boolean),
    results
  });
}
