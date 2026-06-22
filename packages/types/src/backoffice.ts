export const BACKOFFICE_CASE_TYPES = [
  "onboarding",
  "implementation",
  "contract",
  "renewal",
  "incident",
  "security_questionnaire",
  "legal_artifact",
  "data_request",
  "provider_rotation",
  "deliverability",
  "partner_services"
] as const;

export type BackofficeCaseType = (typeof BACKOFFICE_CASE_TYPES)[number];

export const BACKOFFICE_CASE_STATUSES = [
  "open",
  "in_progress",
  "waiting_on_customer",
  "waiting_on_6esk",
  "resolved",
  "closed",
  "canceled"
] as const;

export type BackofficeCaseStatus = (typeof BACKOFFICE_CASE_STATUSES)[number];

export const BACKOFFICE_CASE_PRIORITIES = ["p0", "p1", "p2", "p3"] as const;

export type BackofficeCasePriority = (typeof BACKOFFICE_CASE_PRIORITIES)[number];

export const BACKOFFICE_CASE_EVENT_TYPES = [
  "created",
  "status_changed",
  "priority_changed",
  "assigned",
  "note_added",
  "artifact_linked",
  "approval_recorded",
  "closed",
  "reopened"
] as const;

export type BackofficeCaseEventType = (typeof BACKOFFICE_CASE_EVENT_TYPES)[number];

export const BACKOFFICE_LINK_TYPES = [
  "contract",
  "dpa",
  "subprocessor",
  "security_evidence",
  "provider_dashboard",
  "r2_object",
  "external_document",
  "incident_evidence",
  "other"
] as const;

export type BackofficeLinkType = (typeof BACKOFFICE_LINK_TYPES)[number];

export const TENANT_IMPLEMENTATION_STAGES = [
  "not_started",
  "discovery",
  "implementation",
  "uat",
  "launched",
  "blocked",
  "closed"
] as const;

export type TenantImplementationStage = (typeof TENANT_IMPLEMENTATION_STAGES)[number];

export const TENANT_RISK_TIERS = ["low", "standard", "elevated", "critical"] as const;

export type TenantRiskTier = (typeof TENANT_RISK_TIERS)[number];

export const TENANT_SECURITY_STATUSES = ["unknown", "pending", "ready", "watch", "blocked"] as const;

export type TenantSecurityStatus = (typeof TENANT_SECURITY_STATUSES)[number];

export type TenantBackofficeProfile = {
  tenantId: string;
  tenantSlug: string;
  tenantDisplayName: string;
  tenantStatus: string;
  accountOwnerUserId: string | null;
  accountOwnerEmail: string | null;
  implementationStage: TenantImplementationStage;
  riskTier: TenantRiskTier;
  securityStatus: TenantSecurityStatus;
  renewalDate: string | null;
  internalNotes: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type BackofficeCase = {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantDisplayName: string;
  tenantStatus: string;
  caseType: BackofficeCaseType;
  status: BackofficeCaseStatus;
  priority: BackofficeCasePriority;
  title: string;
  summary: string | null;
  ownerUserId: string | null;
  ownerEmail: string | null;
  dueAt: string | null;
  externalReference: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
};

export type BackofficeCaseEvent = {
  id: string;
  tenantId: string;
  caseId: string;
  eventType: BackofficeCaseEventType;
  actorUserId: string | null;
  actorEmail: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type BackofficeCaseLink = {
  id: string;
  tenantId: string;
  caseId: string;
  linkType: BackofficeLinkType;
  label: string;
  url: string | null;
  r2Key: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};
