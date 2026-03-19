import { z } from "zod";
import { canManageTickets, isLeadAdmin } from "@/server/auth/roles";
import { getSessionUser } from "@/server/auth/session";
import { recordAuditLog } from "@/server/audit";
import {
  CustomerIdentityConflictError,
  getCustomerById,
  listCustomerIdentities,
  updateCustomerProfile
} from "@/server/customers";
import { db } from "@/server/db";

const patchSchema = z
  .object({
    displayName: z.string().max(200).optional().nullable(),
    primaryEmail: z.string().max(320).optional().nullable(),
    primaryPhone: z.string().max(40).optional().nullable(),
    ticketId: z.string().uuid().optional().nullable()
  })
  .refine(
    (data) =>
      Object.prototype.hasOwnProperty.call(data, "displayName") ||
      Object.prototype.hasOwnProperty.call(data, "primaryEmail") ||
      Object.prototype.hasOwnProperty.call(data, "primaryPhone"),
    { message: "At least one customer profile field must be provided." }
  );

function normalizeOptionalString(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canManageTickets(user)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { customerId } = await params;
  const existingCustomer = await getCustomerById(customerId);
  if (!existingCustomer) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: "Invalid payload" }, { status: 400 });
  }

  const requestedTicketId = parsed.data.ticketId ?? null;
  const admin = isLeadAdmin(user);

  if (!admin) {
    if (!requestedTicketId) {
      return Response.json(
        { error: "ticketId is required for customer profile updates." },
        { status: 400 }
      );
    }
    const accessResult = await db.query<{ id: string }>(
      `SELECT id
       FROM tickets
       WHERE id = $1
         AND customer_id = $2
         AND merged_into_ticket_id IS NULL
         AND assigned_user_id = $3
       LIMIT 1`,
      [requestedTicketId, customerId, user.id]
    );
    if ((accessResult.rowCount ?? 0) === 0) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
  } else if (requestedTicketId) {
    const ticketResult = await db.query<{ id: string }>(
      `SELECT id
       FROM tickets
       WHERE id = $1
         AND customer_id = $2
         AND merged_into_ticket_id IS NULL
       LIMIT 1`,
      [requestedTicketId, customerId]
    );
    if ((ticketResult.rowCount ?? 0) === 0) {
      return Response.json(
        { error: "ticketId does not belong to this customer." },
        { status: 400 }
      );
    }
  }

  const updateInput: {
    displayName?: string | null;
    primaryEmail?: string | null;
    primaryPhone?: string | null;
  } = {};

  if (Object.prototype.hasOwnProperty.call(parsed.data, "displayName")) {
    updateInput.displayName = normalizeOptionalString(parsed.data.displayName);
  }
  if (Object.prototype.hasOwnProperty.call(parsed.data, "primaryEmail")) {
    updateInput.primaryEmail = normalizeOptionalString(parsed.data.primaryEmail)?.toLowerCase() ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(parsed.data, "primaryPhone")) {
    updateInput.primaryPhone = normalizeOptionalString(parsed.data.primaryPhone);
  }

  try {
    const updatedCustomer = await updateCustomerProfile(customerId, updateInput);
    if (!updatedCustomer) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    const changes: Record<string, { from: string | null; to: string | null }> = {};
    if (Object.prototype.hasOwnProperty.call(updateInput, "displayName")) {
      const before = existingCustomer.display_name ?? null;
      const after = updatedCustomer.display_name ?? null;
      if (before !== after) {
        changes.displayName = { from: before, to: after };
      }
    }
    if (Object.prototype.hasOwnProperty.call(updateInput, "primaryEmail")) {
      const before = existingCustomer.primary_email ?? null;
      const after = updatedCustomer.primary_email ?? null;
      if (before !== after) {
        changes.primaryEmail = { from: before, to: after };
      }
    }
    if (Object.prototype.hasOwnProperty.call(updateInput, "primaryPhone")) {
      const before = existingCustomer.primary_phone ?? null;
      const after = updatedCustomer.primary_phone ?? null;
      if (before !== after) {
        changes.primaryPhone = { from: before, to: after };
      }
    }

    if (Object.keys(changes).length > 0) {
      await recordAuditLog({
        actorUserId: user.id,
        action: "customer_profile_updated",
        entityType: "customer",
        entityId: customerId,
        data: {
          ticketId: requestedTicketId,
          changes
        }
      });
    }

    const identities = await listCustomerIdentities(updatedCustomer.id);
    return Response.json({
      customer: {
        ...updatedCustomer,
        identities: identities.map((identity) => ({
          type: identity.identity_type,
          value: identity.identity_value,
          isPrimary: identity.is_primary
        }))
      }
    });
  } catch (error) {
    if (error instanceof CustomerIdentityConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Error && error.message.includes("merged customer profile")) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : "Failed to update customer profile";
    return Response.json({ error: message }, { status: 500 });
  }
}
