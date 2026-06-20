import { getSessionUser } from "@/server/auth/session";
import { hasTenantAdminAccess } from "@/server/auth/roles";
import { sessionTenantId } from "@/server/auth/tenant-session";
import { deleteCustomerAndData } from "@/server/customers";
import { recordAuditLog } from "@/server/audit";

function dataSubjectDeletionEnabled() {
  const value = process.env.DATA_SUBJECT_DELETION_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const user = await getSessionUser();
  if (!hasTenantAdminAccess(user)) {
    return Response.json({ error: "Forbidden. Admin access required." }, { status: 403 });
  }
  const tenantId = sessionTenantId(user);
  if (!tenantId) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!dataSubjectDeletionEnabled()) {
    return Response.json(
      {
        error: "Data subject deletion is not enabled",
        code: "data_subject_deletion_disabled"
      },
      { status: 501 }
    );
  }

  const { customerId } = await params;

  if (!customerId) {
    return Response.json({ error: "Customer ID is required" }, { status: 400 });
  }

  try {
    const success = await deleteCustomerAndData(customerId, tenantId);

    if (!success) {
      return Response.json({ error: "Customer not found or already deleted" }, { status: 404 });
    }

    // Explicitly audit the Data Subject Right execution
    await recordAuditLog({
      tenantId,
      actorUserId: user!.id,
      action: "data_subject_erasure",
      entityType: "customer",
      entityId: customerId,
      data: {
        reason: "Admin executed POPIA/GDPR cascade deletion",
        affectedStorage: ["database", "r2_buckets"]
      }
    });

    return Response.json({ status: "deleted" });
  } catch (error) {
    console.error("Failed to execute data subject deletion:", error);
    return Response.json({ error: "Internal server error during deletion" }, { status: 500 });
  }
}
