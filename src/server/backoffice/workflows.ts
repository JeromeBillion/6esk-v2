import { db } from "@/server/db";
import { recordAuditLogWithClient } from "@/server/audit";
import type {
  BackofficeCase,
  BackofficeCaseEvent,
  BackofficeCaseEventType,
  BackofficeCaseLink,
  BackofficeCasePriority,
  BackofficeCaseStatus,
  BackofficeCaseType,
  BackofficeLinkType,
  TenantBackofficeProfile,
  TenantImplementationStage,
  TenantRiskTier,
  TenantSecurityStatus
} from "@6esk/types/backoffice";

type JsonRecord = Record<string, unknown>;
const internalRoles = ["internal_admin", "internal_support"] as const;

type ProfileRow = {
  tenant_id: string;
  tenant_slug: string;
  tenant_display_name: string;
  tenant_status: string;
  account_owner_user_id: string | null;
  account_owner_email: string | null;
  implementation_stage: TenantImplementationStage;
  risk_tier: TenantRiskTier;
  security_status: TenantSecurityStatus;
  renewal_date: string | null;
  internal_notes: string | null;
  metadata: JsonRecord | null;
  created_at: string;
  updated_at: string;
};

type CaseRow = {
  id: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_display_name: string;
  tenant_status: string;
  case_type: BackofficeCaseType;
  status: BackofficeCaseStatus;
  priority: BackofficeCasePriority;
  title: string;
  summary: string | null;
  owner_user_id: string | null;
  owner_email: string | null;
  due_at: string | null;
  external_reference: string | null;
  metadata: JsonRecord | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type CaseEventRow = {
  id: string;
  tenant_id: string;
  case_id: string;
  event_type: BackofficeCaseEventType;
  actor_user_id: string | null;
  actor_email: string | null;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  metadata: JsonRecord | null;
  created_at: string;
};

type CaseLinkRow = {
  id: string;
  tenant_id: string;
  case_id: string;
  link_type: BackofficeLinkType;
  label: string;
  url: string | null;
  r2_key: string | null;
  metadata: JsonRecord | null;
  created_at: string;
};

export class BackofficeWorkflowError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "CASE_NOT_FOUND"
      | "TENANT_NOT_FOUND"
      | "INVALID_CASE_TRANSITION"
      | "INTERNAL_OWNER_NOT_FOUND"
      | "PROFILE_NOT_FOUND",
    public readonly status = 400
  ) {
    super(message);
    this.name = "BackofficeWorkflowError";
  }
}

function metadata(value: JsonRecord | null | undefined): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function requireInternalOwnerUser(userId: string | null | undefined) {
  if (!userId) return null;
  const result = await db.query<{ id: string }>(
    `SELECT u.id
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1
       AND u.is_active = true
       AND r.name = ANY($2::text[])
     LIMIT 1`,
    [userId, internalRoles]
  );
  if (!result.rows[0]) {
    throw new BackofficeWorkflowError(
      "Backoffice owners must be active internal 6esk staff users.",
      "INTERNAL_OWNER_NOT_FOUND",
      400
    );
  }
  return userId;
}

function mapProfile(row: ProfileRow): TenantBackofficeProfile {
  return {
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    tenantDisplayName: row.tenant_display_name,
    tenantStatus: row.tenant_status,
    accountOwnerUserId: row.account_owner_user_id,
    accountOwnerEmail: row.account_owner_email,
    implementationStage: row.implementation_stage,
    riskTier: row.risk_tier,
    securityStatus: row.security_status,
    renewalDate: row.renewal_date,
    internalNotes: row.internal_notes,
    metadata: metadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapCase(row: CaseRow): BackofficeCase {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tenantSlug: row.tenant_slug,
    tenantDisplayName: row.tenant_display_name,
    tenantStatus: row.tenant_status,
    caseType: row.case_type,
    status: row.status,
    priority: row.priority,
    title: row.title,
    summary: row.summary,
    ownerUserId: row.owner_user_id,
    ownerEmail: row.owner_email,
    dueAt: row.due_at,
    externalReference: row.external_reference,
    metadata: metadata(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at
  };
}

function mapCaseEvent(row: CaseEventRow): BackofficeCaseEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    caseId: row.case_id,
    eventType: row.event_type,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    metadata: metadata(row.metadata),
    createdAt: row.created_at
  };
}

