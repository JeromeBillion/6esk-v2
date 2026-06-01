import { apiFetch } from "@/app/lib/api/http";

export type RoleRecord = {
  id: string;
  name: string;
  description: string | null;
};

export type AdminUserRecord = {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  role_id: string | null;
  role_name: string | null;
};

export type AdminMailboxRecord = {
  id: string;
  address: string;
  type: "platform" | "personal";
  created_at: string;
  owner_email: string | null;
  members: Array<{
    id: string;
    email: string;
    displayName: string;
    accessLevel: string;
  }>;
};

export type SlaConfig = {
  firstResponseMinutes: number;
  resolutionMinutes: number;
};

export type WorkspaceModuleFlags = {
  email: boolean;
  whatsapp: boolean;
  voice: boolean;
  aiAutomation: boolean;
  venusOrchestration: boolean;
  vanillaWebchat: boolean;
};

export type WorkspaceModulesConfig = {
  workspaceKey: string;
  updatedAt: string | null;
  modules: WorkspaceModuleFlags;
};

export type WorkspaceModuleUsageSummary = {
  workspaceKey: string;
  windowDays: number;
  generatedAt: string;
  modules: Array<{
    moduleKey: keyof WorkspaceModuleFlags;
    totalQuantity: number;
    eventCount: number;
    actorBreakdown: {
      human: number;
      ai: number;
      system: number;
    };
    lastSeenAt: string | null;
    usageKinds: Array<{
      usageKind: string;
      quantity: number;
      eventCount: number;
    }>;
  }>;
};

export type TagRecord = {
  id: string;
  name: string;
  description: string | null;
};

export type SpamRuleRecord = {
  id: string;
  rule_type: "allow" | "block";
  scope: "sender" | "domain" | "subject" | "body";
  pattern: string;
  is_active: boolean;
  created_at: string;
};

export type SpamMessageRecord = {
  id: string;
  subject: string | null;
  from_email: string;
  received_at: string | null;
  spam_reason: string | null;
  mailbox_address: string;
};

export type WhatsAppAccount = {
  id: string;
  provider: string;
  phoneNumber: string;
  wabaId: string | null;
  accessToken: string;
  verifyToken: string;
  status: "active" | "paused" | "inactive";
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type WhatsAppTemplate = {
  id: string;
  provider: string;
  name: string;
  language: string;
  category?: string | null;
  status: "active" | "paused";
  components?: Array<Record<string, unknown>> | null;
};

export type WhatsAppOutboxMetrics = {
  account: {
    id: string;
    provider: string;
    phoneNumber: string;
    status: string;
    updatedAt: string;
  } | null;
  queue: {
    queued: number;
    dueNow: number;
    processing: number;
    failed: number;
    sentTotal: number;
    sent24h: number;
    nextAttemptAt: string | null;
    lastSentAt: string | null;
    lastFailedAt: string | null;
    lastError: string | null;
  };
};

export type WhatsAppFailedEvent = {
  id: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
};

export type AgentIntegration = {
  id: string;
  tenant_key: string;
  name: string;
  provider: string;
  base_url: string;
  auth_type: string;
  shared_secret: string;
  status: "active" | "paused";
  policy_mode: "draft_only" | "auto_send" | "hybrid_review" | "full_auto";
  scopes?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type AgentOutboxMetrics = {
  integrationId: string;
  integrationStatus: "active" | "paused" | string;
  throughput: {
    configuredMaxEventsPerRun: number | null;
    effectiveLimit: number;
  };
  queue: {
    pending: number;
    dueNow: number;
    processing: number;
    failed: number;
    deliveredTotal: number;
    delivered24h: number;
    nextAttemptAt: string | null;
    lastDeliveredAt: string | null;
    lastFailedAt: string | null;
    lastError: string | null;
  };
};

export type AgentRunSummary = {
  id: string;
  tenant_key: string;
  integration_id: string | null;
  mode: string;
  status: string;
  lane_key: string;
  source_event_type: string | null;
  resource: Record<string, unknown>;
  error: string | null;
  queued_at: string;
  dispatched_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentRunPolicyReplay = {
  status: "complete" | "partial" | "blocked";
  explanation: string;
  missingEvidence: string[];
  run: AgentRunSummary & {
    command_envelope: Record<string, unknown>;
    idempotency_key: string | null;
  };
  promptSandbox: Record<string, unknown> | null;
  promptTemplate: {
    id: string;
    tenant_key: string;
    workspace_key: string;
    template_key: string;
    template_version: string;
    status: string;
    template_hash: string;
    activated_at: string | null;
    retired_at: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  } | null;
  evidence: {
    events: Array<{
      id: string;
      run_id: string;
      event_type: string;
      status: string | null;
      data: Record<string, unknown>;
      created_at: string;
    }>;
    steps: Array<{
      id: string;
      run_id: string;
      step_type: string;
      status: string;
      input: Record<string, unknown>;
      output: Record<string, unknown>;
      error: string | null;
      started_at: string;
      completed_at: string | null;
    }>;
    toolCalls: Array<{
      id: string;
      run_id: string;
      step_id: string | null;
      tool_name: string;
      status: string;
      request: Record<string, unknown>;
      response: Record<string, unknown>;
      error: string | null;
      requested_at: string;
      completed_at: string | null;
    }>;
    guardEvents: AiGuardEventRecord[];
    policyDecisions: AiPolicyDecisionRecord[];
  };
};

export type KnowledgeFolder = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  parent_id: string | null;
  name: string;
  created_at: string;
  updated_at: string;
};

export type KnowledgeDocument = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  folder_id: string | null;
  filename: string;
  title: string | null;
  content_type: string;
  checksum_sha256: string;
  byte_size: number;
  status: string;
  extraction_status: string;
  extraction_error: string | null;
  metadata: Record<string, unknown>;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type KnowledgeSearchResult = {
  documentId: string;
  chunkId: string;
  title: string | null;
  filename: string;
  content: string;
  score: number;
  chunkIndex: number;
};

export type KnowledgeRetrievalEvent = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  query: string;
  result_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type KnowledgeQuarantineEvent = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  filename: string;
  content_type: string;
  checksum_sha256: string;
  byte_size: number;
  reason_code: string;
  scanner_status: string;
  scanner: string | null;
  scanner_signature: string | null;
  detail: string | null;
  storage_provider: string | null;
  storage_bucket: string | null;
  storage_key: string | null;
  stored_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type KnowledgeRetentionDocument = {
  id: string;
  filename: string;
  title: string | null;
  status: string;
  byteSize: number;
  expiresAt: string;
  legalHold: boolean;
};

export type KnowledgeRetentionSweepResult = {
  dryRun: boolean;
  cutoffAt: string;
  matched: number;
  deleted: number;
  skippedLegalHold: number;
  documents: KnowledgeRetentionDocument[];
};

export type KnowledgeExportBundle = {
  formatVersion: "ai-knowledge-export.v1";
  exportId: string;
  tenantKey: string;
  workspaceKey: string;
  generatedAt: string;
  includeDeleted: boolean;
  includeBodyText: boolean;
  documentCount: number;
  chunkCount: number;
  folders: KnowledgeFolder[];
  documents: Array<{
    id: string;
    folderId: string | null;
    filename: string;
    title: string | null;
    contentType: string;
    checksumSha256: string;
    byteSize: number;
    status: string;
    extractionStatus: string;
    extractionError: string | null;
    metadata: Record<string, unknown>;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
    bodyText?: string;
    chunks: Array<{
      id: string;
      chunkIndex: number;
      content: string;
      tokenEstimate: number;
      metadata: Record<string, unknown>;
      createdAt: string;
    }>;
  }>;
};

export type KnowledgeIngestionReadiness = {
  checkedAt: string;
  ready: boolean;
  blockers: string[];
  warnings: string[];
  scanner: {
    status: "configured" | "required_unconfigured" | "optional_disabled";
    required: boolean;
    urlConfigured: boolean;
    timeoutMs: number;
  };
  extractor: {
    status: "configured" | "required_unconfigured";
    urlConfigured: boolean;
    timeoutMs: number;
    supportedContentTypes: string[];
  };
  quarantineStorage: {
    status: "configured" | "required_unconfigured" | "optional_disabled" | "enabled_unconfigured";
    enabled: boolean;
    required: boolean;
    bucketConfigured: boolean;
    missing: string[];
    prefix: string;
  };
};

export type TenantExportSection = {
  key: string;
  source: string;
  rowCount: number;
  exportedCount: number;
  truncated: boolean;
  redactedColumns: string[];
  rows: Record<string, unknown>[];
};

export type TenantExportObjectRef = {
  section: string;
  rowId: string | null;
  field: string;
  key: string;
  filename?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
};

export type TenantExportBundle = {
  formatVersion: "tenant-export.v1";
  exportId: string;
  tenantKey: string;
  workspaceKey: string;
  generatedAt: string;
  limitPerSection: number;
  sectionCount: number;
  totalRows: number;
  exportedRows: number;
  redaction: {
    secretsRedacted: true;
    redactedColumnsBySection: Record<string, string[]>;
  };
  objectStorageManifest: TenantExportObjectRef[];
  sections: TenantExportSection[];
};

export type AiGuardEventRecord = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  run_id: string | null;
  integration_id: string | null;
  source_kind: string;
  source_id: string | null;
  subject: string | null;
  severity: string;
  decision: string;
  reason_codes: string[];
  guard_version: string;
  content_sample: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AiPolicyDecisionRecord = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  run_id: string | null;
  integration_id: string | null;
  policy_mode: string;
  tool_name: string;
  tool_class: string;
  decision: string;
  reason_codes: string[];
  resource: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AiSafetyDiagnostics = {
  summary: {
    guardEvents: number;
    maliciousGuardEvents: number;
    suspiciousGuardEvents: number;
    blockedPolicyDecisions: number;
    reviewPolicyDecisions: number;
    readOnlyPolicyDecisions: number;
  };
  guardEvents: AiGuardEventRecord[];
  policyDecisions: AiPolicyDecisionRecord[];
};

export type AgentPromptTemplateRecord = {
  id: string;
  tenant_key: string;
  workspace_key: string;
  template_key: string;
  template_version: string;
  status: "draft" | "active" | "retired" | string;
  template_body: Record<string, unknown>;
  template_hash: string;
  activated_at: string | null;
  retired_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AgentFailedEvent = {
  id: string;
  integration_id: string;
  event_type: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
};

export type ProfileLookupMetricsPoint = {
  day: string;
  matched: number;
  matchedLive: number;
  matchedCache: number;
  matchedOther: number;
  missed: number;
  errored: number;
  disabled: number;
};

export type ProfileLookupMetrics = {
  generatedAt: string;
  windowDays: number;
  configuredTimeoutMs: number;
  summary: {
    total: number;
    matched: number;
    matchedLive: number;
    matchedCache: number;
    matchedOther: number;
    missed: number;
    errored: number;
    disabled: number;
    timeoutErrors: number;
    hitRate: number;
    liveHitRate: number;
    cacheHitRate: number;
    fallbackHitRate: number;
    missRate: number;
    errorRate: number;
    timeoutErrorRate: number;
    avgDurationMs: number | null;
    p95DurationMs: number | null;
  };
  series: ProfileLookupMetricsPoint[];
};

export type SecuritySnapshot = {
  adminAllowlist: string[];
  agentAllowlist: string[];
  agentSecretKeyConfigured: boolean;
  inboundSecretConfigured: boolean;
  clientIp: string | null;
  agentIntegrationStats: {
    total: number;
    encrypted: number;
    unencrypted: number;
  };
  whatsappTokenStats: {
    total: number;
    encrypted: number;
    unencrypted: number;
    missing: number;
  };
};

export type InboundFailureReason = {
  code: string;
  label: string;
  severity: "critical" | "high" | "medium" | "low" | string;
  triageLabel: string;
  triageHint: string;
  count: number;
  sampleError: string | null;
};

export type InboundMetrics = {
  generatedAt: string;
  windowHours: number;
  summary: {
    failedQueue: number;
    dueRetryNow: number;
    processingNow: number;
    processedWindow: number;
    failedWindow: number;
    attemptsWindow: number;
    retryProcessedWindow: number;
    retryFailedWindow: number;
    highAttemptQueue: number;
    maxFailedAttemptCount: number;
    p95FailedAttemptCount: number;
    oldestFailedAgeMinutes: number | null;
  };
  alert: {
    source: "db" | "env" | string;
    webhookConfigured: boolean;
    threshold: number;
    windowMinutes: number;
    cooldownMinutes: number;
    currentFailures: number;
    status: "below_threshold" | "cooldown" | "at_or_above_threshold" | string;
    cooldownRemainingMinutes: number;
    lastSentAt: string | null;
    wouldSendNow: boolean;
    recommendation: {
      suggestedMinThreshold: number;
      suggestedMaxThreshold: number;
      inRange: boolean;
      reason: string;
      avgBucketFailures: number;
      p95BucketFailures: number;
      maxBucketFailures: number;
      bucketCount: number;
    };
  };
  failureReasons: InboundFailureReason[];
  series: Array<{
    hour: string;
    failed: number;
    processed: number;
    processing: number;
    attempts: number;
  }>;
};

export type InboundFailedEvent = {
  id: string;
  idempotency_key: string;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
};

export type InboundAlertConfig = {
  source: "db" | "env" | string;
  webhookUrl: string;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
  updatedAt: string | null;
};

export type CallOutboxMetrics = {
  provider: string;
  queue: {
    queued: number;
    dueNow: number;
    processing: number;
    failed: number;
    sentTotal: number;
    sent24h: number;
    nextAttemptAt: string | null;
    lastSentAt: string | null;
    lastFailedAt: string | null;
    lastError: string | null;
  };
  webhookSecurity: {
    mode: "hmac" | "shared_secret" | "open";
    timestampRequired: boolean;
    maxSkewSeconds: number;
    legacyBodySignature: boolean;
  };
};

export type CallProviderNumber = {
  id: string;
  provider: string;
  phoneNumber: string;
  accountSid: string | null;
  status: "active" | "paused" | "inactive" | string;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CallFailedEvent = {
  id: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
  payload: Record<string, unknown>;
};

export type CallTranscriptQaFlag = {
  code: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  detail: string;
  evidence: string | null;
};

export type CallTranscriptActionItem = {
  owner: "agent" | "supervisor" | "system";
  priority: "low" | "medium" | "high";
  description: string;
};

export type CallTranscriptAiMetrics = {
  provider: string;
  queue: {
    queued: number;
    dueNow: number;
    processing: number;
    failed: number;
    completed24h: number;
    nextAttemptAt: string | null;
    lastCompletedAt: string | null;
    lastFailedAt: string | null;
    lastError: string | null;
  };
  analysis: {
    analyzed24h: number;
    pass24h: number;
    watch24h: number;
    review24h: number;
    flagged24h: number;
    totalQaFlags24h: number;
    totalActionItems24h: number;
  };
  recentFlagged: Array<{
    jobId: string;
    callSessionId: string;
    ticketId: string;
    messageId: string | null;
    qaStatus: string;
    summary: string | null;
    qaFlags: CallTranscriptQaFlag[];
    actionItems: CallTranscriptActionItem[];
    completedAt: string | null;
  }>;
};

export type CallTranscriptAiFailedJob = {
  id: string;
  callSessionId: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CallRejections = {
  windowHours: number;
  summary: Array<{
    reason: string;
    mode: string;
    count: number;
  }>;
  recent: Array<{
    id: string;
    createdAt: string;
    data: Record<string, unknown> | null;
  }>;
};

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
  created_at: string;
  updated_at: string;
  next_attempt_at: string | null;
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
    createdAt: string;
    age_minutes: number;
  } | null;
};

export type AuditLogRecord = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
  actor_name: string | null;
  actor_email: string | null;
};

export async function listRoles() {
  const payload = await apiFetch<{ roles: RoleRecord[] }>("/api/admin/roles");
  return payload.roles ?? [];
}

export async function listUsers() {
  const payload = await apiFetch<{ users: AdminUserRecord[] }>("/api/admin/users");
  return payload.users ?? [];
}

export async function listAdminMailboxes() {
  const payload = await apiFetch<{ mailboxes: AdminMailboxRecord[] }>("/api/admin/mailboxes");
  return payload.mailboxes ?? [];
}

export function createAdminMailbox(input: {
  address: string;
  memberEmails?: string[];
}) {
  return apiFetch<{ status: string; mailbox: AdminMailboxRecord }>("/api/admin/mailboxes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function createUser(input: {
  email: string;
  displayName: string;
  password: string;
  roleId: string;
}) {
  return apiFetch<{ status: string; user: AdminUserRecord }>("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function updateUser(
  userId: string,
  input: {
    roleId?: string;
    isActive?: boolean;
  }
) {
  return apiFetch<{ status: string; user: AdminUserRecord }>(`/api/admin/users/${userId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function requestPasswordResetLink(userId: string) {
  return apiFetch<{ status: string; resetLink: string; expiresAt: string }>(
    `/api/admin/users/${userId}/password-reset`,
    {
      method: "POST"
    }
  );
}

export function getSlaConfig() {
  return apiFetch<SlaConfig>("/api/admin/sla");
}

export function updateSlaConfig(input: SlaConfig) {
  return apiFetch<SlaConfig>("/api/admin/sla", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function getWorkspaceModules() {
  return apiFetch<{ config: WorkspaceModulesConfig }>("/api/admin/workspace/modules");
}

export function updateWorkspaceModules(input: WorkspaceModuleFlags) {
  return apiFetch<{ status: string; config: WorkspaceModulesConfig }>("/api/admin/workspace/modules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function getWorkspaceModuleUsage(days = 30) {
  return apiFetch<{ summary: WorkspaceModuleUsageSummary }>(
    `/api/admin/workspace/usage?days=${days}`
  );
}

export async function listTags(signal?: AbortSignal) {
  const payload = await apiFetch<{ tags: TagRecord[] }>("/api/support/tags", { signal });
  return payload.tags ?? [];
}

export function createTag(input: { name: string; description?: string | null }) {
  return apiFetch<{ tag: TagRecord }>("/api/support/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function updateTag(tagId: string, input: { name?: string; description?: string | null }) {
  return apiFetch<{ tag: TagRecord }>(`/api/support/tags/${tagId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function deleteTag(tagId: string) {
  return apiFetch<{ status: string }>(`/api/support/tags/${tagId}`, {
    method: "DELETE"
  });
}

export async function listSpamRules() {
  const payload = await apiFetch<{ rules: SpamRuleRecord[] }>("/api/admin/spam-rules");
  return payload.rules ?? [];
}

export function createSpamRule(input: {
  ruleType: "allow" | "block";
  scope: "sender" | "domain" | "subject" | "body";
  pattern: string;
}) {
  return apiFetch<{ rule: SpamRuleRecord }>("/api/admin/spam-rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function updateSpamRule(
  ruleId: string,
  input: {
    isActive?: boolean;
    pattern?: string;
  }
) {
  return apiFetch<{ rule: SpamRuleRecord }>(`/api/admin/spam-rules/${ruleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function deleteSpamRule(ruleId: string) {
  return apiFetch<{ status: string }>(`/api/admin/spam-rules/${ruleId}`, {
    method: "DELETE"
  });
}

export async function listSpamMessages(limit = 25) {
  const payload = await apiFetch<{ messages: SpamMessageRecord[] }>(`/api/admin/spam-messages?limit=${limit}`);
  return payload.messages ?? [];
}

export function setMessageSpamStatus(messageId: string, input: { isSpam: boolean; reason?: string | null }) {
  return apiFetch<{ status: string; message: { id: string; is_spam: boolean; spam_reason: string | null } }>(
    `/api/messages/${messageId}/spam`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
}

export function getWhatsAppAccount() {
  return apiFetch<{ account: WhatsAppAccount | null }>("/api/admin/whatsapp");
}

export function saveWhatsAppAccount(input: {
  provider: string;
  phoneNumber: string;
  wabaId?: string | null;
  accessToken?: string | null;
  verifyToken?: string | null;
  status?: "active" | "paused" | "inactive";
}) {
  return apiFetch<{ status: string; id: string }>("/api/admin/whatsapp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function listWhatsAppTemplates() {
  const payload = await apiFetch<{ templates: WhatsAppTemplate[] }>("/api/admin/whatsapp/templates");
  return payload.templates ?? [];
}

export function createWhatsAppTemplate(input: {
  provider?: string;
  name: string;
  language?: string;
  category?: string | null;
  status?: "active" | "paused";
  components?: Array<Record<string, unknown>> | null;
}) {
  return apiFetch<{ template: WhatsAppTemplate }>("/api/admin/whatsapp/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function updateWhatsAppTemplate(
  templateId: string,
  input: {
    provider?: string;
    name?: string;
    language?: string;
    category?: string | null;
    status?: "active" | "paused";
    components?: Array<Record<string, unknown>> | null;
  }
) {
  return apiFetch<{ template: WhatsAppTemplate }>(`/api/admin/whatsapp/templates/${templateId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function deleteWhatsAppTemplate(templateId: string) {
  return apiFetch<{ status: string }>(`/api/admin/whatsapp/templates/${templateId}`, {
    method: "DELETE"
  });
}

export function getWhatsAppOutboxMetrics() {
  return apiFetch<WhatsAppOutboxMetrics>("/api/admin/whatsapp/outbox");
}

export function runWhatsAppOutbox(limit = 25) {
  return apiFetch<{ status: string; delivered: number; skipped: number }>(
    `/api/admin/whatsapp/outbox?limit=${limit}`,
    { method: "POST" }
  );
}

export async function listFailedWhatsAppEvents(limit = 30) {
  const payload = await apiFetch<{ events: WhatsAppFailedEvent[] }>(
    `/api/admin/whatsapp/failed?limit=${limit}`
  );
  return payload.events ?? [];
}

export function retryFailedWhatsAppOutboxEvents(limit = 25, eventIds?: string[]) {
  return apiFetch<{ status: string; requested: number; retried: number; ids: string[] }>(
    `/api/admin/whatsapp/retry?limit=${limit}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: eventIds?.length ? JSON.stringify({ eventIds }) : undefined
    }
  );
}

export async function listAgentIntegrations() {
  const payload = await apiFetch<{ agents: AgentIntegration[] }>("/api/admin/agents");
  return payload.agents ?? [];
}

export function createAgentIntegration(input: {
  tenantKey?: string;
  name: string;
  provider?: string;
  baseUrl: string;
  authType?: string;
  sharedSecret: string;
  status?: "active" | "paused";
  policyMode?: "draft_only" | "auto_send" | "hybrid_review" | "full_auto";
  scopes?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  policy?: Record<string, unknown>;
}) {
  return apiFetch<{ status: string; agent: AgentIntegration }>("/api/admin/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function updateAgentIntegration(
  agentId: string,
  input: {
    tenantKey?: string;
    name?: string;
    provider?: string;
    baseUrl?: string;
    authType?: string;
    sharedSecret?: string;
    status?: "active" | "paused";
    policyMode?: "draft_only" | "auto_send" | "hybrid_review" | "full_auto";
    scopes?: Record<string, unknown>;
    capabilities?: Record<string, unknown>;
    policy?: Record<string, unknown>;
  }
) {
  return apiFetch<{ status: string; agent: AgentIntegration }>(`/api/admin/agents/${agentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function getAgentOutboxMetrics(agentId: string) {
  return apiFetch<AgentOutboxMetrics>(`/api/admin/agents/${agentId}/outbox`);
}

export async function listAgentRuns(agentId: string, limit = 50) {
  const payload = await apiFetch<{ runs: AgentRunSummary[] }>(
    `/api/admin/agents/${agentId}/runs?limit=${limit}`
  );
  return payload.runs ?? [];
}

export async function getAgentRunReplay(agentId: string, runId: string) {
  const payload = await apiFetch<{ replay: AgentRunPolicyReplay }>(
    `/api/admin/agents/${agentId}/runs/${runId}/replay`
  );
  return payload.replay;
}

export async function listKnowledgeFolders() {
  const payload = await apiFetch<{ folders: KnowledgeFolder[] }>("/api/admin/ai/knowledge/folders");
  return payload.folders ?? [];
}

export function createKnowledgeFolder(input: { name: string; parentId?: string | null }) {
  return apiFetch<{ status: string; folder: KnowledgeFolder }>("/api/admin/ai/knowledge/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function listKnowledgeDocuments() {
  const payload = await apiFetch<{ documents: KnowledgeDocument[] }>(
    "/api/admin/ai/knowledge/documents"
  );
  return payload.documents ?? [];
}

export function uploadKnowledgeDocument(input: {
  file: File;
  folderId?: string | null;
  title?: string | null;
  publish?: boolean;
}) {
  const form = new FormData();
  form.set("file", input.file);
  if (input.folderId) form.set("folderId", input.folderId);
  if (input.title) form.set("title", input.title);
  if (input.publish) form.set("publish", "true");
  return apiFetch<{ status: string; document: KnowledgeDocument }>(
    "/api/admin/ai/knowledge/documents",
    {
      method: "POST",
      body: form
    }
  );
}

export function publishKnowledgeDocument(documentId: string) {
  return apiFetch<{ status: string; document: KnowledgeDocument }>(
    `/api/admin/ai/knowledge/documents/${documentId}/publish`,
    { method: "POST" }
  );
}

export function setKnowledgeDocumentLegalHold(input: {
  documentId: string;
  legalHold: boolean;
  reason?: string | null;
}) {
  return apiFetch<{ status: string; document: KnowledgeDocument }>(
    `/api/admin/ai/knowledge/documents/${input.documentId}/legal-hold`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        legalHold: input.legalHold,
        reason: input.reason ?? null
      })
    }
  );
}

export async function exportKnowledgeBundle(input?: {
  includeDeleted?: boolean;
  includeBodyText?: boolean;
  limit?: number;
}) {
  const payload = await apiFetch<{ status: string; export: KnowledgeExportBundle }>(
    "/api/admin/ai/knowledge/export",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? {})
    }
  );
  return payload.export;
}

export function searchKnowledge(input: { query: string; limit?: number }) {
  return apiFetch<{ results: KnowledgeSearchResult[] }>("/api/admin/ai/knowledge/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export async function listKnowledgeRetrievalEvents(limit = 25) {
  const payload = await apiFetch<{ events: KnowledgeRetrievalEvent[] }>(
    `/api/admin/ai/knowledge/retrieval-events?limit=${limit}`
  );
  return payload.events ?? [];
}

export async function listKnowledgeQuarantineEvents(limit = 25) {
  const payload = await apiFetch<{ events: KnowledgeQuarantineEvent[] }>(
    `/api/admin/ai/knowledge/quarantine-events?limit=${limit}`
  );
  return payload.events ?? [];
}

export async function getKnowledgeIngestionReadiness() {
  const payload = await apiFetch<{ readiness: KnowledgeIngestionReadiness }>(
    "/api/admin/ai/knowledge/ingestion-readiness"
  );
  return payload.readiness;
}

export async function exportTenantDataBundle(input?: { limitPerSection?: number }) {
  const payload = await apiFetch<{ status: string; export: TenantExportBundle }>(
    "/api/admin/tenant/export",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? {})
    }
  );
  return payload.export;
}

export async function previewKnowledgeRetention(limit = 100) {
  const payload = await apiFetch<{ result: KnowledgeRetentionSweepResult }>(
    `/api/admin/ai/knowledge/retention?limit=${limit}`
  );
  return payload.result;
}

export async function runKnowledgeRetention(limit = 100) {
  const payload = await apiFetch<{ status: string; result: KnowledgeRetentionSweepResult }>(
    "/api/admin/ai/knowledge/retention",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit })
    }
  );
  return payload.result;
}

export function getAiSafetyDiagnostics(limit = 50) {
  return apiFetch<AiSafetyDiagnostics>(`/api/admin/ai/safety?limit=${limit}`);
}

export async function listAgentPromptTemplates(limit = 50) {
  const payload = await apiFetch<{ templates: AgentPromptTemplateRecord[] }>(
    `/api/admin/ai/prompts?limit=${limit}`
  );
  return payload.templates ?? [];
}

export function createAgentPromptTemplate(input: {
  templateKey?: string;
  templateVersion: string;
  templateBody: Record<string, unknown>;
  activate?: boolean;
  reason?: string | null;
}) {
  return apiFetch<{ status: string; template: AgentPromptTemplateRecord }>("/api/admin/ai/prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function activateAgentPromptTemplate(templateId: string, reason?: string | null) {
  return apiFetch<{ status: string; template: AgentPromptTemplateRecord }>(
    `/api/admin/ai/prompts/${templateId}/activate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason ?? null })
    }
  );
}

export function rollbackAgentPromptTemplate(input?: { templateKey?: string; reason?: string | null }) {
  return apiFetch<{ status: string; template: AgentPromptTemplateRecord }>(
    "/api/admin/ai/prompts/rollback",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input ?? {})
    }
  );
}

export function deliverAgentOutbox(agentId: string, limit = 25) {
  return apiFetch<{ status: string; delivered: number; skipped: number; limitUsed: number }>(
    `/api/admin/agents/${agentId}/outbox/deliver?limit=${limit}`,
    { method: "POST" }
  );
}

export async function listFailedAgentEvents(agentId: string, limit = 30) {
  const payload = await apiFetch<{ events: AgentFailedEvent[] }>(
    `/api/admin/agents/${agentId}/outbox/failed?limit=${limit}`
  );
  return payload.events ?? [];
}

export function retryFailedAgentOutboxEvents(agentId: string, limit = 25, eventIds?: string[]) {
  return apiFetch<{ status: string; requested: number; retried: number; ids: string[] }>(
    `/api/admin/agents/${agentId}/outbox/retry?limit=${limit}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: eventIds?.length ? JSON.stringify({ eventIds }) : undefined
    }
  );
}

export function getProfileLookupMetrics(days = 14) {
  return apiFetch<ProfileLookupMetrics>(`/api/admin/profile-lookup/metrics?days=${days}`);
}

export function getSecuritySnapshot() {
  return apiFetch<SecuritySnapshot>("/api/admin/security");
}

export function getInboundMetrics(hours = 24) {
  return apiFetch<InboundMetrics>(`/api/admin/inbound/metrics?hours=${hours}`);
}

export async function listFailedInboundEvents(limit = 30) {
  const payload = await apiFetch<{ events: InboundFailedEvent[] }>(`/api/admin/inbound/failed?limit=${limit}`);
  return payload.events ?? [];
}

export function getInboundSettings() {
  return apiFetch<{ config: InboundAlertConfig }>("/api/admin/inbound/settings");
}

export function updateInboundSettings(input: {
  webhookUrl: string;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
}) {
  return apiFetch<{ status: string; config: InboundAlertConfig }>("/api/admin/inbound/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function retryInboundEvents(limit = 10, eventIds?: string[]) {
  return apiFetch<{ status: string; requested: number; retried: number; failed: number; ids: string[] }>(
    `/api/admin/inbound/retry?limit=${limit}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: eventIds?.length ? JSON.stringify({ eventIds }) : undefined
    }
  );
}

export function runInboundAlertCheck() {
  return apiFetch<{ status: string; sent?: boolean; reason?: string }>("/api/admin/inbound/alerts", {
    method: "POST"
  });
}

export function getCallOutboxMetrics() {
  return apiFetch<CallOutboxMetrics>("/api/admin/calls/outbox");
}

export async function listCallProviderNumbers() {
  const payload = await apiFetch<{ numbers: CallProviderNumber[] }>(
    "/api/admin/calls/provider-numbers"
  );
  return payload.numbers ?? [];
}

export function saveCallProviderNumber(input: {
  id?: string | null;
  provider: string;
  phoneNumber: string;
  accountSid?: string | null;
  status?: "active" | "paused" | "inactive";
  metadata?: Record<string, unknown> | null;
}) {
  return apiFetch<{ status: string; number: CallProviderNumber }>(
    "/api/admin/calls/provider-numbers",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
}

export function deactivateCallProviderNumber(id: string) {
  return apiFetch<{ status: string; number: CallProviderNumber }>(
    `/api/admin/calls/provider-numbers?id=${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

export function runCallOutbox(limit = 25) {
  return apiFetch<{ status: string; delivered: number; skipped: number; provider: string }>(
    `/api/admin/calls/outbox?limit=${limit}`,
    { method: "POST" }
  );
}

export async function listFailedCallEvents(limit = 30) {
  const payload = await apiFetch<{ events: CallFailedEvent[] }>(`/api/admin/calls/failed?limit=${limit}`);
  return payload.events ?? [];
}

export function getCallTranscriptAiMetrics(limit = 8) {
  return apiFetch<CallTranscriptAiMetrics>(`/api/admin/calls/transcripts/ai?limit=${limit}`);
}

export function runCallTranscriptAiOutbox(limit = 10) {
  return apiFetch<{ status: string; delivered: number; skipped: number; provider: string }>(
    `/api/admin/calls/transcripts/ai?limit=${limit}`,
    { method: "POST" }
  );
}

export async function listFailedCallTranscriptAiJobs(limit = 30) {
  const payload = await apiFetch<{ jobs: CallTranscriptAiFailedJob[] }>(
    `/api/admin/calls/transcripts/ai/failed?limit=${limit}`
  );
  return payload.jobs ?? [];
}

export function retryFailedCallTranscriptAiJobs(limit = 25, jobIds?: string[]) {
  return apiFetch<{ status: string; requested: number; retried: number; ids: string[] }>(
    `/api/admin/calls/transcripts/ai/retry?limit=${limit}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jobIds?.length ? JSON.stringify({ jobIds }) : undefined
    }
  );
}

export function getCallRejections(hours = 24, limit = 30) {
  return apiFetch<CallRejections>(`/api/admin/calls/rejections?hours=${hours}&limit=${limit}`);
}

export function retryFailedCallEvents(limit = 25, eventIds?: string[]) {
  return apiFetch<{ status: string; requested: number; retried: number; ids: string[] }>(
    `/api/admin/calls/retry?limit=${limit}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: eventIds?.length ? JSON.stringify({ eventIds }) : undefined
    }
  );
}

export function getDeadLetterSummary() {
  return apiFetch<{ status: string; action: "summary"; summary: DeadLetterSummary }>(
    "/api/admin/calls/dead-letter?action=summary"
  );
}

export async function listDeadLetterEvents(input?: {
  limit?: number;
  status?: "failed" | "poison" | "quarantined" | "all";
}) {
  const params = new URLSearchParams();
  params.set("action", "list");
  if (input?.limit) params.set("limit", String(input.limit));
  if (input?.status && input.status !== "all") params.set("status", input.status);
  const payload = await apiFetch<{ status: string; action: "list"; events: DeadLetterEvent[] }>(
    `/api/admin/calls/dead-letter?${params.toString()}`
  );
  return payload.events ?? [];
}

export function patchDeadLetterEvent(input: {
  eventId: string;
  action: "recover" | "quarantine" | "discard";
  notes?: string;
}) {
  return apiFetch<{ status: string; action: string; eventId: string; message: string }>(
    "/api/admin/calls/dead-letter",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
}

export function batchRecoverDeadLetters(input: {
  eventIds?: string[];
  filter?: { status?: string; maxAgeMinutes?: number };
  notes?: string;
}) {
  return apiFetch<{ status: string; action: string; recoveredCount: number; message: string }>(
    "/api/admin/calls/dead-letter",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "recover", ...input })
    }
  );
}

export async function listAuditLogs(limit = 50) {
  const payload = await apiFetch<{ logs: AuditLogRecord[] }>(`/api/admin/audit-logs?limit=${limit}`);
  return payload.logs ?? [];
}