function mapCaseLink(row: CaseLinkRow): BackofficeCaseLink {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    caseId: row.case_id,
    linkType: row.link_type,
    label: row.label,
    url: row.url,
    r2Key: row.r2_key,
    metadata: metadata(row.metadata),
    createdAt: row.created_at
  };
}

const profileSelect = `
  p.tenant_id,
  t.slug AS tenant_slug,
  t.display_name AS tenant_display_name,
  t.status::text AS tenant_status,
  p.account_owner_user_id,
  owner.email AS account_owner_email,
  p.implementation_stage,
  p.risk_tier,
  p.security_status,
  p.renewal_date::text,
  p.internal_notes,
  p.metadata,
  p.created_at::text,
  p.updated_at::text
`;

const caseSelect = `
  c.id,
  c.tenant_id,
  t.slug AS tenant_slug,
  t.display_name AS tenant_display_name,
  t.status::text AS tenant_status,
  c.case_type,
  c.status,
  c.priority,
  c.title,
  c.summary,
  c.owner_user_id,
  owner.email AS owner_email,
  c.due_at::text,
  c.external_reference,
  c.metadata,
  c.created_at::text,
  c.updated_at::text,
  c.closed_at::text
`;

export async function listTenantBackofficeProfiles(input: {
  tenantId?: string;
  limit?: number;
} = {}) {
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (input.tenantId) {
    params.push(input.tenantId);
    conditions.push(`p.tenant_id = $${params.length}`);
  }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  params.push(limit);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const guardComment = input.tenantId
    ? ""
    : "/* tenant-query-guard: ignore internal-backoffice-global-profile-view */";
  const result = await db.query<ProfileRow>(
    `${guardComment}
     SELECT ${profileSelect}
     FROM tenant_backoffice_profiles p
     JOIN tenants t ON t.id = p.tenant_id
     LEFT JOIN users owner
       ON owner.id = p.account_owner_user_id
     ${where}
     ORDER BY
       CASE p.risk_tier
         WHEN 'critical' THEN 0
         WHEN 'elevated' THEN 1
         WHEN 'standard' THEN 2
         ELSE 3
       END,
       p.updated_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(mapProfile);
}

export async function getTenantBackofficeProfile(tenantId: string) {
  const result = await db.query<ProfileRow>(
    `SELECT ${profileSelect}
     FROM tenant_backoffice_profiles p
     JOIN tenants t ON t.id = p.tenant_id
     LEFT JOIN users owner
       ON owner.id = p.account_owner_user_id
     WHERE p.tenant_id = $1
     LIMIT 1`,
    [tenantId]
  );
  const row = result.rows[0];
  return row ? mapProfile(row) : null;
}

export async function upsertTenantBackofficeProfile(input: {
  tenantId: string;
  accountOwnerUserId?: string | null;
  implementationStage?: TenantImplementationStage;
  riskTier?: TenantRiskTier;
  securityStatus?: TenantSecurityStatus;
  renewalDate?: string | null;
  internalNotes?: string | null;
  metadata?: JsonRecord | null;
  actorUserId?: string | null;
}) {
  const accountOwnerUserId = await requireInternalOwnerUser(input.accountOwnerUserId);
  const client = await db.connect();
  let row: ProfileRow | null = null;
  try {
    await client.query("BEGIN");
    const result = await client.query<ProfileRow>(
      `WITH upserted AS (
         INSERT INTO tenant_backoffice_profiles (
           tenant_id,
           account_owner_user_id,
           implementation_stage,
           risk_tier,
           security_status,
           renewal_date,
           internal_notes,
           metadata,
           updated_at
         )
         SELECT $1, $2, $3, $4, $5, $6::date, $7, $8::jsonb, now()
         FROM tenants
         WHERE id = $1
         ON CONFLICT (tenant_id) DO UPDATE
         SET account_owner_user_id = EXCLUDED.account_owner_user_id,
             implementation_stage = EXCLUDED.implementation_stage,
             risk_tier = EXCLUDED.risk_tier,
             security_status = EXCLUDED.security_status,
             renewal_date = EXCLUDED.renewal_date,
             internal_notes = EXCLUDED.internal_notes,
             metadata = EXCLUDED.metadata,
             updated_at = now()
         RETURNING *
       )
       SELECT ${profileSelect}
       FROM upserted p
       JOIN tenants t ON t.id = p.tenant_id
       LEFT JOIN users owner
         ON owner.id = p.account_owner_user_id`,
      [
        input.tenantId,
        accountOwnerUserId,
        input.implementationStage ?? "not_started",
        input.riskTier ?? "standard",
        input.securityStatus ?? "unknown",
        input.renewalDate ?? null,
        input.internalNotes ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    row = result.rows[0] ?? null;
    if (!row) {
      throw new BackofficeWorkflowError("Tenant not found", "TENANT_NOT_FOUND", 404);
    }

    await recordAuditLogWithClient(client, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: "backoffice_profile_updated",
      entityType: "tenant_backoffice_profile",
      entityId: input.tenantId,
      data: {
        implementationStage: row.implementation_stage,
        riskTier: row.risk_tier,
        securityStatus: row.security_status,
        renewalDate: row.renewal_date
      }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!row) {
    throw new BackofficeWorkflowError("Tenant not found", "TENANT_NOT_FOUND", 404);
  }
  return mapProfile(row);
}

export async function listBackofficeCases(input: {
  tenantId?: string;
  status?: BackofficeCaseStatus;
  caseType?: BackofficeCaseType;
  limit?: number;
} = {}) {
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (input.tenantId) {
    params.push(input.tenantId);
    conditions.push(`c.tenant_id = $${params.length}`);
  }
  if (input.status) {
    params.push(input.status);
    conditions.push(`c.status = $${params.length}`);
  }
  if (input.caseType) {
    params.push(input.caseType);
    conditions.push(`c.case_type = $${params.length}`);
  }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  params.push(limit);

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const guardComment = input.tenantId
    ? ""
    : "/* tenant-query-guard: ignore internal-backoffice-global-case-view */";
  const result = await db.query<CaseRow>(
    `${guardComment}
     SELECT ${caseSelect}
     FROM backoffice_cases c
     JOIN tenants t ON t.id = c.tenant_id
     LEFT JOIN users owner
       ON owner.id = c.owner_user_id
     ${where}
     ORDER BY
       CASE c.priority WHEN 'p0' THEN 0 WHEN 'p1' THEN 1 WHEN 'p2' THEN 2 ELSE 3 END,
       c.updated_at DESC
     LIMIT $${params.length}`,
    params
  );
  return result.rows.map(mapCase);
}

export async function getBackofficeCase(input: { caseId: string; tenantId?: string }) {
  const params: unknown[] = [input.caseId];
  const conditions = [`c.id = $1`];
  if (input.tenantId) {
    params.push(input.tenantId);
    conditions.push(`c.tenant_id = $${params.length}`);
  }

  const result = await db.query<CaseRow>(
    `SELECT ${caseSelect}
     FROM backoffice_cases c
     JOIN tenants t ON t.id = c.tenant_id
     LEFT JOIN users owner
       ON owner.id = c.owner_user_id
     WHERE ${conditions.join(" AND ")}
     LIMIT 1`,
    params
  );
  const row = result.rows[0];
  return row ? mapCase(row) : null;
}

export async function createBackofficeCase(input: {
  tenantId: string;
  caseType: BackofficeCaseType;
  title: string;
  summary?: string | null;
  priority?: BackofficeCasePriority;
  ownerUserId?: string | null;
  dueAt?: string | null;
  externalReference?: string | null;
  metadata?: JsonRecord | null;
  actorUserId?: string | null;
}) {
  const ownerUserId = await requireInternalOwnerUser(input.ownerUserId);
  const client = await db.connect();
  let created: BackofficeCase | null = null;
  try {
    await client.query("BEGIN");
    const result = await client.query<CaseRow>(
      `WITH inserted AS (
         INSERT INTO backoffice_cases (
           tenant_id,
           case_type,
           title,
           summary,
           priority,
           owner_user_id,
           due_at,
           external_reference,
           metadata
         )
         SELECT $1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9::jsonb
         FROM tenants
         WHERE id = $1
         RETURNING *
       )
       SELECT ${caseSelect}
       FROM inserted c
       JOIN tenants t ON t.id = c.tenant_id
       LEFT JOIN users owner
         ON owner.id = c.owner_user_id`,
      [
        input.tenantId,
        input.caseType,
        input.title.trim(),
        input.summary ?? null,
        input.priority ?? "p2",
        ownerUserId,
        input.dueAt ?? null,
        input.externalReference ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new BackofficeWorkflowError("Tenant not found", "TENANT_NOT_FOUND", 404);
    }
    created = mapCase(row);
    await client.query(
      `INSERT INTO backoffice_case_events (
         tenant_id,
         case_id,
         event_type,
         actor_user_id,
         to_status,
         note,
         metadata
       )
       VALUES ($1, $2, 'created', $3, $4, $5, $6::jsonb)`,
      [
        created.tenantId,
        created.id,
        input.actorUserId ?? null,
        created.status,
        input.summary ?? null,
        JSON.stringify({ priority: created.priority, caseType: created.caseType })
      ]
    );
    await recordAuditLogWithClient(client, {
      tenantId: created.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: "backoffice_case_created",
      entityType: "backoffice_case",
      entityId: created.id,
      data: {
        caseType: created.caseType,
        priority: created.priority,
        title: created.title
      }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!created) {
    throw new BackofficeWorkflowError("Backoffice case was not created", "CASE_NOT_FOUND", 404);
  }
  return created;
}

export async function updateBackofficeCase(input: {
  caseId: string;
  tenantId?: string;
  status?: BackofficeCaseStatus;
  priority?: BackofficeCasePriority;
  title?: string;
  summary?: string | null;
  ownerUserId?: string | null;
  dueAt?: string | null;
  externalReference?: string | null;
  metadata?: JsonRecord | null;
  note?: string | null;
  actorUserId?: string | null;
}) {
  const current = await getBackofficeCase({ caseId: input.caseId, tenantId: input.tenantId });
  if (!current) {
    throw new BackofficeWorkflowError("Backoffice case not found", "CASE_NOT_FOUND", 404);
  }

  const nextStatus = input.status ?? current.status;
  const ownerUserId = input.ownerUserId !== undefined
    ? await requireInternalOwnerUser(input.ownerUserId)
    : current.ownerUserId;
  const eventType: BackofficeCaseEventType =
    input.status && input.status !== current.status
      ? nextStatus === "closed"
        ? "closed"
        : current.status === "closed"
          ? "reopened"
          : "status_changed"
      : input.priority && input.priority !== current.priority
        ? "priority_changed"
        : input.ownerUserId !== undefined && ownerUserId !== current.ownerUserId
          ? "assigned"
          : "note_added";

  const client = await db.connect();
  let updated: BackofficeCase | null = null;
  try {
    await client.query("BEGIN");
    const result = await client.query<CaseRow>(
      `WITH updated AS (
         UPDATE backoffice_cases
         SET status = $3,
             priority = $4,
             title = $5,
             summary = $6,
             owner_user_id = $7,
             due_at = $8::timestamptz,
             external_reference = $9,
             metadata = $10::jsonb,
             closed_at = CASE
               WHEN $3 = 'closed' AND closed_at IS NULL THEN now()
               WHEN $3 <> 'closed' THEN NULL
               ELSE closed_at
             END,
             updated_at = now()
         WHERE id = $1
           AND tenant_id = $2
         RETURNING *
       )
       SELECT ${caseSelect}
       FROM updated c
       JOIN tenants t ON t.id = c.tenant_id
       LEFT JOIN users owner
         ON owner.id = c.owner_user_id`,
      [
        current.id,
        current.tenantId,
        nextStatus,
        input.priority ?? current.priority,
        input.title?.trim() ?? current.title,
        input.summary !== undefined ? input.summary : current.summary,
        ownerUserId,
        input.dueAt !== undefined ? input.dueAt : current.dueAt,
        input.externalReference !== undefined ? input.externalReference : current.externalReference,
        JSON.stringify(input.metadata ?? current.metadata)
      ]
    );
    updated = result.rows[0] ? mapCase(result.rows[0]) : null;
    if (!updated) {
      throw new BackofficeWorkflowError("Backoffice case not found", "CASE_NOT_FOUND", 404);
    }
    await client.query(
      `INSERT INTO backoffice_case_events (
         tenant_id,
         case_id,
         event_type,
         actor_user_id,
         from_status,
         to_status,
         note,
         metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        updated.tenantId,
        updated.id,
        eventType,
        input.actorUserId ?? null,
        current.status,
        updated.status,
        input.note ?? null,
        JSON.stringify({
          previousPriority: current.priority,
          priority: updated.priority,
          ownerUserId: updated.ownerUserId
        })
      ]
    );
    await recordAuditLogWithClient(client, {
      tenantId: updated.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: "backoffice_case_updated",
      entityType: "backoffice_case",
      entityId: updated.id,
      data: {
        eventType,
        previousStatus: current.status,
        status: updated.status,
        priority: updated.priority
      }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  if (!updated) {
    throw new BackofficeWorkflowError("Backoffice case not found", "CASE_NOT_FOUND", 404);
  }
  return updated;
}

export async function listBackofficeCaseEvents(input: { caseId: string; tenantId?: string }) {
  const current = await getBackofficeCase(input);
  if (!current) {
    throw new BackofficeWorkflowError("Backoffice case not found", "CASE_NOT_FOUND", 404);
  }
  const result = await db.query<CaseEventRow>(
    `SELECT e.id,
            e.tenant_id,
            e.case_id,
            e.event_type,
            e.actor_user_id,
            actor.email AS actor_email,
            e.from_status,
            e.to_status,
            e.note,
            e.metadata,
            e.created_at::text
     FROM backoffice_case_events e
     LEFT JOIN users actor
       ON actor.id = e.actor_user_id
     WHERE e.tenant_id = $1
       AND e.case_id = $2
     ORDER BY e.created_at DESC
     LIMIT 200`,
    [current.tenantId, current.id]
  );
  return result.rows.map(mapCaseEvent);
}

export async function appendBackofficeCaseEvent(input: {
  caseId: string;
  tenantId?: string;
  eventType: BackofficeCaseEventType;
  note?: string | null;
  metadata?: JsonRecord | null;
  actorUserId?: string | null;
}) {
  const current = await getBackofficeCase({ caseId: input.caseId, tenantId: input.tenantId });
  if (!current) {
    throw new BackofficeWorkflowError("Backoffice case not found", "CASE_NOT_FOUND", 404);
  }
  const client = await db.connect();
  let event: BackofficeCaseEvent | null = null;
  try {
    await client.query("BEGIN");
    const result = await client.query<CaseEventRow>(
      `WITH inserted AS (
         INSERT INTO backoffice_case_events (
           tenant_id,
           case_id,
           event_type,
           actor_user_id,
           note,
           metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING *
       )
       SELECT i.id,
              i.tenant_id,
              i.case_id,
              i.event_type,
              i.actor_user_id,
              actor.email AS actor_email,
              i.from_status,
              i.to_status,
              i.note,
              i.metadata,
              i.created_at::text
       FROM inserted i
       LEFT JOIN users actor
         ON actor.id = i.actor_user_id`,
      [
        current.tenantId,
        current.id,
        input.eventType,
        input.actorUserId ?? null,
        input.note ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    event = mapCaseEvent(result.rows[0]);
    await recordAuditLogWithClient(client, {
      tenantId: current.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: "backoffice_case_event_added",
      entityType: "backoffice_case",
      entityId: current.id,
      data: { eventType: event.eventType, eventId: event.id }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (!event) {
    throw new BackofficeWorkflowError("Backoffice case event was not created", "CASE_NOT_FOUND", 404);
  }
  return event;
}

export async function listBackofficeCaseLinks(input: { caseId: string; tenantId?: string }) {
  const current = await getBackofficeCase(input);
  if (!current) {
    throw new BackofficeWorkflowError("Backoffice case not found", "CASE_NOT_FOUND", 404);
  }
  const result = await db.query<CaseLinkRow>(
    `SELECT id,
            tenant_id,
            case_id,
            link_type,
            label,
            url,
            r2_key,
            metadata,
            created_at::text
     FROM backoffice_case_links
     WHERE tenant_id = $1
       AND case_id = $2
     ORDER BY created_at DESC`,
    [current.tenantId, current.id]
  );
  return result.rows.map(mapCaseLink);
}

export async function linkBackofficeCaseArtifact(input: {
  caseId: string;
  tenantId?: string;
  linkType: BackofficeLinkType;
  label: string;
  url?: string | null;
  r2Key?: string | null;
  metadata?: JsonRecord | null;
  actorUserId?: string | null;
}) {
  const current = await getBackofficeCase({ caseId: input.caseId, tenantId: input.tenantId });
  if (!current) {
    throw new BackofficeWorkflowError("Backoffice case not found", "CASE_NOT_FOUND", 404);
  }
  const client = await db.connect();
  let link: BackofficeCaseLink | null = null;
  try {
    await client.query("BEGIN");
    const result = await client.query<CaseLinkRow>(
      `WITH inserted AS (
         INSERT INTO backoffice_case_links (
           tenant_id,
           case_id,
           link_type,
           label,
           url,
           r2_key,
           metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING *
       )
       SELECT id,
              tenant_id,
              case_id,
              link_type,
              label,
              url,
              r2_key,
              metadata,
              created_at::text
       FROM inserted`,
      [
        current.tenantId,
        current.id,
        input.linkType,
        input.label.trim(),
        input.url ?? null,
        input.r2Key ?? null,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    link = mapCaseLink(result.rows[0]);
    await client.query(
      `INSERT INTO backoffice_case_events (
         tenant_id,
         case_id,
         event_type,
         actor_user_id,
         note,
         metadata
       )
       VALUES ($1, $2, 'artifact_linked', $3, $4, $5::jsonb)`,
      [
        current.tenantId,
        current.id,
        input.actorUserId ?? null,
        input.label,
        JSON.stringify({ linkId: link.id, linkType: link.linkType })
      ]
    );
    await recordAuditLogWithClient(client, {
      tenantId: current.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: "backoffice_case_artifact_linked",
      entityType: "backoffice_case",
      entityId: current.id,
      data: { linkType: link.linkType, linkId: link.id }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  if (!link) {
    throw new BackofficeWorkflowError("Backoffice case artifact was not linked", "CASE_NOT_FOUND", 404);
  }
  return link;
}
