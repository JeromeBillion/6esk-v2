import type { OverviewResponse, PerformanceResponse, PerformanceRow, SlaResponse, VolumeResponse } from "@/app/lib/api/analytics";
import type {
  AdminUserRecord,
  AgentIntegration,
  AgentOutboxMetrics,
  AuditLogRecord,
  CallFailedEvent,
  CallOutboxMetrics,
  CallRejections,
  DeadLetterEvent,
  DeadLetterSummary,
  InboundAlertConfig,
  InboundFailedEvent,
  InboundMetrics,
  ProfileLookupMetrics,
  RoleRecord,
  SecuritySnapshot,
  SlaConfig,
  SpamMessageRecord,
  SpamRuleRecord,
  TagRecord,
  WhatsAppAccount,
  WhatsAppOutboxMetrics,
  WhatsAppTemplate
} from "@/app/lib/api/admin";
import type { ApiMailbox, ApiMailboxMessage, ApiMessageDetail as MailMessageDetail } from "@/app/lib/api/mail";
import type { MergeReviewQueueItem, MergeReviewStatus } from "@/app/lib/api/merge-reviews";
import type { CurrentSessionUser } from "@/app/lib/api/session";
import type {
  ApiDraft,
  ApiMessageDetail as SupportMessageDetail,
  ApiTicket,
  ApiTicketEvent,
  CustomerHistoryResponse,
  QueueOutboundCallResponse,
  SupportMacro,
  SupportSavedView,
  TicketCallOptions,
  TicketDetailsResponse
} from "@/app/lib/api/support";
import type { CreateTicketInput, CreateTicketSuccessResponse } from "@/app/lib/api/tickets";

type InternalAttachment = {
  id: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
};

type InternalMessage = {
  id: string;
  ticketId: string | null;
  mailboxId: string | null;
  threadId: string | null;
  direction: "inbound" | "outbound";
  channel: "email" | "whatsapp" | "voice";
  origin: "human" | "ai";
  from: string;
  to: string[];
  subject: string | null;
  previewText: string | null;
  text: string | null;
  html: string | null;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  isRead: boolean;
  isStarred: boolean;
  isPinned: boolean;
  isSpam: boolean;
  spamReason: string | null;
  attachments: InternalAttachment[];
  waStatus: string | null;
  waTimestamp: string | null;
  aiMeta: Record<string, unknown> | null;
  callSession: {
    status: string;
    durationSeconds: number | null;
    recordingUrl?: string | null;
  } | null;
  transcript: { text: string | null } | null;
  statusEvents: Array<{ status: string }>;
};

type InternalCustomer = NonNullable<CustomerHistoryResponse["customer"]>;

type InternalTicket = ApiTicket & {
  customerId: string;
  requesterName: string;
  requesterPhone: string | null;
  preview: string;
  unread: boolean;
  archived: boolean;
};

type AnalyticsBaseRow = {
  day: string;
  created: number;
  solved: number;
  avgResponseMinutes: number;
  satisfaction: number;
};

type DemoState = {
  currentUser: CurrentSessionUser;
  roles: RoleRecord[];
  users: AdminUserRecord[];
  sla: SlaConfig;
  security: SecuritySnapshot;
  tags: TagRecord[];
  supportMacros: SupportMacro[];
  supportSavedViews: SupportSavedView[];
  customers: Record<string, InternalCustomer>;
  tickets: InternalTicket[];
  messages: InternalMessage[];
  draftsByTicketId: Record<string, ApiDraft[]>;
  eventsByTicketId: Record<string, ApiTicketEvent[]>;
  auditLogs: AuditLogRecord[];
  mailboxes: ApiMailbox[];
  spamRules: SpamRuleRecord[];
  whatsAppAccount: WhatsAppAccount | null;
  whatsAppTemplates: WhatsAppTemplate[];
  whatsAppOutbox: WhatsAppOutboxMetrics;
  agents: AgentIntegration[];
  agentOutboxes: Record<string, AgentOutboxMetrics>;
  profileLookupSeries: ProfileLookupMetrics["series"];
  inboundMetrics: InboundMetrics;
  inboundSettings: InboundAlertConfig;
  failedInboundEvents: InboundFailedEvent[];
  callOutbox: CallOutboxMetrics;
  failedCallEvents: CallFailedEvent[];
  callRejections: CallRejections;
  deadLetters: DeadLetterEvent[];
  mergeReviews: MergeReviewQueueItem[];
  analyticsBase: AnalyticsBaseRow[];
  nextTicketNumber: number;
  nextSavedViewNumber: number;
};

const DEMO_NOW = "2026-03-19T08:30:00.000Z";
const DEFAULT_MAILBOX_ID = "mailbox-support";
const DEFAULT_MAILBOX_ADDRESS = "support@6esk.com";
const DEFAULT_WHATSAPP_NUMBER = "+1987654321";

let demoState: DemoState | null = null;

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function createAbortError() {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function assertNotAborted(signal?: AbortSignal | null) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function trimPreview(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}

function createAttachment(id: string, filename: string, contentType: string, sizeBytes: number): InternalAttachment {
  return { id, filename, contentType, sizeBytes };
}

function createMessage(
  input: Omit<
    InternalMessage,
    | "previewText"
    | "html"
    | "createdAt"
    | "origin"
    | "isRead"
    | "isStarred"
    | "isPinned"
    | "isSpam"
    | "spamReason"
    | "attachments"
    | "waStatus"
    | "waTimestamp"
    | "aiMeta"
    | "callSession"
    | "transcript"
    | "statusEvents"
  > & {
    createdAt?: string;
    previewText?: string | null;
    html?: string | null;
    origin?: "human" | "ai";
    isRead?: boolean;
    isStarred?: boolean;
    isPinned?: boolean;
    isSpam?: boolean;
    spamReason?: string | null;
    attachments?: InternalAttachment[];
    waStatus?: string | null;
    waTimestamp?: string | null;
    aiMeta?: Record<string, unknown> | null;
    callSession?: InternalMessage["callSession"];
    transcript?: InternalMessage["transcript"];
    statusEvents?: InternalMessage["statusEvents"];
  }
): InternalMessage {
  const timestamp = input.createdAt ?? input.sentAt ?? input.receivedAt ?? DEMO_NOW;
  return {
    previewText: trimPreview(input.previewText ?? input.text ?? input.subject ?? ""),
    html: input.html ?? null,
    createdAt: timestamp,
    origin: input.origin ?? "human",
    isRead: input.isRead ?? true,
    isStarred: input.isStarred ?? false,
    isPinned: input.isPinned ?? false,
    isSpam: input.isSpam ?? false,
    spamReason: input.spamReason ?? null,
    attachments: input.attachments ?? [],
    waStatus: input.waStatus ?? null,
    waTimestamp: input.waTimestamp ?? input.sentAt ?? input.receivedAt ?? null,
    aiMeta: input.aiMeta ?? null,
    callSession: input.callSession ?? null,
    transcript: input.transcript ?? null,
    statusEvents: input.statusEvents ?? [],
    ...input
  };
}

function createTicket(input: Omit<InternalTicket, "archived"> & { archived?: boolean }): InternalTicket {
  return {
    archived: input.archived ?? false,
    ...input
  };
}

function createCustomer(input: InternalCustomer): InternalCustomer {
  return input;
}

function titleToId(prefix: string, value: string) {
  return `${prefix}-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function buildAnalyticsBase(): AnalyticsBaseRow[] {
  const rows: Array<[string, number, number, number, number]> = [
    ["2026-02-17", 52, 48, 55, 4.5],
    ["2026-02-18", 48, 45, 52, 4.6],
    ["2026-02-19", 61, 55, 58, 4.4],
    ["2026-02-20", 58, 54, 51, 4.7],
    ["2026-02-21", 45, 43, 48, 4.8],
    ["2026-02-22", 39, 38, 42, 4.7],
    ["2026-02-23", 42, 40, 45, 4.6],
    ["2026-02-24", 67, 62, 60, 4.5],
    ["2026-02-25", 71, 68, 62, 4.6],
    ["2026-02-26", 64, 61, 56, 4.7],
    ["2026-02-27", 59, 57, 53, 4.8],
    ["2026-02-28", 55, 52, 49, 4.7],
    ["2026-03-01", 48, 46, 44, 4.8],
    ["2026-03-02", 51, 49, 46, 4.7],
    ["2026-03-03", 68, 65, 50, 4.6],
    ["2026-03-04", 72, 69, 52, 4.7],
    ["2026-03-05", 65, 63, 48, 4.8],
    ["2026-03-06", 58, 56, 45, 4.8],
    ["2026-03-07", 53, 51, 43, 4.7],
    ["2026-03-08", 47, 46, 40, 4.9],
    ["2026-03-09", 50, 48, 42, 4.8],
    ["2026-03-10", 69, 66, 47, 4.7],
    ["2026-03-11", 74, 71, 49, 4.8],
    ["2026-03-12", 66, 64, 44, 4.8],
    ["2026-03-13", 61, 59, 41, 4.9],
    ["2026-03-14", 56, 54, 39, 4.8],
    ["2026-03-15", 49, 48, 37, 4.9],
    ["2026-03-16", 52, 50, 38, 4.8],
    ["2026-03-17", 70, 68, 43, 4.7],
    ["2026-03-18", 75, 72, 45, 4.7]
  ];
  return rows.map(([day, created, solved, avgResponseMinutes, satisfaction]) => ({
    day,
    created,
    solved,
    avgResponseMinutes,
    satisfaction
  }));
}

function buildInitialState(): DemoState {
  const roles: RoleRecord[] = [
    { id: "role-lead-admin", name: "lead_admin", description: "Admin with full support control" },
    { id: "role-agent", name: "agent", description: "Frontline support agent" },
    { id: "role-viewer", name: "viewer", description: "Read-only workspace access" }
  ];

  const users: AdminUserRecord[] = [
    {
      id: "user-sarah",
      email: "sarah@6esk.com",
      display_name: "Sarah Chen",
      is_active: true,
      created_at: "2025-11-02T08:00:00Z",
      role_id: "role-lead-admin",
      role_name: "lead_admin"
    },
    {
      id: "user-marcus",
      email: "marcus@6esk.com",
      display_name: "Marcus Reid",
      is_active: true,
      created_at: "2025-11-02T08:00:00Z",
      role_id: "role-agent",
      role_name: "agent"
    },
    {
      id: "user-elena",
      email: "elena@6esk.com",
      display_name: "Elena Rodriguez",
      is_active: true,
      created_at: "2025-11-02T08:00:00Z",
      role_id: "role-agent",
      role_name: "agent"
    },
    {
      id: "user-james",
      email: "james@6esk.com",
      display_name: "James Park",
      is_active: true,
      created_at: "2025-11-02T08:00:00Z",
      role_id: "role-agent",
      role_name: "agent"
    },
    {
      id: "user-lisa",
      email: "lisa@6esk.com",
      display_name: "Lisa Wang",
      is_active: true,
      created_at: "2025-11-02T08:00:00Z",
      role_id: "role-agent",
      role_name: "agent"
    },
    {
      id: "user-ops-viewer",
      email: "ops.viewer@6esk.com",
      display_name: "Ops Viewer",
      is_active: true,
      created_at: "2025-11-02T08:00:00Z",
      role_id: "role-viewer",
      role_name: "viewer"
    }
  ];

  const currentUser: CurrentSessionUser = {
    id: "user-sarah",
    email: "sarah@6esk.com",
    display_name: "Sarah Chen",
    role_id: "role-lead-admin",
    role_name: "lead_admin"
  };

  const tags: TagRecord[] = [
    { id: "tag-bug", name: "bug", description: "Defect or regression" },
    { id: "tag-dashboard", name: "dashboard", description: "Dashboard-related issue" },
    { id: "tag-urgent", name: "urgent", description: "Urgent follow-up required" },
    { id: "tag-billing", name: "billing", description: "Billing workflow" },
    { id: "tag-invoice", name: "invoice", description: "Invoice issue" },
    { id: "tag-feature-request", name: "feature-request", description: "Product feedback" },
    { id: "tag-export", name: "export", description: "Data export flow" },
    { id: "tag-integration", name: "integration", description: "External integration" },
    { id: "tag-salesforce", name: "salesforce", description: "Salesforce integration" },
    { id: "tag-sync-issue", name: "sync-issue", description: "Sync delay or mismatch" },
    { id: "tag-sso", name: "sso", description: "SSO and auth" },
    { id: "tag-account", name: "account", description: "Account lifecycle" },
    { id: "tag-webhook", name: "webhook", description: "Webhook behavior" },
    { id: "tag-api", name: "api", description: "API support" },
    { id: "tag-mobile", name: "mobile", description: "Mobile app issue" },
    { id: "tag-ios", name: "ios", description: "iOS issue" },
    { id: "tag-permissions", name: "permissions", description: "Permissions and access" },
    { id: "tag-rate-limit", name: "rate-limit", description: "API rate limiting" },
    { id: "tag-whatsapp", name: "whatsapp", description: "WhatsApp workflow" },
    { id: "tag-vip", name: "vip", description: "High-value account" }
  ];

  const customers: Record<string, InternalCustomer> = {
    "cust-john": createCustomer({
      id: "cust-john",
      kind: "registered",
      external_system: "crm",
      external_user_id: "techcorp-1001",
      display_name: "John Davidson",
      primary_email: "john.davidson@techcorp.com",
      primary_phone: "+1234567890",
      address: "410 Market Street, San Francisco, CA 94111",
      merged_into_customer_id: null,
      merged_at: null,
      identities: [
        { type: "email", value: "john.davidson@techcorp.com", isPrimary: true },
        { type: "phone", value: "+1234567890", isPrimary: true },
        { type: "phone", value: "+1234500000", isPrimary: false }
      ]
    }),
    "cust-maria": createCustomer({
      id: "cust-maria",
      kind: "registered",
      external_system: "billing",
      external_user_id: "globex-221",
      display_name: "Maria Santos",
      primary_email: "maria.santos@globex.io",
      primary_phone: "+1234567891",
      address: "88 Hudson Square, New York, NY 10013",
      merged_into_customer_id: null,
      merged_at: null,
      identities: [
        { type: "email", value: "maria.santos@globex.io", isPrimary: true },
        { type: "phone", value: "+1234567891", isPrimary: true }
      ]
    }),
    "cust-alex": createCustomer({
      id: "cust-alex",
      kind: "registered",
      external_system: "crm",
      external_user_id: "startup-998",
      display_name: "Alex Thompson",
      primary_email: "alex.thompson@startup.ventures",
      primary_phone: "+1234567893",
      address: "1200 Howell Mill Road, Atlanta, GA 30318",
      merged_into_customer_id: null,
      merged_at: null,
      identities: [
        { type: "email", value: "alex.thompson@startup.ventures", isPrimary: true },
        { type: "phone", value: "+1234567893", isPrimary: true }
      ]
    }),
    "cust-lisa": createCustomer({
      id: "cust-lisa",
      kind: "registered",
      external_system: "crm",
      external_user_id: "enterprise-552",
      display_name: "Lisa Nguyen",
      primary_email: "lisa.nguyen@enterprise.com",
      primary_phone: "+1234567894",
      address: "250 King Street West, Toronto, ON M5V 1H9",
      merged_into_customer_id: null,
      merged_at: null,
      identities: [
        { type: "email", value: "lisa.nguyen@enterprise.com", isPrimary: true },
        { type: "phone", value: "+1234567894", isPrimary: true }
      ]
    }),
    "cust-david": createCustomer({
      id: "cust-david",
      kind: "registered",
      external_system: "crm",
      external_user_id: "solutions-455",
      display_name: "David Kumar",
      primary_email: "david.kumar@solutions.co",
      primary_phone: "+1234567895",
      address: "14 Marina View, Singapore 018961",
      merged_into_customer_id: null,
      merged_at: null,
      identities: [
        { type: "email", value: "david.kumar@solutions.co", isPrimary: true },
        { type: "phone", value: "+1234567895", isPrimary: true }
      ]
    }),
    "cust-rachel": createCustomer({
      id: "cust-rachel",
      kind: "registered",
      external_system: "portal",
      external_user_id: "agency-772",
      display_name: "Rachel Foster",
      primary_email: "rachel.foster@agency.digital",
      primary_phone: "+1234567896",
      address: "19 Redchurch Street, London E2 7DJ",
      merged_into_customer_id: null,
      merged_at: null,
      identities: [{ type: "email", value: "rachel.foster@agency.digital", isPrimary: true }]
    }),
    "cust-tom": createCustomer({
      id: "cust-tom",
      kind: "registered",
      external_system: "portal",
      external_user_id: "consulting-441",
      display_name: "Tom Wilson",
      primary_email: "tom.wilson@consulting.biz",
      primary_phone: "+1234567897",
      address: "600 Congress Avenue, Austin, TX 78701",
      merged_into_customer_id: null,
      merged_at: null,
      identities: [
        { type: "email", value: "tom.wilson@consulting.biz", isPrimary: true },
        { type: "phone", value: "+1234567897", isPrimary: true }
      ]
    }),
    "cust-emily": createCustomer({
      id: "cust-emily",
      kind: "registered",
      external_system: "mobile",
      external_user_id: "saas-118",
      display_name: "Emily Zhang",
      primary_email: "emily.zhang@saas.company",
      primary_phone: "+1234567892",
      address: "1 HarbourFront Walk, Singapore 098585",
      merged_into_customer_id: null,
      merged_at: null,
      identities: [
        { type: "email", value: "emily.zhang@saas.company", isPrimary: true },
        { type: "phone", value: "+1234567892", isPrimary: true }
      ]
    }),
    "cust-carlos": createCustomer({
      id: "cust-carlos",
      kind: "registered",
      external_system: "crm",
      external_user_id: "retail-331",
      display_name: "Carlos Mendez",
      primary_email: "carlos.mendez@retail.shop",
      primary_phone: "+1234567898",
      address: "500 Brickell Avenue, Miami, FL 33131",
      merged_into_customer_id: null,
      merged_at: null,
      identities: [
        { type: "email", value: "carlos.mendez@retail.shop", isPrimary: true },
        { type: "phone", value: "+1234567898", isPrimary: true }
      ]
    }),
    "cust-amanda": createCustomer({
      id: "cust-amanda",
      kind: "registered",
      external_system: "crm",
      external_user_id: "fintech-808",
      display_name: "Amanda Lee",
      primary_email: "amanda.lee@fintech.ai",
      primary_phone: "+1234567899",
      address: "101 Collins Street, Melbourne VIC 3000",
      merged_into_customer_id: null,
      merged_at: null,
      identities: [
        { type: "email", value: "amanda.lee@fintech.ai", isPrimary: true },
        { type: "phone", value: "+1234567899", isPrimary: true },
        { type: "phone", value: "+1234567000", isPrimary: false }
      ]
    }),
    "cust-olivia": createCustomer({
      id: "cust-olivia",
      kind: "registered",
      external_system: "crm",
      external_user_id: "brightpath-227",
      display_name: "Olivia Parker",
      primary_email: "olivia.parker@brightpath.co",
      primary_phone: "+1234567801",
      address: "75 Franklin Street, Boston, MA 02110",
      merged_into_customer_id: null,
      merged_at: null,
      identities: [
        { type: "email", value: "olivia.parker@brightpath.co", isPrimary: true },
        { type: "phone", value: "+1234567801", isPrimary: true }
      ]
    }),
    "cust-daniel": createCustomer({
      id: "cust-daniel",
      kind: "registered",
      external_system: "crm",
      external_user_id: "northstar-412",
      display_name: "Daniel Reeves",
      primary_email: "daniel.reeves@northstar.health",
      primary_phone: "+1234567802",
      address: "420 Bay Street, Toronto, ON M5H 2R2",
      merged_into_customer_id: null,
      merged_at: null,
      identities: [
        { type: "email", value: "daniel.reeves@northstar.health", isPrimary: true },
        { type: "phone", value: "+1234567802", isPrimary: true }
      ]
    })
  };

  const tickets: InternalTicket[] = [
    createTicket({
      id: "TKT-1849",
      requester_email: "olivia.parker@brightpath.co",
      requesterName: "Olivia Parker",
      requesterPhone: "+1234567801",
      customerId: "cust-olivia",
      subject: "Send onboarding checklist on WhatsApp",
      category: "Onboarding",
      metadata: { plan: "enterprise", launch_phase: "implementation", preferred_channel: "whatsapp" },
      tags: ["onboarding", "whatsapp", "checklist"],
      has_whatsapp: true,
      has_voice: false,
      status: "open",
      priority: "high",
      assigned_user_id: "user-sarah",
      created_at: "2026-03-18T10:58:00Z",
      updated_at: "2026-03-18T11:14:00Z",
      preview: "Can you send the onboarding checklist here on WhatsApp? My ops lead is joining in 10 minutes...",
      unread: false
    }),
    createTicket({
      id: "TKT-1848",
      requester_email: "daniel.reeves@northstar.health",
      requesterName: "Daniel Reeves",
      requesterPhone: "+1234567802",
      customerId: "cust-daniel",
      subject: "Requested callback about contract redlines",
      category: "Contracts",
      metadata: { contract_stage: "legal_review", callback_requested: true, account_tier: "enterprise" },
      tags: ["contracts", "callback", "voice"],
      has_whatsapp: false,
      has_voice: true,
      status: "pending",
      priority: "high",
      assigned_user_id: "user-sarah",
      created_at: "2026-03-18T09:58:00Z",
      updated_at: "2026-03-18T10:24:00Z",
      preview: "Customer asked for a callback to verify two final contract redlines before signature...",
      unread: false
    }),
    createTicket({
      id: "TKT-1847",
      requester_email: "john.davidson@techcorp.com",
      requesterName: "John Davidson",
      requesterPhone: "+1234567890",
      customerId: "cust-john",
      subject: "Unable to access dashboard after latest update",
      category: "Technical Issue",
      metadata: { browser: "Chrome 121", os: "Windows 11", device: "MacBook Pro", plan: "enterprise" },
      tags: ["bug", "dashboard", "urgent", "vip"],
      has_whatsapp: true,
      has_voice: false,
      status: "open",
      priority: "urgent",
      assigned_user_id: "user-sarah",
      created_at: "2026-03-18T09:24:00Z",
      updated_at: "2026-03-18T09:54:00Z",
      preview: "Hi, I've been trying to log into my dashboard since the update went live this morning...",
      unread: true
    }),
    createTicket({
      id: "TKT-1846",
      requester_email: "maria.santos@globex.io",
      requesterName: "Maria Santos",
      requesterPhone: "+1234567891",
      customerId: "cust-maria",
      subject: "Billing discrepancy on March invoice",
      category: "Billing",
      metadata: { account_type: "enterprise", invoice_month: "March", account_health: "renewal_watch" },
      tags: ["billing", "invoice"],
      has_whatsapp: false,
      has_voice: true,
      status: "pending",
      priority: "high",
      assigned_user_id: "user-sarah",
      created_at: "2026-03-18T08:15:00Z",
      updated_at: "2026-03-18T11:00:00Z",
      preview: "I noticed our March invoice shows charges for features we haven't activated yet...",
      unread: false
    }),
    createTicket({
      id: "TKT-1845",
      requester_email: "alex.thompson@startup.ventures",
      requesterName: "Alex Thompson",
      requesterPhone: "+1234567893",
      customerId: "cust-alex",
      subject: "Feature request: Export data to CSV",
      category: "Feature Request",
      metadata: { plan: "pro", requested_export: "analytics_csv" },
      tags: ["feature-request", "export"],
      has_whatsapp: true,
      has_voice: true,
      status: "open",
      priority: "normal",
      assigned_user_id: "user-elena",
      created_at: "2026-03-18T07:42:00Z",
      updated_at: "2026-03-18T08:10:00Z",
      preview: "Would love to see an option to export our analytics data to CSV format for external reporting...",
      unread: true
    }),
    createTicket({
      id: "TKT-1844",
      requester_email: "lisa.nguyen@enterprise.com",
      requesterName: "Lisa Nguyen",
      requesterPhone: "+1234567894",
      customerId: "cust-lisa",
      subject: "Integration not syncing with Salesforce",
      category: "Integration",
      metadata: { integration: "salesforce", version: "2.1", region: "us-east-1" },
      tags: ["integration", "salesforce", "sync-issue"],
      has_whatsapp: false,
      has_voice: false,
      status: "pending",
      priority: "high",
      assigned_user_id: "user-sarah",
      created_at: "2026-03-17T16:20:00Z",
      updated_at: "2026-03-18T07:35:00Z",
      preview: "The Salesforce integration stopped syncing yesterday afternoon. Last successful sync was at 3:45 PM...",
      unread: false
    }),
    createTicket({
      id: "TKT-1837",
      requester_email: "whatsapp:+1234567894",
      requesterName: "Lisa Nguyen",
      requesterPhone: "+1234567894",
      customerId: "cust-lisa",
      subject: "WhatsApp follow-up for Salesforce sync",
      category: "Integration",
      metadata: { integration: "salesforce", channel_context: "whatsapp", region: "us-east-1" },
      tags: ["integration", "salesforce", "sync-issue", "whatsapp"],
      has_whatsapp: true,
      has_voice: false,
      status: "pending",
      priority: "high",
      assigned_user_id: "user-sarah",
      created_at: "2026-03-18T07:41:00Z",
      updated_at: "2026-03-18T07:50:00Z",
      preview: "We have our board review in 30 minutes. If there's a workaround, can someone call me?",
      unread: false
    }),
    createTicket({
      id: "TKT-1836",
      requester_email: "voice:+1234567894",
      requesterName: "Lisa Nguyen",
      requesterPhone: "+1234567894",
      customerId: "cust-lisa",
      subject: "Call: Salesforce sync workaround",
      category: "Integration",
      metadata: { integration: "salesforce", channel_context: "voice", region: "us-east-1" },
      tags: ["integration", "salesforce", "sync-issue"],
      has_whatsapp: false,
      has_voice: true,
      status: "pending",
      priority: "high",
      assigned_user_id: "user-sarah",
      created_at: "2026-03-18T07:48:00Z",
      updated_at: "2026-03-18T07:48:00Z",
      preview: "Completed a live troubleshooting call and confirmed the temporary Salesforce replay steps...",
      unread: false
    }),
    createTicket({
      id: "TKT-1843",
      requester_email: "david.kumar@solutions.co",
      requesterName: "David Kumar",
      requesterPhone: "+1234567895",
      customerId: "cust-david",
      subject: "How to set up SSO for team members?",
      category: "Question",
      metadata: { plan: "enterprise", docsVersion: "2026.03" },
      tags: ["sso", "account"],
      has_whatsapp: true,
      has_voice: false,
      status: "open",
      priority: "normal",
      assigned_user_id: "user-james",
      created_at: "2026-03-17T14:55:00Z",
      updated_at: "2026-03-17T15:12:00Z",
      preview: "We recently upgraded to Enterprise and I'm trying to configure SSO. I followed the docs but...",
      unread: true
    }),
    createTicket({
      id: "TKT-1842",
      requester_email: "rachel.foster@agency.digital",
      requesterName: "Rachel Foster",
      requesterPhone: "+1234567896",
      customerId: "cust-rachel",
      subject: "Account deletion request",
      category: "Account",
      metadata: { gdpr_request: true, region: "eu" },
      tags: ["account", "urgent"],
      has_whatsapp: false,
      has_voice: false,
      status: "open",
      priority: "high",
      assigned_user_id: "user-marcus",
      created_at: "2026-03-17T13:10:00Z",
      updated_at: "2026-03-17T13:45:00Z",
      preview: "I would like to request deletion of my account and all associated data per GDPR...",
      unread: true
    }),
    createTicket({
      id: "TKT-1841",
      requester_email: "tom.wilson@consulting.biz",
      requesterName: "Tom Wilson",
      requesterPhone: "+1234567897",
      customerId: "cust-tom",
      subject: "Webhook notifications not being received",
      category: "Technical Issue",
      metadata: { webhook_url: "https://api.client.com/hooks", retry_policy: "exponential" },
      tags: ["webhook", "api"],
      has_whatsapp: false,
      has_voice: true,
      status: "solved",
      priority: "normal",
      assigned_user_id: "user-elena",
      created_at: "2026-03-17T11:30:00Z",
      updated_at: "2026-03-18T08:45:00Z",
      preview: "Our webhook endpoint is configured correctly but we haven't received any notifications...",
      unread: false
    }),
    createTicket({
      id: "TKT-1840",
      requester_email: "emily.zhang@saas.company",
      requesterName: "Emily Zhang",
      requesterPhone: "+1234567892",
      customerId: "cust-emily",
      subject: "Mobile app keeps crashing on iOS",
      category: "Technical Issue",
      metadata: { device: "iPhone 15 Pro", ios_version: "17.3", app_version: "2.4.1" },
      tags: ["mobile", "ios", "urgent"],
      has_whatsapp: true,
      has_voice: false,
      status: "open",
      priority: "urgent",
      assigned_user_id: "user-sarah",
      created_at: "2026-03-17T10:15:00Z",
      updated_at: "2026-03-17T11:45:00Z",
      preview: "The mobile app crashes immediately after opening on my iPhone 15 Pro. I've tried reinstalling...",
      unread: true
    }),
    createTicket({
      id: "TKT-1839",
      requester_email: "carlos.mendez@retail.shop",
      requesterName: "Carlos Mendez",
      requesterPhone: "+1234567898",
      customerId: "cust-carlos",
      subject: "Team member access permissions",
      category: "Access",
      metadata: { team_size: 12 },
      tags: ["permissions", "account"],
      has_whatsapp: false,
      has_voice: false,
      status: "solved",
      priority: "low",
      assigned_user_id: "user-james",
      created_at: "2026-03-16T15:40:00Z",
      updated_at: "2026-03-17T09:20:00Z",
      preview: "I need to adjust permissions for one of our team members who recently changed roles...",
      unread: false
    }),
    createTicket({
      id: "TKT-1838",
      requester_email: "amanda.lee@fintech.ai",
      requesterName: "Amanda Lee",
      requesterPhone: "+1234567899",
      customerId: "cust-amanda",
      subject: "API rate limit seems too restrictive",
      category: "API",
      metadata: { plan: "pro", current_limit: "1000/hour", secondary_phone: "+1234567000" },
      tags: ["api", "rate-limit", "feature-request"],
      has_whatsapp: true,
      has_voice: true,
      status: "pending",
      priority: "normal",
      assigned_user_id: "user-marcus",
      created_at: "2026-03-16T14:25:00Z",
      updated_at: "2026-03-17T11:10:00Z",
      preview: "We're hitting the API rate limit frequently during our peak hours. Is there a way to increase this?",
      unread: false
    }),
    createTicket({
      id: "TKT-1723",
      requester_email: "john.davidson@techcorp.com",
      requesterName: "John Davidson",
      requesterPhone: "+1234567890",
      customerId: "cust-john",
      subject: "Question about API rate limits",
      category: "API",
      metadata: { plan: "enterprise" },
      tags: ["api", "rate-limit"],
      has_whatsapp: false,
      has_voice: false,
      status: "solved",
      priority: "normal",
      assigned_user_id: "user-marcus",
      created_at: "2026-03-10T14:30:00Z",
      updated_at: "2026-03-10T15:05:00Z",
      preview: "We need temporary headroom for a launch week campaign.",
      unread: false,
      archived: true
    }),
    createTicket({
      id: "TKT-1654",
      requester_email: "john.davidson@techcorp.com",
      requesterName: "John Davidson",
      requesterPhone: "+1234567890",
      customerId: "cust-john",
      subject: "How to add team members?",
      category: "Account",
      metadata: { seats: 14 },
      tags: ["account"],
      has_whatsapp: false,
      has_voice: false,
      status: "solved",
      priority: "low",
      assigned_user_id: "user-elena",
      created_at: "2026-02-28T11:20:00Z",
      updated_at: "2026-02-28T11:48:00Z",
      preview: "We onboarded new staff and need the right seat setup.",
      unread: false,
      archived: true
    })
  ];

  const messages: InternalMessage[] = [
    createMessage({
      id: "msg-1849-1",
      ticketId: "TKT-1849",
      mailboxId: null,
      threadId: "ticket-thread-1849",
      direction: "inbound",
      channel: "whatsapp",
      from: "+1234567801",
      to: [DEFAULT_WHATSAPP_NUMBER],
      subject: null,
      text:
        "Hey team, can you send the onboarding checklist here on WhatsApp? My ops lead is joining in 10 minutes and email is buried.",
      sentAt: null,
      receivedAt: "2026-03-18T10:58:00Z",
      waStatus: "read"
    }),
    createMessage({
      id: "msg-1849-2",
      ticketId: "TKT-1849",
      mailboxId: null,
      threadId: "ticket-thread-1849",
      direction: "outbound",
      channel: "whatsapp",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567801"],
      subject: null,
      text: "Template sent: onboarding_checklist_delivery",
      sentAt: "2026-03-18T11:01:00Z",
      receivedAt: "2026-03-18T11:01:00Z",
      waStatus: "delivered",
      aiMeta: { template: true, template_name: "onboarding_checklist_delivery" }
    }),
    createMessage({
      id: "msg-1849-3",
      ticketId: "TKT-1849",
      mailboxId: null,
      threadId: "ticket-thread-1849",
      direction: "outbound",
      channel: "whatsapp",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567801"],
      subject: null,
      text: "Attaching the checklist PDF as well so your ops lead can review it live during the call.",
      sentAt: "2026-03-18T11:06:00Z",
      receivedAt: "2026-03-18T11:06:00Z",
      waStatus: "read",
      attachments: [createAttachment("att-1849-1", "onboarding-checklist.pdf", "application/pdf", 184320)]
    }),
    createMessage({
      id: "msg-1849-4",
      ticketId: "TKT-1849",
      mailboxId: null,
      threadId: "ticket-thread-1849",
      direction: "inbound",
      channel: "whatsapp",
      from: "+1234567801",
      to: [DEFAULT_WHATSAPP_NUMBER],
      subject: null,
      text: "Perfect, got it. One more thing: can you confirm the account owner shown in the admin panel is still me?",
      sentAt: null,
      receivedAt: "2026-03-18T11:10:00Z",
      waStatus: "read"
    }),
    createMessage({
      id: "msg-1849-5",
      ticketId: "TKT-1849",
      mailboxId: null,
      threadId: "ticket-thread-1849",
      direction: "outbound",
      channel: "whatsapp",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567801"],
      subject: null,
      text: "Confirmed. You remain the primary account owner and I have also tagged the workspace for onboarding follow-up.",
      sentAt: "2026-03-18T11:14:00Z",
      receivedAt: "2026-03-18T11:14:00Z",
      waStatus: "sent"
    }),
    createMessage({
      id: "msg-1848-1",
      ticketId: "TKT-1848",
      mailboxId: null,
      threadId: "ticket-thread-1848",
      direction: "inbound",
      channel: "voice",
      from: "+1234567802",
      to: [DEFAULT_WHATSAPP_NUMBER],
      subject: null,
      text: "Customer called support to request a contract callback after legal review.",
      sentAt: null,
      receivedAt: "2026-03-18T09:58:00Z",
      callSession: {
        status: "completed",
        durationSeconds: 86,
        recordingUrl: null
      },
      transcript: {
        text:
          "Daniel: Hi, please call me back when you can. I have two contract redlines to verify before legal signs off."
      },
      statusEvents: [{ status: "callback requested" }]
    }),
    createMessage({
      id: "msg-1848-2",
      ticketId: "TKT-1848",
      mailboxId: null,
      threadId: "ticket-thread-1848",
      direction: "outbound",
      channel: "voice",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567802"],
      subject: null,
      text: "Queued the first callback attempt for the customer.",
      sentAt: "2026-03-18T10:02:00Z",
      receivedAt: "2026-03-18T10:02:00Z",
      callSession: {
        status: "queued",
        durationSeconds: null,
        recordingUrl: null
      },
      statusEvents: [{ status: "queued" }]
    }),
    createMessage({
      id: "msg-1848-3",
      ticketId: "TKT-1848",
      mailboxId: null,
      threadId: "ticket-thread-1848",
      direction: "outbound",
      channel: "voice",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567802"],
      subject: null,
      text: "First callback attempt reached voicemail.",
      sentAt: "2026-03-18T10:08:00Z",
      receivedAt: "2026-03-18T10:08:00Z",
      callSession: {
        status: "no-answer",
        durationSeconds: 0,
        recordingUrl: null
      },
      statusEvents: [{ status: "no answer" }]
    }),
    createMessage({
      id: "msg-1848-4",
      ticketId: "TKT-1848",
      mailboxId: null,
      threadId: "ticket-thread-1848",
      direction: "outbound",
      channel: "voice",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567802"],
      subject: null,
      text: "Completed callback and walked through the final contract changes live with the customer.",
      sentAt: "2026-03-18T10:24:00Z",
      receivedAt: "2026-03-18T10:24:00Z",
      callSession: {
        status: "completed",
        durationSeconds: 512,
        recordingUrl: "#"
      },
      transcript: {
        text:
          "Sarah: Hi Daniel, calling you back on the contract edits.\n\nDaniel: Thanks. Clause 4 and the renewal cap were the only blockers.\n\nSarah: Confirmed. I sent the revised language to your legal alias and logged the notes on the ticket.\n\nDaniel: Perfect, that resolves it on our side."
      },
      statusEvents: [{ status: "contract terms confirmed" }]
    }),
    createMessage({
      id: "msg-1847-1",
      ticketId: "TKT-1847",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1847",
      direction: "inbound",
      channel: "email",
      from: "john.davidson@techcorp.com",
      to: [DEFAULT_MAILBOX_ADDRESS],
      subject: "Unable to access dashboard after latest update",
      text:
        "Hi,\n\nI've been trying to log into my dashboard since the update went live this morning, but I keep getting an error message saying 'Session expired, please try again.'\n\nI've tried:\n- Clearing my browser cache\n- Using incognito mode\n- Different browsers (Chrome, Firefox, Safari)\n- Different devices (laptop and phone)\n\nNothing seems to work. This is urgent as I need to access our reports for a client meeting in 2 hours.\n\nCan you please help?\n\nBest regards,\nJohn Davidson",
      sentAt: null,
      receivedAt: "2026-03-18T09:24:00Z"
    }),
    createMessage({
      id: "msg-1847-2",
      ticketId: "TKT-1847",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1847",
      direction: "outbound",
      channel: "email",
      from: "sarah@6esk.com",
      to: ["john.davidson@techcorp.com"],
      subject: "Re: Unable to access dashboard after latest update",
      text:
        "Hi John,\n\nThanks for reaching out. There was a session management bug introduced in this morning's update that's affecting some users. Our engineering team is working on a hotfix right now.\n\nI've manually refreshed your session on the backend. Can you try logging in again? You should be able to access your dashboard now.\n\nBest regards,\nSarah Chen",
      sentAt: "2026-03-18T09:45:00Z",
      receivedAt: "2026-03-18T09:45:00Z"
    }),
    createMessage({
      id: "msg-1847-3",
      ticketId: "TKT-1847",
      mailboxId: null,
      threadId: "ticket-thread-1847",
      direction: "inbound",
      channel: "whatsapp",
      from: "+1234567890",
      to: [DEFAULT_WHATSAPP_NUMBER],
      subject: null,
      text: "Thanks Sarah! Just tried and I can access it now. You saved my meeting!",
      sentAt: null,
      receivedAt: "2026-03-18T09:52:00Z",
      waStatus: "read"
    }),
    createMessage({
      id: "msg-1847-4",
      ticketId: "TKT-1847",
      mailboxId: null,
      threadId: "ticket-thread-1847",
      direction: "outbound",
      channel: "whatsapp",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567890"],
      subject: null,
      text: "Glad to hear it. The permanent fix will be deployed in the next hour. Let me know if anything else comes up.",
      sentAt: "2026-03-18T09:54:00Z",
      receivedAt: "2026-03-18T09:54:00Z",
      waStatus: "read"
    }),
    createMessage({
      id: "msg-1846-1",
      ticketId: "TKT-1846",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1846",
      direction: "inbound",
      channel: "email",
      from: "maria.santos@globex.io",
      to: [DEFAULT_MAILBOX_ADDRESS],
      subject: "Billing discrepancy on March invoice",
      text:
        "Hello,\n\nI noticed our March invoice shows charges for features we haven't activated yet. Our expected total should be around $850/mo, but the invoice shows $1,846/mo.\n\nPlease review and send a corrected invoice.\n\nThank you,\nMaria Santos",
      receivedAt: "2026-03-18T08:15:00Z",
      sentAt: null
    }),
    createMessage({
      id: "msg-1846-2",
      ticketId: "TKT-1846",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1846",
      direction: "outbound",
      channel: "email",
      from: "sarah@6esk.com",
      to: ["maria.santos@globex.io"],
      subject: "Re: Billing discrepancy on March invoice",
      text:
        "Hi Maria,\n\nYou were right. We've corrected your invoice, applied a $100 service credit, and updated the billing configuration to prevent a repeat.\n\nBest regards,\nSarah Chen",
      sentAt: "2026-03-18T10:32:00Z",
      receivedAt: "2026-03-18T10:32:00Z",
      attachments: [createAttachment("att-1846-1", "corrected-invoice.pdf", "application/pdf", 245678)]
    }),
    createMessage({
      id: "msg-1846-3",
      ticketId: "TKT-1846",
      mailboxId: null,
      threadId: "ticket-thread-1846",
      direction: "outbound",
      channel: "voice",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567891"],
      subject: null,
      text: "Follow-up call to confirm the billing correction was received.",
      sentAt: "2026-03-18T11:00:00Z",
      receivedAt: "2026-03-18T11:00:00Z",
      callSession: {
        status: "completed",
        durationSeconds: 320,
        recordingUrl: "#"
      },
      transcript: {
        text:
          "Sarah: Hi Maria, this is Sarah from 6esk. I wanted to confirm the corrected invoice came through.\n\nMaria: It did, thank you. The credit is visible too.\n\nSarah: Great, glad we could close this out quickly."
      },
      statusEvents: [{ status: "customer confirmed resolution" }]
    }),
    createMessage({
      id: "msg-1845-1",
      ticketId: "TKT-1845",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1845",
      direction: "inbound",
      channel: "email",
      from: "alex.thompson@startup.ventures",
      to: [DEFAULT_MAILBOX_ADDRESS],
      subject: "Feature request: Export data to CSV",
      text:
        "Would love to see an option to export our analytics data to CSV format for external reporting. Right now we have to copy charts manually.",
      receivedAt: "2026-03-18T07:42:00Z",
      sentAt: null
    }),
    createMessage({
      id: "msg-1844-1",
      ticketId: "TKT-1844",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1844",
      direction: "inbound",
      channel: "email",
      from: "lisa.nguyen@enterprise.com",
      to: [DEFAULT_MAILBOX_ADDRESS],
      subject: "Integration not syncing with Salesforce",
      text:
        "The Salesforce integration stopped syncing yesterday afternoon. Last successful sync was at 3:45 PM. We need a status update before our board review.",
      receivedAt: "2026-03-17T16:20:00Z",
      sentAt: null
    }),
    createMessage({
      id: "msg-1844-2",
      ticketId: "TKT-1844",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1844",
      direction: "outbound",
      channel: "email",
      from: "sarah@6esk.com",
      to: ["lisa.nguyen@enterprise.com"],
      subject: "Re: Integration not syncing with Salesforce",
      text:
        "Hi Lisa, we're tracing the sync regression and expect an engineering answer within the hour. I'll keep you updated here and on WhatsApp.",
      sentAt: "2026-03-18T07:35:00Z",
      receivedAt: "2026-03-18T07:35:00Z"
    }),
    createMessage({
      id: "msg-1844-3",
      ticketId: "TKT-1837",
      mailboxId: null,
      threadId: "ticket-thread-1837",
      direction: "inbound",
      channel: "whatsapp",
      from: "+1234567894",
      to: [DEFAULT_WHATSAPP_NUMBER],
      subject: null,
      text: "We have our board review in 30 minutes. If there's a workaround, can someone call me?",
      sentAt: null,
      receivedAt: "2026-03-18T07:41:00Z",
      waStatus: "read"
    }),
    createMessage({
      id: "msg-1844-4",
      ticketId: "TKT-1837",
      mailboxId: null,
      threadId: "ticket-thread-1837",
      direction: "outbound",
      channel: "whatsapp",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567894"],
      subject: null,
      text: "Yes. I'm lining up a quick call now and will walk you through the replay workaround live.",
      sentAt: "2026-03-18T07:44:00Z",
      receivedAt: "2026-03-18T07:44:00Z",
      waStatus: "delivered",
      aiMeta: { template_name: "integration_incident_update" }
    }),
    createMessage({
      id: "msg-1844-5",
      ticketId: "TKT-1836",
      mailboxId: null,
      threadId: "ticket-thread-1836",
      direction: "outbound",
      channel: "voice",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567894"],
      subject: null,
      text: "Completed a live troubleshooting call and confirmed the temporary Salesforce replay steps with the customer.",
      sentAt: "2026-03-18T07:48:00Z",
      receivedAt: "2026-03-18T07:48:00Z",
      callSession: {
        status: "completed",
        durationSeconds: 428,
        recordingUrl: "/api/attachments/voice-att-1844-recording"
      },
      transcript: {
        text:
          "Sarah: Hi Lisa, I have the workaround ready.\n\nLisa: Perfect, we need something before the board review starts.\n\nSarah: The Salesforce sync worker is stuck on a failed token refresh. Trigger the replay job from Integrations, then reconnect the OAuth token after the review.\n\nLisa: That gets us moving. Please keep the ticket updated with the permanent fix.\n\nSarah: Will do. I'm logging the call and sending the steps now."
      },
      statusEvents: [{ status: "temporary replay confirmed" }]
    }),
    createMessage({
      id: "msg-1844-6",
      ticketId: "TKT-1837",
      mailboxId: null,
      threadId: "ticket-thread-1837",
      direction: "outbound",
      channel: "whatsapp",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567894"],
      subject: null,
      text: "I've logged the replay steps on the ticket. We'll follow up with the permanent fix as soon as engineering clears the patch.",
      sentAt: "2026-03-18T07:50:00Z",
      receivedAt: "2026-03-18T07:50:00Z",
      waStatus: "read"
    }),
    createMessage({
      id: "msg-1843-1",
      ticketId: "TKT-1843",
      mailboxId: null,
      threadId: "ticket-thread-1843",
      direction: "inbound",
      channel: "whatsapp",
      from: "+1234567895",
      to: [DEFAULT_WHATSAPP_NUMBER],
      subject: null,
      text: "We upgraded to Enterprise and I need help setting up SSO for new team members.",
      receivedAt: "2026-03-17T14:55:00Z",
      sentAt: null,
      waStatus: "read"
    }),
    createMessage({
      id: "msg-1843-2",
      ticketId: "TKT-1843",
      mailboxId: null,
      threadId: "ticket-thread-1843",
      direction: "outbound",
      channel: "whatsapp",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567895"],
      subject: null,
      text: "Absolutely. I can guide you through the IdP setup and SCIM mapping once you confirm which provider you're using.",
      sentAt: "2026-03-17T15:12:00Z",
      receivedAt: "2026-03-17T15:12:00Z",
      waStatus: "delivered"
    }),
    createMessage({
      id: "msg-1842-1",
      ticketId: "TKT-1842",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1842",
      direction: "inbound",
      channel: "email",
      from: "rachel.foster@agency.digital",
      to: [DEFAULT_MAILBOX_ADDRESS],
      subject: "Account deletion request",
      text:
        "I would like to request deletion of my account and all associated data per GDPR. Please confirm the timeline and any verification steps needed.",
      receivedAt: "2026-03-17T13:10:00Z",
      sentAt: null
    }),
    createMessage({
      id: "msg-1842-2",
      ticketId: "TKT-1842",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1842",
      direction: "outbound",
      channel: "email",
      from: "marcus@6esk.com",
      to: ["rachel.foster@agency.digital"],
      subject: "Re: Account deletion request",
      text:
        "Hi Rachel, we've initiated the deletion workflow and sent a verification request to your primary inbox. Once confirmed, the account removal will complete within 72 hours.",
      sentAt: "2026-03-17T13:45:00Z",
      receivedAt: "2026-03-17T13:45:00Z"
    }),
    createMessage({
      id: "msg-1841-1",
      ticketId: "TKT-1841",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1841",
      direction: "inbound",
      channel: "email",
      from: "tom.wilson@consulting.biz",
      to: [DEFAULT_MAILBOX_ADDRESS],
      subject: "Webhook notifications not being received",
      text:
        "Our webhook endpoint is configured correctly but we haven't received any notifications since 09:14 UTC. Can you verify retries from your side?",
      receivedAt: "2026-03-17T11:30:00Z",
      sentAt: null
    }),
    createMessage({
      id: "msg-1841-2",
      ticketId: "TKT-1841",
      mailboxId: null,
      threadId: "ticket-thread-1841",
      direction: "outbound",
      channel: "voice",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567897"],
      subject: null,
      text: "Explained webhook retry settings and manually replayed the failed events.",
      sentAt: "2026-03-18T08:45:00Z",
      receivedAt: "2026-03-18T08:45:00Z",
      callSession: {
        status: "completed",
        durationSeconds: 410,
        recordingUrl: "#"
      },
      transcript: { text: "Elena reviewed the webhook backoff policy and confirmed a manual replay." },
      statusEvents: [{ status: "resolved on call" }]
    }),
    createMessage({
      id: "msg-1840-1",
      ticketId: "TKT-1840",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1840",
      direction: "inbound",
      channel: "email",
      from: "emily.zhang@saas.company",
      to: [DEFAULT_MAILBOX_ADDRESS],
      subject: "Mobile app keeps crashing on iOS",
      text:
        "The mobile app crashes immediately after opening on my iPhone 15 Pro. I've tried reinstalling multiple times but the issue persists.",
      receivedAt: "2026-03-17T10:15:00Z",
      sentAt: null
    }),
    createMessage({
      id: "msg-1840-2",
      ticketId: "TKT-1840",
      mailboxId: null,
      threadId: "ticket-thread-1840",
      direction: "outbound",
      channel: "whatsapp",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567892"],
      subject: null,
      text:
        "Hi Emily, we've identified the iOS crash issue and pushed an emergency update. Can you update to version 2.4.2 and let us know if it's working?",
      sentAt: "2026-03-17T11:30:00Z",
      receivedAt: "2026-03-17T11:30:00Z",
      waStatus: "read",
      aiMeta: { template_name: "urgent_update_notification" }
    }),
    createMessage({
      id: "msg-1840-3",
      ticketId: "TKT-1840",
      mailboxId: null,
      threadId: "ticket-thread-1840",
      direction: "inbound",
      channel: "whatsapp",
      from: "+1234567892",
      to: [DEFAULT_WHATSAPP_NUMBER],
      subject: null,
      text: "Updated and it works perfectly now. Thank you so much for the quick fix!",
      receivedAt: "2026-03-17T11:45:00Z",
      sentAt: null,
      waStatus: "read"
    }),
    createMessage({
      id: "msg-1839-1",
      ticketId: "TKT-1839",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1839",
      direction: "inbound",
      channel: "email",
      from: "carlos.mendez@retail.shop",
      to: [DEFAULT_MAILBOX_ADDRESS],
      subject: "Team member access permissions",
      text: "I need to adjust permissions for one of our team members who recently changed roles.",
      receivedAt: "2026-03-16T15:40:00Z",
      sentAt: null
    }),
    createMessage({
      id: "msg-1839-2",
      ticketId: "TKT-1839",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1839",
      direction: "outbound",
      channel: "email",
      from: "james@6esk.com",
      to: ["carlos.mendez@retail.shop"],
      subject: "Re: Team member access permissions",
      text:
        "You can update the role from Settings > Team. I've attached the RBAC guide and verified the account now reflects the new role.",
      sentAt: "2026-03-17T09:20:00Z",
      receivedAt: "2026-03-17T09:20:00Z"
    }),
    createMessage({
      id: "msg-1838-1",
      ticketId: "TKT-1838",
      mailboxId: null,
      threadId: "ticket-thread-1838",
      direction: "inbound",
      channel: "whatsapp",
      from: "+1234567899",
      to: [DEFAULT_WHATSAPP_NUMBER],
      subject: null,
      text: "We're hitting the API rate limit frequently during our peak hours. Is there a way to increase this?",
      receivedAt: "2026-03-16T14:25:00Z",
      sentAt: null,
      waStatus: "read"
    }),
    createMessage({
      id: "msg-1838-2",
      ticketId: "TKT-1838",
      mailboxId: null,
      threadId: "ticket-thread-1838",
      direction: "outbound",
      channel: "voice",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: ["+1234567899"],
      subject: null,
      text: "Attempted to call customer about enterprise rate limit add-on.",
      sentAt: "2026-03-17T11:10:00Z",
      receivedAt: "2026-03-17T11:10:00Z",
      callSession: {
        status: "no-answer",
        durationSeconds: 0,
        recordingUrl: null
      },
      statusEvents: [{ status: "no answer" }]
    }),
    createMessage({
      id: "msg-1723-1",
      ticketId: "TKT-1723",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1723",
      direction: "inbound",
      channel: "email",
      from: "john.davidson@techcorp.com",
      to: [DEFAULT_MAILBOX_ADDRESS],
      subject: "Question about API rate limits",
      text: "We need temporary headroom for a launch week campaign and wanted to confirm our options.",
      receivedAt: "2026-03-10T14:30:00Z",
      sentAt: null
    }),
    createMessage({
      id: "msg-1723-2",
      ticketId: "TKT-1723",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1723",
      direction: "outbound",
      channel: "email",
      from: "marcus@6esk.com",
      to: ["john.davidson@techcorp.com"],
      subject: "Re: Question about API rate limits",
      text: "We've temporarily raised your burst window and included guidance for a permanent enterprise expansion.",
      sentAt: "2026-03-10T15:05:00Z",
      receivedAt: "2026-03-10T15:05:00Z"
    }),
    createMessage({
      id: "msg-1654-1",
      ticketId: "TKT-1654",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1654",
      direction: "inbound",
      channel: "email",
      from: "john.davidson@techcorp.com",
      to: [DEFAULT_MAILBOX_ADDRESS],
      subject: "How to add team members?",
      text:
        "We onboarded new staff and need the right seat setup. Which role template do you recommend for analysts?",
      receivedAt: "2026-02-28T11:20:00Z",
      sentAt: null
    }),
    createMessage({
      id: "msg-1654-2",
      ticketId: "TKT-1654",
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "ticket-thread-1654",
      direction: "outbound",
      channel: "email",
      from: "elena@6esk.com",
      to: ["john.davidson@techcorp.com"],
      subject: "Re: How to add team members?",
      text: "I've included the recommended analyst role template and a quick-start guide for provisioning teammates.",
      sentAt: "2026-02-28T11:48:00Z",
      receivedAt: "2026-02-28T11:48:00Z"
    }),
    createMessage({
      id: "mail-1",
      ticketId: null,
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "thread-1",
      direction: "inbound",
      channel: "email",
      from: "marcus@6esk.com",
      to: ["sarah@6esk.com"],
      subject: "Q1 Support Metrics Review",
      text:
        "Hey Sarah, I wanted to share the Q1 metrics with you before our meeting tomorrow. Overall, first response time is down 23% from Q4.",
      receivedAt: "2026-03-18T09:30:00Z",
      sentAt: "2026-03-18T09:30:00Z",
      attachments: [createAttachment("mail-att-1", "Q1-Metrics-Report.pdf", "application/pdf", 245678)],
      isRead: false
    }),
    createMessage({
      id: "mail-2",
      ticketId: null,
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "thread-1",
      direction: "outbound",
      channel: "email",
      from: "sarah@6esk.com",
      to: ["marcus@6esk.com"],
      subject: "Re: Q1 Support Metrics Review",
      text: "Thanks Marcus. These numbers look strong. Can you also pull the breakdown by priority level?",
      receivedAt: "2026-03-18T10:15:00Z",
      sentAt: "2026-03-18T10:15:00Z",
      isRead: true
    }),
    createMessage({
      id: "mail-3",
      ticketId: null,
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "thread-1",
      direction: "inbound",
      channel: "email",
      from: "marcus@6esk.com",
      to: ["sarah@6esk.com"],
      subject: "Re: Q1 Support Metrics Review",
      text:
        "Absolutely. Urgent tickets are averaging 12 minutes for first response and I will update the report by end of day.",
      receivedAt: "2026-03-18T10:45:00Z",
      sentAt: "2026-03-18T10:45:00Z",
      isRead: false
    }),
    createMessage({
      id: "mail-4",
      ticketId: null,
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "thread-2",
      direction: "inbound",
      channel: "email",
      from: "elena@6esk.com",
      to: ["dev@6esk.com"],
      subject: "Webhook Integration Documentation",
      text:
        "Hi team, I've been getting questions from customers about webhook retry logic. Can we add more detail to the docs?",
      receivedAt: "2026-03-18T09:20:00Z",
      sentAt: "2026-03-18T09:20:00Z",
      isStarred: true,
      isRead: false
    }),
    createMessage({
      id: "mail-5",
      ticketId: null,
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "thread-3",
      direction: "inbound",
      channel: "email",
      from: "james@6esk.com",
      to: ["team@6esk.com"],
      subject: "Team Lunch - Friday",
      text: "Hey everyone, let's do team lunch this Friday at 12:30. Any preferences?",
      receivedAt: "2026-03-17T14:00:00Z",
      sentAt: "2026-03-17T14:00:00Z",
      isRead: true
    }),
    createMessage({
      id: "mail-6",
      ticketId: null,
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "thread-3",
      direction: "outbound",
      channel: "email",
      from: "sarah@6esk.com",
      to: ["james@6esk.com", "team@6esk.com"],
      subject: "Re: Team Lunch - Friday",
      text: "Sushi sounds great. Count me in.",
      receivedAt: "2026-03-17T15:30:00Z",
      sentAt: "2026-03-17T15:30:00Z",
      isRead: true
    }),
    createMessage({
      id: "mail-7",
      ticketId: null,
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "thread-4",
      direction: "outbound",
      channel: "email",
      from: "sarah@6esk.com",
      to: ["leadership@6esk.com"],
      subject: "SLA Target Updates for Q2",
      text: "Based on Q1 performance, I'd like to propose tighter SLA targets for Q2.",
      receivedAt: "2026-03-17T11:00:00Z",
      sentAt: "2026-03-17T11:00:00Z",
      isStarred: true,
      isPinned: true,
      isRead: true
    }),
    createMessage({
      id: "mail-8",
      ticketId: null,
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "thread-5",
      direction: "inbound",
      channel: "email",
      from: "marcus@6esk.com",
      to: ["sarah@6esk.com"],
      subject: "Customer: TechCorp - Escalation",
      text:
        "Sarah, TechCorp is threatening to churn. Dashboard access issue has been ongoing for 3 days now.",
      receivedAt: "2026-03-16T16:45:00Z",
      sentAt: "2026-03-16T16:45:00Z",
      isRead: true
    }),
    createMessage({
      id: "mail-9",
      ticketId: null,
      mailboxId: DEFAULT_MAILBOX_ID,
      threadId: "thread-6",
      direction: "inbound",
      channel: "email",
      from: "suspicious.sender@example.net",
      to: [DEFAULT_MAILBOX_ADDRESS],
      subject: "Claim your crypto reward now",
      text: "Open the attachment and claim your prize immediately.",
      receivedAt: "2026-03-18T06:45:00Z",
      sentAt: "2026-03-18T06:45:00Z",
      isSpam: true,
      spamReason: "crypto_phishing",
      isRead: false
    })
  ];

  const draftsByTicketId: Record<string, ApiDraft[]> = {
    "TKT-1847": [
      {
        id: "draft-1847-1",
        subject: "Re: Unable to access dashboard after latest update",
        body_text:
          "Hi John, thanks for confirming the workaround helped. The permanent fix is now deployed. Please refresh once more and let me know if you want us to keep extended monitoring on your workspace for the next 24 hours.",
        body_html: null,
        confidence: 0.94,
        status: "pending",
        created_at: "2026-03-18T09:56:00Z"
      }
    ],
    "TKT-1845": [
      {
        id: "draft-1845-1",
        subject: "Re: Feature request: Export data to CSV",
        body_text:
          "Hi Alex, thank you for the feedback. CSV export is on the product roadmap and we can also enable the current analytics export endpoint for your workspace if that helps in the short term.",
        body_html: null,
        confidence: 0.92,
        status: "pending",
        created_at: "2026-03-18T07:45:00Z"
      }
    ]
  };

  const eventsByTicketId: Record<string, ApiTicketEvent[]> = {
    "TKT-1849": [
      { id: "evt-1849-1", event_type: "status_updated", actor_user_id: null, data: { to: "open" }, created_at: "2026-03-18T10:58:00Z" },
      { id: "evt-1849-2", event_type: "assignment_updated", actor_user_id: "user-sarah", data: { assignedUserId: "user-sarah" }, created_at: "2026-03-18T10:59:00Z" },
      { id: "evt-1849-3", event_type: "note_added", actor_user_id: "user-sarah", data: { note: "Customer prefers WhatsApp for launch-week coordination." }, created_at: "2026-03-18T11:02:00Z" }
    ],
    "TKT-1848": [
      { id: "evt-1848-1", event_type: "status_updated", actor_user_id: null, data: { to: "pending" }, created_at: "2026-03-18T09:58:00Z" },
      { id: "evt-1848-2", event_type: "assignment_updated", actor_user_id: "user-sarah", data: { assignedUserId: "user-sarah" }, created_at: "2026-03-18T09:59:00Z" },
      { id: "evt-1848-3", event_type: "note_added", actor_user_id: "user-sarah", data: { note: "Voice callback completed with transcript and recording available for review." }, created_at: "2026-03-18T10:24:00Z" }
    ],
    "TKT-1847": [
      { id: "evt-1847-1", event_type: "status_updated", actor_user_id: null, data: { to: "open" }, created_at: "2026-03-18T09:24:00Z" },
      { id: "evt-1847-2", event_type: "assignment_updated", actor_user_id: "user-sarah", data: { assignedUserId: "user-sarah" }, created_at: "2026-03-18T09:24:20Z" },
      { id: "evt-1847-3", event_type: "priority_updated", actor_user_id: "user-sarah", data: { to: "urgent" }, created_at: "2026-03-18T09:25:00Z" }
    ],
    "TKT-1846": [
      { id: "evt-1846-1", event_type: "status_updated", actor_user_id: null, data: { to: "open" }, created_at: "2026-03-18T08:15:00Z" },
      { id: "evt-1846-2", event_type: "assignment_updated", actor_user_id: "user-sarah", data: { assignedUserId: "user-sarah" }, created_at: "2026-03-18T08:20:00Z" },
      { id: "evt-1846-3", event_type: "status_updated", actor_user_id: "user-sarah", data: { to: "pending" }, created_at: "2026-03-18T10:32:00Z" }
    ],
    "TKT-1844": [
      { id: "evt-1844-1", event_type: "status_updated", actor_user_id: null, data: { to: "pending" }, created_at: "2026-03-17T16:20:00Z" },
      { id: "evt-1844-2", event_type: "priority_updated", actor_user_id: "user-sarah", data: { to: "high" }, created_at: "2026-03-18T07:34:00Z" }
    ],
    "TKT-1837": [
      { id: "evt-1837-1", event_type: "status_updated", actor_user_id: null, data: { to: "pending" }, created_at: "2026-03-18T07:41:00Z" },
      { id: "evt-1837-2", event_type: "note_added", actor_user_id: "user-sarah", data: { note: "Customer requested a live update over WhatsApp before the board review." }, created_at: "2026-03-18T07:41:00Z" }
    ],
    "TKT-1836": [
      { id: "evt-1836-1", event_type: "status_updated", actor_user_id: null, data: { to: "pending" }, created_at: "2026-03-18T07:48:00Z" },
      { id: "evt-1836-2", event_type: "note_added", actor_user_id: "user-sarah", data: { note: "Completed troubleshooting call and confirmed the replay workaround live." }, created_at: "2026-03-18T07:48:00Z" }
    ]
  };

  const baseAuditLogs: AuditLogRecord[] = [
    {
      id: "audit-1",
      action: "ticket_viewed",
      entity_type: "ticket",
      entity_id: "TKT-1847",
      data: { route: "/tickets" },
      created_at: "2026-03-18T09:24:30Z",
      actor_name: "Sarah Chen",
      actor_email: "sarah@6esk.com"
    },
    {
      id: "audit-2",
      action: "whatsapp_template_synced",
      entity_type: "whatsapp_template",
      entity_id: "wa-template-1",
      data: { status: "active" },
      created_at: "2026-03-18T07:00:00Z",
      actor_name: "Automation",
      actor_email: null
    },
    {
      id: "audit-3",
      action: "agent_policy_updated",
      entity_type: "agent_integration",
      entity_id: "agent-1",
      data: { policyMode: "draft_only" },
      created_at: "2026-03-18T06:30:00Z",
      actor_name: "Sarah Chen",
      actor_email: "sarah@6esk.com"
    }
  ];

  const mailboxes: ApiMailbox[] = [
    { id: DEFAULT_MAILBOX_ID, address: DEFAULT_MAILBOX_ADDRESS, type: "shared" },
    { id: "mailbox-escalations", address: "escalations@6esk.com", type: "shared" }
  ];

  const supportMacros: SupportMacro[] = [
    { id: "macro-1", title: "Escalation acknowledgement", category: "triage", body: "Thanks for flagging this. I've escalated the issue and will update you within the hour.", is_active: true },
    { id: "macro-2", title: "Billing correction sent", category: "billing", body: "We've corrected the invoice and applied the appropriate account credit.", is_active: true },
    { id: "macro-3", title: "Need engineering logs", category: "technical", body: "Could you send the timestamp, affected workspace, and any console errors so we can confirm the failure path?", is_active: true },
    { id: "macro-4", title: "WhatsApp follow-up", category: "omnichannel", body: "Following up here so you have the latest status in the faster support channel.", is_active: true }
  ];

  const supportSavedViews: SupportSavedView[] = [
    {
      id: "view-1",
      name: "Urgent Mine",
      filters: { status: "open", priority: "urgent", assigned: "mine" },
      createdAt: "2026-03-15T08:00:00Z",
      updatedAt: "2026-03-18T08:00:00Z"
    },
    {
      id: "view-2",
      name: "WhatsApp Follow-up",
      filters: { channel: "whatsapp", assigned: "any", status: "pending" },
      createdAt: "2026-03-14T08:00:00Z",
      updatedAt: "2026-03-18T07:45:00Z"
    }
  ];

  const spamRules: SpamRuleRecord[] = [
    { id: "rule-1", rule_type: "block", scope: "domain", pattern: "cheap-crypto.biz", is_active: true, created_at: "2026-03-01T08:00:00Z" },
    { id: "rule-2", rule_type: "block", scope: "subject", pattern: "claim your reward", is_active: true, created_at: "2026-03-03T08:00:00Z" },
    { id: "rule-3", rule_type: "allow", scope: "sender", pattern: "support@vipclient.com", is_active: true, created_at: "2026-03-05T08:00:00Z" }
  ];

  const whatsAppAccount: WhatsAppAccount = {
    id: "wa-account-1",
    provider: "meta",
    phoneNumber: DEFAULT_WHATSAPP_NUMBER,
    wabaId: "waba-801",
    accessToken: "meta_access_token_demo",
    verifyToken: "verify_token_demo",
    status: "active",
    createdAt: "2026-01-01T08:00:00Z",
    updatedAt: "2026-03-18T08:00:00Z"
  };

  const whatsAppTemplates: WhatsAppTemplate[] = [
    { id: "wa-template-1", provider: "meta", name: "urgent_update_notification", language: "en_US", category: "utility", status: "active", components: [{ type: "body", parameters: [{ type: "text" }] }] },
    { id: "wa-template-2", provider: "meta", name: "billing_followup", language: "en_US", category: "utility", status: "active", components: [{ type: "body", parameters: [{ type: "text" }] }] },
    { id: "wa-template-3", provider: "meta", name: "resolution_checkin", language: "en_US", category: "utility", status: "active", components: [{ type: "body", parameters: [{ type: "text" }] }] },
    { id: "wa-template-4", provider: "meta", name: "integration_incident_update", language: "en_US", category: "utility", status: "paused", components: [{ type: "body", parameters: [{ type: "text" }] }] }
  ];

  const whatsAppOutbox: WhatsAppOutboxMetrics = {
    account: {
      id: whatsAppAccount.id,
      provider: whatsAppAccount.provider,
      phoneNumber: whatsAppAccount.phoneNumber,
      status: whatsAppAccount.status,
      updatedAt: whatsAppAccount.updatedAt ?? DEMO_NOW
    },
    queue: {
      queued: 6,
      dueNow: 2,
      processing: 1,
      failed: 1,
      sentTotal: 418,
      sent24h: 39,
      nextAttemptAt: "2026-03-19T08:45:00Z",
      lastSentAt: "2026-03-19T08:14:00Z",
      lastFailedAt: "2026-03-19T07:50:00Z",
      lastError: "window_closed"
    }
  };

  const agents: AgentIntegration[] = [
    {
      id: "agent-1",
      name: "6esk AI Copilot",
      provider: "elizaos",
      base_url: "https://agents.internal/6esk-copilot",
      auth_type: "hmac",
      shared_secret: "agent_secret_demo",
      status: "active",
      policy_mode: "draft_only",
      scopes: { tickets: true, analytics: true, admin: false },
      capabilities: { max_events_per_run: 50, allow_merge_actions: true, allow_voice_actions: true },
      policy: { escalation_required_for: ["urgent", "gdpr"] },
      created_at: "2026-02-01T08:00:00Z",
      updated_at: "2026-03-18T08:10:00Z"
    },
    {
      id: "agent-2",
      name: "Ops Recovery Worker",
      provider: "openai",
      base_url: "https://agents.internal/ops-recovery",
      auth_type: "shared_secret",
      shared_secret: "ops_recovery_secret_demo",
      status: "paused",
      policy_mode: "auto_send",
      scopes: { dead_letters: true, inbound: true },
      capabilities: { max_events_per_run: 25, allow_merge_actions: false, allow_voice_actions: false },
      policy: { throttle_window_minutes: 15 },
      created_at: "2026-02-15T08:00:00Z",
      updated_at: "2026-03-18T07:20:00Z"
    }
  ];

  const agentOutboxes: Record<string, AgentOutboxMetrics> = {
    "agent-1": {
      integrationId: "agent-1",
      integrationStatus: "active",
      throughput: { configuredMaxEventsPerRun: 50, effectiveLimit: 50 },
      queue: {
        pending: 12,
        dueNow: 4,
        processing: 1,
        failed: 1,
        deliveredTotal: 842,
        delivered24h: 61,
        nextAttemptAt: "2026-03-19T08:40:00Z",
        lastDeliveredAt: "2026-03-19T08:12:00Z",
        lastFailedAt: "2026-03-19T07:18:00Z",
        lastError: "provider timeout"
      }
    },
    "agent-2": {
      integrationId: "agent-2",
      integrationStatus: "paused",
      throughput: { configuredMaxEventsPerRun: 25, effectiveLimit: 25 },
      queue: {
        pending: 8,
        dueNow: 0,
        processing: 0,
        failed: 2,
        deliveredTotal: 121,
        delivered24h: 0,
        nextAttemptAt: null,
        lastDeliveredAt: "2026-03-18T14:22:00Z",
        lastFailedAt: "2026-03-18T15:10:00Z",
        lastError: "paused_by_operator"
      }
    }
  };

  const profileLookupSeries: ProfileLookupMetrics["series"] = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(Date.parse("2026-03-05T00:00:00Z") + index * 86400000).toISOString().slice(0, 10);
    const matched = 70 + index * 2;
    const matchedLive = 42 + index;
    const matchedCache = 18 + Math.floor(index / 2);
    const matchedOther = matched - matchedLive - matchedCache;
    const missed = 8 - Math.floor(index / 5);
    const errored = index % 4 === 0 ? 2 : 1;
    const disabled = index % 6 === 0 ? 1 : 0;
    return { day: date, matched, matchedLive, matchedCache, matchedOther, missed, errored, disabled };
  });

  const inboundMetrics: InboundMetrics = {
    generatedAt: DEMO_NOW,
    windowHours: 24,
    summary: {
      failedQueue: 7,
      dueRetryNow: 3,
      processingNow: 1,
      processedWindow: 488,
      failedWindow: 17,
      attemptsWindow: 526,
      retryProcessedWindow: 41,
      retryFailedWindow: 9,
      highAttemptQueue: 2,
      maxFailedAttemptCount: 6,
      p95FailedAttemptCount: 4,
      oldestFailedAgeMinutes: 93
    },
    alert: {
      source: "db",
      webhookConfigured: true,
      threshold: 10,
      windowMinutes: 30,
      cooldownMinutes: 60,
      currentFailures: 7,
      status: "below_threshold",
      cooldownRemainingMinutes: 0,
      lastSentAt: "2026-03-18T22:40:00Z",
      wouldSendNow: false,
      recommendation: {
        suggestedMinThreshold: 9,
        suggestedMaxThreshold: 14,
        inRange: true,
        reason: "Current threshold is aligned with recent failure volume.",
        avgBucketFailures: 5.4,
        p95BucketFailures: 11,
        maxBucketFailures: 14,
        bucketCount: 48
      }
    },
    failureReasons: [
      { code: "missing_signature", label: "Missing signature", severity: "high", triageLabel: "Verify webhook signer", triageHint: "Requests arrived without the expected HMAC header.", count: 6, sampleError: "signature missing" },
      { code: "payload_validation", label: "Payload validation", severity: "medium", triageLabel: "Inspect payload schema", triageHint: "Provider payload is missing required fields.", count: 5, sampleError: "ticket_id is required" },
      { code: "db_timeout", label: "Database timeout", severity: "critical", triageLabel: "Check database load", triageHint: "Persisting inbound events exceeded the DB timeout budget.", count: 3, sampleError: "statement timeout" }
    ],
    series: Array.from({ length: 24 }, (_, index) => ({
      hour: new Date(Date.parse("2026-03-18T09:00:00Z") + index * 3600000).toISOString(),
      failed: index % 6 === 0 ? 2 : 0,
      processed: 12 + (index % 5),
      processing: index % 8 === 0 ? 1 : 0,
      attempts: 13 + (index % 6)
    }))
  };

  const inboundSettings: InboundAlertConfig = {
    source: "db",
    webhookUrl: "https://hooks.slack.com/services/demo/support-alerts",
    threshold: 10,
    windowMinutes: 30,
    cooldownMinutes: 60,
    updatedAt: "2026-03-18T21:00:00Z"
  };

  const failedInboundEvents: InboundFailedEvent[] = [
    { id: "inbound-fail-1", idempotency_key: "inb-20260319-001", attempt_count: 4, last_error: "signature missing", next_attempt_at: "2026-03-19T08:40:00Z", created_at: "2026-03-19T07:55:00Z" },
    { id: "inbound-fail-2", idempotency_key: "inb-20260319-002", attempt_count: 2, last_error: "statement timeout", next_attempt_at: "2026-03-19T08:35:00Z", created_at: "2026-03-19T08:00:00Z" },
    { id: "inbound-fail-3", idempotency_key: "inb-20260319-003", attempt_count: 5, last_error: "payload validation failed", next_attempt_at: "2026-03-19T08:50:00Z", created_at: "2026-03-19T08:05:00Z" }
  ];

  const callOutbox: CallOutboxMetrics = {
    provider: "twilio",
    queue: {
      queued: 9,
      dueNow: 3,
      processing: 1,
      failed: 2,
      sentTotal: 219,
      sent24h: 18,
      nextAttemptAt: "2026-03-19T08:38:00Z",
      lastSentAt: "2026-03-19T08:10:00Z",
      lastFailedAt: "2026-03-19T07:05:00Z",
      lastError: "429 rate limit"
    },
    webhookSecurity: {
      mode: "hmac",
      timestampRequired: true,
      maxSkewSeconds: 300,
      legacyBodySignature: false
    }
  };

  const failedCallEvents: CallFailedEvent[] = [
    { id: "call-fail-1", status: "failed", attempt_count: 3, last_error: "provider timeout", next_attempt_at: "2026-03-19T08:44:00Z", created_at: "2026-03-19T07:20:00Z", updated_at: "2026-03-19T08:12:00Z", payload: { to: "+15551230001", reason: "reconnect needed" } },
    { id: "call-fail-2", status: "failed", attempt_count: 2, last_error: "customer busy", next_attempt_at: "2026-03-19T09:00:00Z", created_at: "2026-03-19T07:45:00Z", updated_at: "2026-03-19T08:15:00Z", payload: { to: "+15551230002", reason: "busy" } }
  ];

  const callRejections: CallRejections = {
    windowHours: 24,
    summary: [
      { reason: "signature_mismatch", mode: "webhook", count: 4 },
      { reason: "stale_timestamp", mode: "webhook", count: 2 },
      { reason: "missing_call_session", mode: "payload", count: 3 }
    ],
    recent: [
      { id: "call-reject-1", createdAt: "2026-03-19T07:58:00Z", data: { reason: "signature_mismatch", mode: "webhook", endpoint: "/api/voice/webhook", requestId: "req-101" } },
      { id: "call-reject-2", createdAt: "2026-03-19T07:22:00Z", data: { reason: "missing_call_session", mode: "payload", endpoint: "/api/voice/webhook", requestId: "req-099" } }
    ]
  };

  const deadLetters: DeadLetterEvent[] = [
    { id: "dead-1", call_session_id: "call-session-901", direction: "outbound", status: "failed", reason: "provider_timeout", attempt_count: 5, max_attempts: 5, last_error: "Provider timed out", last_error_code: "timeout", payload: { to: "+15551230001" }, created_at: "2026-03-18T20:10:00Z", updated_at: "2026-03-19T07:10:00Z", next_attempt_at: null },
    { id: "dead-2", call_session_id: "call-session-902", direction: "outbound", status: "quarantined", reason: "invalid_number", attempt_count: 3, max_attempts: 5, last_error: "Invalid E.164 number", last_error_code: "invalid_number", payload: { to: "+1555000" }, created_at: "2026-03-18T19:10:00Z", updated_at: "2026-03-19T07:11:00Z", next_attempt_at: null },
    { id: "dead-3", call_session_id: "call-session-903", direction: "inbound", status: "poison", reason: "payload_corrupt", attempt_count: 5, max_attempts: 5, last_error: "Payload could not be parsed", last_error_code: "payload_corrupt", payload: { raw: true }, created_at: "2026-03-18T18:10:00Z", updated_at: "2026-03-19T07:12:00Z", next_attempt_at: null }
  ];

  const mergeReviews: MergeReviewQueueItem[] = [
    {
      id: "merge-1",
      status: "pending",
      proposal_type: "ticket",
      ticket_id: "TKT-1847",
      source_ticket_id: "TKT-1847",
      target_ticket_id: "TKT-1723",
      source_customer_id: null,
      target_customer_id: null,
      reason: "Potential duplicate dashboard incident from same requester",
      confidence: 0.93,
      metadata: { matches: ["requester_email", "subject_cluster"] },
      failure_reason: null,
      proposed_by_agent_id: "agent-1",
      proposed_by_user_id: null,
      reviewed_by_user_id: null,
      reviewed_at: null,
      applied_at: null,
      created_at: "2026-03-18T10:00:00Z",
      updated_at: "2026-03-18T10:00:00Z",
      context_ticket_subject: "Unable to access dashboard after latest update",
      context_ticket_requester_email: "john.davidson@techcorp.com",
      source_ticket_subject: "Unable to access dashboard after latest update",
      source_ticket_requester_email: "john.davidson@techcorp.com",
      source_ticket_has_whatsapp: true,
      source_ticket_has_voice: false,
      target_ticket_subject: "Question about API rate limits",
      target_ticket_requester_email: "john.davidson@techcorp.com",
      target_ticket_has_whatsapp: false,
      target_ticket_has_voice: false,
      source_customer_display_name: null,
      source_customer_primary_email: null,
      source_customer_primary_phone: null,
      target_customer_display_name: null,
      target_customer_primary_email: null,
      target_customer_primary_phone: null
    },
    {
      id: "merge-2",
      status: "pending",
      proposal_type: "customer",
      ticket_id: null,
      source_ticket_id: null,
      target_ticket_id: null,
      source_customer_id: "cust-amanda-shadow",
      target_customer_id: "cust-amanda",
      reason: "Shared primary phone with unverified duplicate profile",
      confidence: 0.88,
      metadata: { identities: ["+1234567899"] },
      failure_reason: null,
      proposed_by_agent_id: "agent-1",
      proposed_by_user_id: null,
      reviewed_by_user_id: null,
      reviewed_at: null,
      applied_at: null,
      created_at: "2026-03-18T11:30:00Z",
      updated_at: "2026-03-18T11:30:00Z",
      context_ticket_subject: null,
      context_ticket_requester_email: null,
      source_ticket_subject: null,
      source_ticket_requester_email: null,
      source_ticket_has_whatsapp: false,
      source_ticket_has_voice: false,
      target_ticket_subject: null,
      target_ticket_requester_email: null,
      target_ticket_has_whatsapp: false,
      target_ticket_has_voice: false,
      source_customer_display_name: "Amanda L.",
      source_customer_primary_email: "amanda+sales@fintech.ai",
      source_customer_primary_phone: "+1234567899",
      target_customer_display_name: "Amanda Lee",
      target_customer_primary_email: "amanda.lee@fintech.ai",
      target_customer_primary_phone: "+1234567899"
    },
    {
      id: "merge-3",
      status: "failed",
      proposal_type: "ticket",
      ticket_id: "TKT-1844",
      source_ticket_id: "TKT-1844",
      target_ticket_id: "TKT-1838",
      source_customer_id: null,
      target_customer_id: null,
      reason: "Previous merge attempt blocked by conflicting assignee ownership",
      confidence: 0.62,
      metadata: { blocker: "assignment_conflict" },
      failure_reason: "target ticket locked by workflow automation",
      proposed_by_agent_id: null,
      proposed_by_user_id: "user-sarah",
      reviewed_by_user_id: "user-sarah",
      reviewed_at: "2026-03-18T12:30:00Z",
      applied_at: null,
      created_at: "2026-03-18T12:00:00Z",
      updated_at: "2026-03-18T12:30:00Z",
      context_ticket_subject: "Integration not syncing with Salesforce",
      context_ticket_requester_email: "lisa.nguyen@enterprise.com",
      source_ticket_subject: "Integration not syncing with Salesforce",
      source_ticket_requester_email: "lisa.nguyen@enterprise.com",
      source_ticket_has_whatsapp: false,
      source_ticket_has_voice: false,
      target_ticket_subject: "API rate limit seems too restrictive",
      target_ticket_requester_email: "amanda.lee@fintech.ai",
      target_ticket_has_whatsapp: true,
      target_ticket_has_voice: true,
      source_customer_display_name: null,
      source_customer_primary_email: null,
      source_customer_primary_phone: null,
      target_customer_display_name: null,
      target_customer_primary_email: null,
      target_customer_primary_phone: null
    },
    {
      id: "merge-4",
      status: "rejected",
      proposal_type: "customer",
      ticket_id: null,
      source_ticket_id: null,
      target_ticket_id: null,
      source_customer_id: "cust-john-shadow",
      target_customer_id: "cust-john",
      reason: "Email alias looked similar but identity evidence was weak",
      confidence: 0.41,
      metadata: null,
      failure_reason: null,
      proposed_by_agent_id: "agent-1",
      proposed_by_user_id: null,
      reviewed_by_user_id: "user-sarah",
      reviewed_at: "2026-03-17T17:10:00Z",
      applied_at: null,
      created_at: "2026-03-17T16:50:00Z",
      updated_at: "2026-03-17T17:10:00Z",
      context_ticket_subject: null,
      context_ticket_requester_email: null,
      source_ticket_subject: null,
      source_ticket_requester_email: null,
      source_ticket_has_whatsapp: false,
      source_ticket_has_voice: false,
      target_ticket_subject: null,
      target_ticket_requester_email: null,
      target_ticket_has_whatsapp: false,
      target_ticket_has_voice: false,
      source_customer_display_name: "John D.",
      source_customer_primary_email: "john@techcorp.com",
      source_customer_primary_phone: "+1234567890",
      target_customer_display_name: "John Davidson",
      target_customer_primary_email: "john.davidson@techcorp.com",
      target_customer_primary_phone: "+1234567890"
    },
    {
      id: "merge-5",
      status: "applied",
      proposal_type: "ticket",
      ticket_id: "TKT-1839",
      source_ticket_id: "TKT-1839",
      target_ticket_id: "TKT-1654",
      source_customer_id: null,
      target_customer_id: null,
      reason: "Resolved duplicate permission request",
      confidence: 0.84,
      metadata: null,
      failure_reason: null,
      proposed_by_agent_id: null,
      proposed_by_user_id: "user-james",
      reviewed_by_user_id: "user-sarah",
      reviewed_at: "2026-03-16T16:10:00Z",
      applied_at: "2026-03-16T16:12:00Z",
      created_at: "2026-03-16T16:00:00Z",
      updated_at: "2026-03-16T16:12:00Z",
      context_ticket_subject: "Team member access permissions",
      context_ticket_requester_email: "carlos.mendez@retail.shop",
      source_ticket_subject: "Team member access permissions",
      source_ticket_requester_email: "carlos.mendez@retail.shop",
      source_ticket_has_whatsapp: false,
      source_ticket_has_voice: false,
      target_ticket_subject: "How to add team members?",
      target_ticket_requester_email: "john.davidson@techcorp.com",
      target_ticket_has_whatsapp: false,
      target_ticket_has_voice: false,
      source_customer_display_name: null,
      source_customer_primary_email: null,
      source_customer_primary_phone: null,
      target_customer_display_name: null,
      target_customer_primary_email: null,
      target_customer_primary_phone: null
    }
  ];

  return {
    currentUser,
    roles,
    users,
    sla: { firstResponseMinutes: 120, resolutionMinutes: 1440 },
    security: {
      adminAllowlist: ["10.0.0.0/24", "192.168.0.0/24"],
      agentAllowlist: ["10.10.0.0/24"],
      agentSecretKeyConfigured: true,
      inboundSecretConfigured: true,
      clientIp: "127.0.0.1",
      agentIntegrationStats: { total: agents.length, encrypted: agents.length, unencrypted: 0 },
      whatsappTokenStats: { total: 1, encrypted: 1, unencrypted: 0, missing: 0 }
    },
    tags,
    supportMacros,
    supportSavedViews,
    customers,
    tickets,
    messages,
    draftsByTicketId,
    eventsByTicketId,
    auditLogs: baseAuditLogs,
    mailboxes,
    spamRules,
    whatsAppAccount,
    whatsAppTemplates,
    whatsAppOutbox,
    agents,
    agentOutboxes,
    profileLookupSeries,
    inboundMetrics,
    inboundSettings,
    failedInboundEvents,
    callOutbox,
    failedCallEvents,
    callRejections,
    deadLetters,
    mergeReviews,
    analyticsBase: buildAnalyticsBase(),
    nextTicketNumber: 1850,
    nextSavedViewNumber: 3
  };
}

function getState() {
  if (!demoState) {
    demoState = buildInitialState();
  }
  return demoState;
}

function getTicketById(ticketId: string) {
  const ticket = getState().tickets.find((entry) => entry.id === ticketId);
  if (!ticket) {
    throw new Error(`Ticket ${ticketId} was not found.`);
  }
  return ticket;
}

function getMessageById(messageId: string) {
  const message = getState().messages.find((entry) => entry.id === messageId);
  if (!message) {
    throw new Error(`Message ${messageId} was not found.`);
  }
  return message;
}

function toApiTicket(ticket: InternalTicket): ApiTicket {
  return {
    id: ticket.id,
    requester_email: ticket.requester_email,
    subject: ticket.subject,
    category: ticket.category,
    metadata: cloneValue(ticket.metadata ?? null),
    tags: [...(ticket.tags ?? [])],
    has_whatsapp: ticket.has_whatsapp,
    has_voice: ticket.has_voice,
    status: ticket.status,
    priority: ticket.priority,
    assigned_user_id: ticket.assigned_user_id,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at
  };
}

function toApiTicketMessage(message: InternalMessage) {
  return {
    id: message.id,
    direction: message.direction,
    channel: message.channel,
    origin: message.origin,
    from_email: message.from,
    to_emails: message.to,
    subject: message.subject,
    preview_text: message.previewText,
    received_at: message.receivedAt,
    sent_at: message.sentAt,
    wa_status: message.waStatus,
    wa_timestamp: message.waTimestamp
  };
}

function toApiMessageDetail(message: InternalMessage): SupportMessageDetail & MailMessageDetail {
  return {
    message: {
      id: message.id,
      subject: message.subject,
      from: message.from,
      to: [...message.to],
      direction: message.direction,
      channel: message.channel,
      origin: message.origin,
      receivedAt: message.receivedAt,
      sentAt: message.sentAt,
      isStarred: message.isStarred,
      isPinned: message.isPinned,
      isSpam: message.isSpam,
      spamReason: message.spamReason,
      waStatus: message.waStatus,
      waTimestamp: message.waTimestamp,
      waContact: message.channel === "whatsapp" ? message.to[0] ?? null : null,
      conversationId: message.threadId,
      provider: message.channel === "whatsapp" ? "meta" : message.channel === "voice" ? "twilio" : "smtp",
      text: message.text,
      html: message.html,
      aiMeta: message.aiMeta,
      callSession: message.callSession,
      transcript: message.transcript,
      statusEvents: cloneValue(message.statusEvents)
    },
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      content_type: attachment.contentType,
      size_bytes: attachment.sizeBytes
    }))
  };
}

function toApiMailboxMessage(message: InternalMessage): ApiMailboxMessage {
  return {
    id: message.id,
    direction: message.direction,
    channel: message.channel,
    from_email: message.from,
    subject: message.subject,
    preview_text: message.previewText,
    received_at: message.receivedAt,
    sent_at: message.sentAt,
    is_read: message.isRead,
    is_starred: message.isStarred,
    is_pinned: message.isPinned,
    is_spam: message.isSpam,
    spam_reason: message.spamReason,
    thread_id: message.threadId,
    created_at: message.createdAt,
    has_attachments: message.attachments.length > 0
  };
}

function deriveTicketChannel(ticketId: string): "email" | "whatsapp" | "voice" {
  const messages = getState().messages.filter((message) => message.ticketId === ticketId);
  const inbound = messages.find((message) => message.direction === "inbound");
  return inbound?.channel ?? messages[0]?.channel ?? "email";
}

function findCustomerByTicket(ticketId: string) {
  const ticket = getTicketById(ticketId);
  return getState().customers[ticket.customerId] ?? null;
}

function getTicketMessages(ticketId: string) {
  return getState().messages
    .filter((message) => message.ticketId === ticketId)
    .sort(
      (left, right) =>
        Date.parse(left.sentAt ?? left.receivedAt ?? left.createdAt) -
        Date.parse(right.sentAt ?? right.receivedAt ?? right.createdAt)
    );
}

function getTicketAuditLogs(ticketId: string) {
  return getState().auditLogs.filter((log) => log.entity_type === "ticket" && log.entity_id === ticketId);
}

function appendAuditLog(entry: Omit<AuditLogRecord, "id" | "created_at"> & { created_at?: string }) {
  const state = getState();
  state.auditLogs.unshift({
    id: `audit-${state.auditLogs.length + 1}`,
    created_at: entry.created_at ?? DEMO_NOW,
    ...entry
  });
}

function appendTicketEvent(
  ticketId: string,
  event: Omit<ApiTicketEvent, "id" | "created_at"> & { created_at?: string }
) {
  const state = getState();
  const current = state.eventsByTicketId[ticketId] ?? [];
  current.push({
    id: `evt-${ticketId.toLowerCase()}-${current.length + 1}`,
    created_at: event.created_at ?? DEMO_NOW,
    ...event
  });
  state.eventsByTicketId[ticketId] = current;
}

function touchTicket(ticketId: string, updatedAt = DEMO_NOW) {
  const ticket = getTicketById(ticketId);
  ticket.updated_at = updatedAt;
}

function parseJsonBody<T>(init?: RequestInit) {
  if (!init?.body || typeof init.body !== "string") {
    return {} as T;
  }
  try {
    return JSON.parse(init.body) as T;
  } catch {
    return {} as T;
  }
}

function createMailboxMessage(
  state: DemoState,
  input: {
    mailboxId?: string | null;
    ticketId?: string | null;
    threadId: string;
    direction: "inbound" | "outbound";
    channel: "email" | "whatsapp" | "voice";
    from: string;
    to: string[];
    subject?: string | null;
    text?: string | null;
    sentAt?: string | null;
    receivedAt?: string | null;
    attachments?: InternalAttachment[];
    waStatus?: string | null;
    aiMeta?: Record<string, unknown> | null;
    callSession?: InternalMessage["callSession"];
    transcript?: InternalMessage["transcript"];
    statusEvents?: InternalMessage["statusEvents"];
  }
) {
  const id = `msg-${Date.now()}-${state.messages.length + 1}`;
  const message = createMessage({
    id,
    ticketId: input.ticketId ?? null,
    mailboxId: input.mailboxId ?? null,
    threadId: input.threadId,
    direction: input.direction,
    channel: input.channel,
    from: input.from,
    to: input.to,
    subject: input.subject ?? null,
    text: input.text ?? null,
    sentAt: input.sentAt ?? DEMO_NOW,
    receivedAt: input.receivedAt ?? input.sentAt ?? DEMO_NOW,
    attachments: input.attachments,
    waStatus: input.waStatus,
    aiMeta: input.aiMeta,
    callSession: input.callSession,
    transcript: input.transcript,
    statusEvents: input.statusEvents
  });
  state.messages.push(message);
  return message;
}

function getTicketHistory(ticketId: string): CustomerHistoryResponse {
  const ticket = getTicketById(ticketId);
  const customer = getState().customers[ticket.customerId] ?? null;
  if (!customer) {
    return { customer: null, history: [] };
  }
  const history = getState().tickets
    .filter((entry) => entry.customerId === ticket.customerId)
    .map((entry) => {
      const messages = getTicketMessages(entry.id);
      const lastMessageAt = [...messages].sort(
        (left, right) =>
          Date.parse(right.sentAt ?? right.receivedAt ?? right.createdAt) -
          Date.parse(left.sentAt ?? left.receivedAt ?? left.createdAt)
      )[0];
      const lastCustomerInbound = [...messages]
        .filter((message) => message.direction === "inbound")
        .sort(
          (left, right) =>
            Date.parse(right.receivedAt ?? right.sentAt ?? right.createdAt) -
            Date.parse(left.receivedAt ?? left.sentAt ?? left.createdAt)
        )[0];
      return {
        ticketId: entry.id,
        subject: entry.subject,
        status: entry.status,
        channel: deriveTicketChannel(entry.id),
        lastMessageAt: lastMessageAt
          ? lastMessageAt.sentAt ?? lastMessageAt.receivedAt ?? lastMessageAt.createdAt
          : entry.updated_at,
        lastCustomerInboundAt: lastCustomerInbound
          ? lastCustomerInbound.receivedAt ?? lastCustomerInbound.sentAt ?? lastCustomerInbound.createdAt
          : null
      };
    });
  return { customer: cloneValue(customer), history: cloneValue(history) };
}

function buildTicketDetails(ticketId: string): TicketDetailsResponse {
  const ticket = getTicketById(ticketId);
  return {
    ticket: toApiTicket(ticket),
    messages: getTicketMessages(ticketId).map(toApiTicketMessage),
    events: cloneValue(getState().eventsByTicketId[ticketId] ?? []),
    drafts: cloneValue(getState().draftsByTicketId[ticketId] ?? []),
    auditLogs: cloneValue(getTicketAuditLogs(ticketId))
  };
}

function filterTickets(url: URL) {
  const status = url.searchParams.get("status");
  const priority = url.searchParams.get("priority");
  const tag = url.searchParams.get("tag")?.trim().toLowerCase();
  const channel = url.searchParams.get("channel");
  const assigned = url.searchParams.get("assigned");
  const query = url.searchParams.get("q")?.trim().toLowerCase();
  const state = getState();
  return state.tickets
    .filter((ticket) => !ticket.archived)
    .filter((ticket) => (status ? ticket.status === status : true))
    .filter((ticket) => (priority ? ticket.priority === priority : true))
    .filter((ticket) => (tag ? ticket.tags?.some((entry) => entry.toLowerCase() === tag) : true))
    .filter((ticket) => (channel ? deriveTicketChannel(ticket.id) === channel : true))
    .filter((ticket) => (assigned === "mine" ? ticket.assigned_user_id === state.currentUser.id : true))
    .filter((ticket) => {
      if (!query) return true;
      const haystack = [
        ticket.id,
        ticket.requester_email,
        ticket.subject ?? "",
        ticket.category ?? "",
        ...(ticket.tags ?? [])
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    })
    .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
}

function parseRange(url: URL) {
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  return {
    start: start ? Date.parse(start) : Number.NEGATIVE_INFINITY,
    end: end ? Date.parse(end) : Number.POSITIVE_INFINITY
  };
}

function analyticsRowsForRange(url: URL) {
  const { start, end } = parseRange(url);
  return getState().analyticsBase.filter((row) => {
    const at = Date.parse(`${row.day}T12:00:00Z`);
    return at >= start && at <= end;
  });
}

function buildOverview(url: URL): OverviewResponse {
  const rows = analyticsRowsForRange(url);
  const totalTickets = rows.reduce((sum, row) => sum + row.created, 0);
  const solvedTickets = rows.reduce((sum, row) => sum + row.solved, 0);
  const openTickets = Math.max(0, totalTickets - solvedTickets + 41);
  const avgFirstResponseSeconds = Math.round(
    (rows.reduce((sum, row) => sum + row.avgResponseMinutes, 0) / Math.max(rows.length, 1)) * 60
  );
  const avgResolutionSeconds = Math.round(((avgFirstResponseSeconds * 18.5) / 45) * 3600 / 60);
  const emailInbound = rows.reduce((sum, row) => sum + Math.round(row.created * 0.4), 0);
  const emailOutbound = rows.reduce((sum, row) => sum + Math.round(row.solved * 0.26), 0);
  const waSent = rows.reduce((sum, row) => sum + Math.round(row.created * 0.38), 0);
  const waDelivered = Math.round(waSent * 0.94);
  const waRead = Math.round(waDelivered * 0.83);
  const waFailed = Math.max(0, waSent - waDelivered);
  const voiceOutbound = rows.reduce((sum, row) => sum + Math.round(row.created * 0.12), 0);
  const voiceInbound = rows.reduce((sum, row) => sum + Math.round(row.created * 0.08), 0);
  const voiceCompleted = Math.round(voiceOutbound * 0.74);
  const voiceFailed = Math.round(voiceOutbound * 0.12);
  const voiceNoAnswer = Math.round(voiceOutbound * 0.08);
  const voiceBusy = Math.round(voiceOutbound * 0.03);
  const voiceCanceled = Math.max(
    0,
    voiceOutbound - voiceCompleted - voiceFailed - voiceNoAnswer - voiceBusy
  );
  const pendingReviews = getState().mergeReviews.filter((review) => review.status === "pending").length;
  const rejectedReviews = getState().mergeReviews.filter((review) => review.status === "rejected").length;
  const failedReviews = getState().mergeReviews.filter((review) => review.status === "failed").length;
  return {
    totalTickets,
    openTickets,
    ticketsCreatedToday: rows[rows.length - 1]?.created ?? 0,
    ticketsSolvedToday: rows[rows.length - 1]?.solved ?? 0,
    avgFirstResponseSeconds,
    avgResolutionSeconds,
    channels: {
      email: { inbound: emailInbound, outbound: emailOutbound },
      whatsapp: {
        inbound: Math.round(waSent * 0.49),
        outbound: Math.round(waSent * 0.51),
        sent: waSent,
        delivered: waDelivered,
        read: waRead,
        failed: waFailed
      },
      voice: {
        inbound: voiceInbound,
        outbound: voiceOutbound,
        completed: voiceCompleted,
        failed: voiceFailed,
        noAnswer: voiceNoAnswer,
        busy: voiceBusy,
        canceled: voiceCanceled,
        avgDurationSeconds: 226
      }
    },
    merges: {
      ticketMerges: 24,
      customerMerges: 11,
      actorSplit: {
        aiInitiated: 22,
        humanInitiated: 13
      },
      reviews: {
        pending: pendingReviews,
        rejectedInRange: rejectedReviews,
        failedInRange: failedReviews,
        topFailureReasons: [
          { reason: "assignment_conflict", count: 3 },
          { reason: "missing_identity_evidence", count: 2 },
          { reason: "workflow_lock", count: 2 }
        ]
      }
    }
  };
}

function buildVolume(url: URL): VolumeResponse {
  const rows = analyticsRowsForRange(url);
  const whatsAppSource = (url.searchParams.get("whatsappSource") ?? "all") as
    | "all"
    | "webhook"
    | "outbox";
  return {
    created: rows.map((row) => ({ day: row.day, count: row.created })),
    solved: rows.map((row) => ({ day: row.day, count: row.solved })),
    email: rows.map((row) => ({
      day: row.day,
      inbound: Math.round(row.created * 0.4),
      outbound: Math.round(row.solved * 0.26)
    })),
    voice: rows.map((row) => {
      const outbound = Math.round(row.created * 0.12);
      const completed = Math.round(outbound * 0.74);
      const failed = Math.round(outbound * 0.12);
      const noAnswer = Math.round(outbound * 0.08);
      const busy = Math.round(outbound * 0.03);
      const canceled = Math.max(0, outbound - completed - failed - noAnswer - busy);
      return {
        day: row.day,
        inbound: Math.round(row.created * 0.08),
        outbound,
        completed,
        failed,
        noAnswer,
        busy,
        canceled,
        avgDurationSeconds: 210 + (Date.parse(`${row.day}T00:00:00Z`) % 40)
      };
    }),
    whatsappSource: whatsAppSource,
    whatsapp: {
      sent: rows.map((row) => ({ day: row.day, count: Math.round(row.created * 0.38) })),
      delivered: rows.map((row) => ({ day: row.day, count: Math.round(row.created * 0.36) })),
      read: rows.map((row) => ({ day: row.day, count: Math.round(row.created * 0.29) })),
      failed: rows.map((row) => ({ day: row.day, count: Math.max(1, Math.round(row.created * 0.02)) }))
    }
  };
}

function buildSla(url: URL): SlaResponse {
  const rows = analyticsRowsForRange(url);
  const total = rows.reduce((sum, row) => sum + row.created, 0);
  const firstResponseRate =
    rows.reduce((sum, row) => sum + row.satisfaction, 0) / Math.max(rows.length, 1) / 5;
  const resolutionRate = Math.min(0.98, firstResponseRate + 0.06);
  return {
    firstResponse: {
      total,
      compliant: Math.round(total * firstResponseRate),
      complianceRate: Number(firstResponseRate.toFixed(3))
    },
    resolution: {
      total,
      compliant: Math.round(total * resolutionRate),
      complianceRate: Number(resolutionRate.toFixed(3))
    }
  };
}

function buildPerformance(url: URL, groupBy: "agent" | "priority" | "tag"): PerformanceResponse {
  const queryAgentId = url.searchParams.get("agentId");
  const queryPriority = url.searchParams.get("priority");
  const queryTag = url.searchParams.get("tag");
  let rows: PerformanceRow[];
  if (groupBy === "agent") {
    rows = [
      { key: "user-sarah", label: "Sarah Chen", total: 412, open: 36, solved: 376, avg_first_response_seconds: 38 * 60, avg_resolution_seconds: Math.round(16.2 * 3600) },
      { key: "user-marcus", label: "Marcus Reid", total: 389, open: 41, solved: 348, avg_first_response_seconds: 42 * 60, avg_resolution_seconds: Math.round(17.8 * 3600) },
      { key: "user-elena", label: "Elena Rodriguez", total: 356, open: 29, solved: 327, avg_first_response_seconds: 45 * 60, avg_resolution_seconds: Math.round(18.5 * 3600) },
      { key: "user-james", label: "James Park", total: 334, open: 27, solved: 307, avg_first_response_seconds: 48 * 60, avg_resolution_seconds: Math.round(19.2 * 3600) },
      { key: "user-lisa", label: "Lisa Wang", total: 301, open: 24, solved: 277, avg_first_response_seconds: 46 * 60, avg_resolution_seconds: Math.round(18.9 * 3600) }
    ];
  } else if (groupBy === "priority") {
    rows = [
      { key: "urgent", label: "urgent", total: 92, open: 18, solved: 74, avg_first_response_seconds: 12 * 60, avg_resolution_seconds: Math.round(2.5 * 3600) },
      { key: "high", label: "high", total: 369, open: 54, solved: 315, avg_first_response_seconds: 26 * 60, avg_resolution_seconds: Math.round(8.2 * 3600) },
      { key: "normal", label: "medium", total: 1108, open: 145, solved: 963, avg_first_response_seconds: 45 * 60, avg_resolution_seconds: Math.round(18.5 * 3600) },
      { key: "low", label: "low", total: 277, open: 29, solved: 248, avg_first_response_seconds: 74 * 60, avg_resolution_seconds: Math.round(48.3 * 3600) }
    ];
  } else {
    rows = [
      { key: "billing", label: "billing", total: 423, open: 54, solved: 369, avg_first_response_seconds: 33 * 60, avg_resolution_seconds: Math.round(9.6 * 3600) },
      { key: "bug", label: "bug", total: 385, open: 63, solved: 322, avg_first_response_seconds: 24 * 60, avg_resolution_seconds: Math.round(7.8 * 3600) },
      { key: "feature-request", label: "feature-request", total: 312, open: 84, solved: 228, avg_first_response_seconds: 52 * 60, avg_resolution_seconds: Math.round(22.1 * 3600) },
      { key: "integration", label: "integration", total: 278, open: 42, solved: 236, avg_first_response_seconds: 41 * 60, avg_resolution_seconds: Math.round(16.2 * 3600) },
      { key: "dashboard", label: "dashboard", total: 245, open: 31, solved: 214, avg_first_response_seconds: 19 * 60, avg_resolution_seconds: Math.round(5.9 * 3600) },
      { key: "api", label: "api", total: 204, open: 28, solved: 176, avg_first_response_seconds: 36 * 60, avg_resolution_seconds: Math.round(12.5 * 3600) }
    ];
  }
  if (queryAgentId && groupBy !== "agent") {
    rows = rows.map((row) => ({
      ...row,
      total: Math.round(row.total * 0.64),
      open: Math.round(row.open * 0.5),
      solved: Math.round(row.solved * 0.66)
    }));
  }
  if (queryPriority && groupBy !== "priority") {
    rows = rows.map((row) => ({
      ...row,
      total: Math.round(row.total * 0.58),
      open: Math.round(row.open * 0.58),
      solved: Math.round(row.solved * 0.58)
    }));
  }
  if (queryTag && groupBy !== "tag") {
    rows = rows.map((row) => ({
      ...row,
      total: Math.round(row.total * 0.62),
      open: Math.round(row.open * 0.62),
      solved: Math.round(row.solved * 0.62)
    }));
  }
  return { rows };
}

function buildProfileLookupMetrics(days: number): ProfileLookupMetrics {
  const series = getState().profileLookupSeries.slice(
    -Math.max(1, Math.min(days, getState().profileLookupSeries.length))
  );
  const summary = series.reduce(
    (acc, row) => {
      acc.total += row.matched + row.missed + row.errored + row.disabled;
      acc.matched += row.matched;
      acc.matchedLive += row.matchedLive;
      acc.matchedCache += row.matchedCache;
      acc.matchedOther += row.matchedOther;
      acc.missed += row.missed;
      acc.errored += row.errored;
      acc.disabled += row.disabled;
      return acc;
    },
    {
      total: 0,
      matched: 0,
      matchedLive: 0,
      matchedCache: 0,
      matchedOther: 0,
      missed: 0,
      errored: 0,
      disabled: 0
    }
  );
  return {
    generatedAt: DEMO_NOW,
    windowDays: days,
    configuredTimeoutMs: 1200,
    summary: {
      ...summary,
      timeoutErrors: Math.round(summary.errored * 0.4),
      hitRate: summary.total > 0 ? summary.matched / summary.total : 0,
      liveHitRate: summary.total > 0 ? summary.matchedLive / summary.total : 0,
      cacheHitRate: summary.total > 0 ? summary.matchedCache / summary.total : 0,
      fallbackHitRate: summary.total > 0 ? summary.matchedOther / summary.total : 0,
      missRate: summary.total > 0 ? summary.missed / summary.total : 0,
      errorRate: summary.total > 0 ? summary.errored / summary.total : 0,
      timeoutErrorRate: summary.total > 0 ? Math.round(summary.errored * 0.4) / summary.total : 0,
      avgDurationMs: 244,
      p95DurationMs: 790
    },
    series
  };
}

function buildDeadLetterSummary(): DeadLetterSummary {
  const deadLetters = getState().deadLetters;
  const byStatus = {
    failed: deadLetters.filter((item) => item.status === "failed").length,
    poison: deadLetters.filter((item) => item.status === "poison").length,
    quarantined: deadLetters.filter((item) => item.status === "quarantined").length
  };
  const codeMap = new Map<string, number>();
  for (const item of deadLetters) {
    const code = item.last_error_code ?? "unknown";
    codeMap.set(code, (codeMap.get(code) ?? 0) + 1);
  }
  const oldest =
    [...deadLetters].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))[0] ??
    null;
  return {
    total: deadLetters.length,
    byStatus,
    byErrorCode: Array.from(codeMap.entries()).map(([code, count]) => ({ code, count })),
    oldestEvent: oldest
      ? {
          id: oldest.id,
          createdAt: oldest.created_at,
          age_minutes: Math.round((Date.parse(DEMO_NOW) - Date.parse(oldest.created_at)) / 60000)
        }
      : null
  };
}

function buildSpamMessages(limit: number): SpamMessageRecord[] {
  const state = getState();
  return state.messages
    .filter((message) => message.mailboxId && message.isSpam)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit)
    .map((message) => ({
      id: message.id,
      subject: message.subject,
      from_email: message.from,
      received_at: message.receivedAt,
      spam_reason: message.spamReason,
      mailbox_address:
        state.mailboxes.find((mailbox) => mailbox.id === message.mailboxId)?.address ??
        DEFAULT_MAILBOX_ADDRESS
    }));
}

function buildCallOptions(ticketId: string): TicketCallOptions {
  const customer = findCustomerByTicket(ticketId);
  const ticket = getTicketById(ticketId);
  const candidates = [
    customer?.primary_phone
      ? {
          candidateId: `${ticketId}-primary`,
          phone: customer.primary_phone,
          label: "Primary phone",
          source: "customer_primary" as const,
          isPrimary: true
        }
      : null,
    ...(customer?.identities ?? [])
      .filter((identity) => identity.type === "phone" && identity.value !== customer?.primary_phone)
      .map((identity, index) => ({
        candidateId: `${ticketId}-identity-${index + 1}`,
        phone: identity.value,
        label: identity.isPrimary ? "Customer phone" : `Customer phone ${index + 1}`,
        source: "customer_identity" as const,
        isPrimary: Boolean(identity.isPrimary)
      })),
    typeof ticket.metadata?.secondary_phone === "string"
      ? {
          candidateId: `${ticketId}-metadata-secondary`,
          phone: String(ticket.metadata.secondary_phone),
          label: "Secondary phone from metadata",
          source: "ticket_metadata" as const,
          isPrimary: false
        }
      : null
  ].filter(Boolean);
  return {
    ticketId,
    selectionRequired: candidates.length > 1,
    defaultCandidateId: candidates[0]?.candidateId ?? null,
    canManualDial: true,
    candidates: candidates as TicketCallOptions["candidates"],
    consent: {
      allowed: true,
      status: "granted",
      reason: null,
      updatedAt: "2026-03-01T08:00:00Z",
      source: "customer_profile"
    }
  };
}

function parsePathname(pathname: string) {
  return pathname.split("/").filter(Boolean);
}

function isMailboxThreadMessage(message: InternalMessage, mailboxId: string) {
  return message.mailboxId === mailboxId;
}

function resolveMailboxes() {
  return getState().mailboxes;
}

function handleGet(url: URL) {
  const parts = parsePathname(url.pathname);
  const state = getState();

  if (url.pathname === "/api/auth/me") return { user: state.currentUser };
  if (url.pathname === "/api/admin/roles") return { roles: state.roles };
  if (url.pathname === "/api/admin/users") return { users: state.users };
  if (url.pathname === "/api/admin/sla") return state.sla;
  if (url.pathname === "/api/admin/security") return state.security;
  if (url.pathname === "/api/support/tags") return { tags: state.tags };
  if (url.pathname === "/api/admin/spam-rules") return { rules: state.spamRules };
  if (url.pathname === "/api/admin/spam-messages") {
    return { messages: buildSpamMessages(Number(url.searchParams.get("limit") ?? 25)) };
  }
  if (url.pathname === "/api/admin/whatsapp") return { account: state.whatsAppAccount };
  if (url.pathname === "/api/admin/whatsapp/templates") return { templates: state.whatsAppTemplates };
  if (url.pathname === "/api/admin/whatsapp/outbox") return state.whatsAppOutbox;
  if (url.pathname === "/api/admin/agents") return { agents: state.agents };
  if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "agents" && parts[4] === "outbox") {
    return (
      state.agentOutboxes[parts[3]] ?? {
        integrationId: parts[3],
        integrationStatus: "paused",
        throughput: { configuredMaxEventsPerRun: null, effectiveLimit: 25 },
        queue: {
          pending: 0,
          dueNow: 0,
          processing: 0,
          failed: 0,
          deliveredTotal: 0,
          delivered24h: 0,
          nextAttemptAt: null,
          lastDeliveredAt: null,
          lastFailedAt: null,
          lastError: null
        }
      }
    );
  }
  if (url.pathname === "/api/admin/profile-lookup/metrics") {
    return buildProfileLookupMetrics(Number(url.searchParams.get("days") ?? 14));
  }
  if (url.pathname === "/api/admin/inbound/metrics") {
    const hours = Number(url.searchParams.get("hours") ?? state.inboundMetrics.windowHours);
    return { ...state.inboundMetrics, windowHours: hours };
  }
  if (url.pathname === "/api/admin/inbound/failed") {
    return { events: state.failedInboundEvents.slice(0, Number(url.searchParams.get("limit") ?? 30)) };
  }
  if (url.pathname === "/api/admin/inbound/settings") return { config: state.inboundSettings };
  if (url.pathname === "/api/admin/calls/outbox") return state.callOutbox;
  if (url.pathname === "/api/admin/calls/failed") {
    return { events: state.failedCallEvents.slice(0, Number(url.searchParams.get("limit") ?? 30)) };
  }
  if (url.pathname === "/api/admin/calls/rejections") {
    const limit = Number(url.searchParams.get("limit") ?? 30);
    return {
      ...state.callRejections,
      windowHours: Number(url.searchParams.get("hours") ?? state.callRejections.windowHours),
      recent: state.callRejections.recent.slice(0, limit)
    };
  }
  if (url.pathname === "/api/admin/calls/dead-letter") {
    const action = url.searchParams.get("action");
    if (action === "summary") {
      return { status: "ok", action: "summary", summary: buildDeadLetterSummary() };
    }
    const status = (url.searchParams.get("status") ?? "all") as "all" | "failed" | "poison" | "quarantined";
    const limit = Number(url.searchParams.get("limit") ?? 25);
    const events = state.deadLetters
      .filter((event) => (status === "all" ? true : event.status === status))
      .slice(0, limit);
    return { status: "ok", action: "list", events };
  }
  if (url.pathname === "/api/admin/audit-logs") {
    return { logs: state.auditLogs.slice(0, Number(url.searchParams.get("limit") ?? 50)) };
  }
  if (url.pathname === "/api/tickets") return { tickets: filterTickets(url).map(toApiTicket) };
  if (parts[0] === "api" && parts[1] === "tickets" && parts.length === 3) return buildTicketDetails(parts[2]);
  if (parts[0] === "api" && parts[1] === "tickets" && parts[3] === "customer-history") {
    return getTicketHistory(parts[2]);
  }
  if (parts[0] === "api" && parts[1] === "tickets" && parts[3] === "call-options") {
    return buildCallOptions(parts[2]);
  }
  if (url.pathname === "/api/support/macros") return { macros: state.supportMacros };
  if (url.pathname === "/api/support/saved-views") return { views: state.supportSavedViews };
  if (url.pathname === "/api/whatsapp/templates") {
    return { templates: state.whatsAppTemplates.filter((template) => template.status === "active") };
  }
  if (url.pathname === "/api/mailboxes") return { mailboxes: resolveMailboxes() };
  if (parts[0] === "api" && parts[1] === "mailboxes" && parts[3] === "messages") {
    return {
      messages: state.messages
        .filter((message) => isMailboxThreadMessage(message, parts[2]))
        .sort(
          (left, right) =>
            Date.parse(right.sentAt ?? right.receivedAt ?? right.createdAt) -
            Date.parse(left.sentAt ?? left.receivedAt ?? left.createdAt)
        )
        .map(toApiMailboxMessage)
    };
  }
  if (parts[0] === "api" && parts[1] === "messages" && parts.length === 3) {
    return toApiMessageDetail(getMessageById(parts[2]));
  }
  if (url.pathname === "/api/analytics/overview") return buildOverview(url);
  if (url.pathname === "/api/analytics/volume") return buildVolume(url);
  if (url.pathname === "/api/analytics/sla") return buildSla(url);
  if (url.pathname === "/api/analytics/performance") {
    const groupBy = (url.searchParams.get("groupBy") ?? "agent") as "agent" | "priority" | "tag";
    return buildPerformance(url, groupBy);
  }
  if (url.pathname === "/api/merge-reviews") {
    const status = (url.searchParams.get("status") ?? "pending") as MergeReviewStatus;
    const query = url.searchParams.get("q")?.toLowerCase() ?? "";
    const assigned = url.searchParams.get("assigned");
    const limit = Number(url.searchParams.get("limit") ?? 100);
    return {
      reviews: state.mergeReviews
        .filter((review) => (status === "all" ? true : review.status === status))
        .filter((review) => {
          if (!query) return true;
          const haystack = [
            review.id,
            review.reason ?? "",
            review.context_ticket_subject ?? "",
            review.context_ticket_requester_email ?? "",
            review.source_customer_display_name ?? "",
            review.target_customer_display_name ?? ""
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
        .filter((review) =>
          assigned === "mine"
            ? review.proposed_by_user_id === state.currentUser.id ||
              review.reviewed_by_user_id === state.currentUser.id ||
              review.proposed_by_agent_id === "agent-1"
            : true
        )
        .slice(0, limit)
    };
  }

  throw new Error(`No demo mock route for GET ${url.pathname}`);
}

function handlePost(url: URL, init?: RequestInit) {
  const state = getState();
  const parts = parsePathname(url.pathname);

  if (url.pathname === "/api/admin/users") {
    const body = parseJsonBody<{ email: string; displayName: string; password: string; roleId: string }>(init);
    const role = state.roles.find((entry) => entry.id === body.roleId) ?? state.roles[1];
    const user: AdminUserRecord = {
      id: titleToId("user", body.email || `new-${state.users.length + 1}`),
      email: body.email,
      display_name: body.displayName,
      is_active: true,
      created_at: DEMO_NOW,
      role_id: role.id,
      role_name: role.name
    };
    state.users.unshift(user);
    appendAuditLog({
      action: "user_created",
      entity_type: "user",
      entity_id: user.id,
      data: { email: user.email },
      actor_name: state.currentUser.display_name,
      actor_email: state.currentUser.email
    });
    return { status: "created", user };
  }
  if (url.pathname === "/api/admin/sla") {
    const body = parseJsonBody<SlaConfig>(init);
    state.sla = {
      firstResponseMinutes: Number(body.firstResponseMinutes ?? 120),
      resolutionMinutes: Number(body.resolutionMinutes ?? 1440)
    };
    appendAuditLog({
      action: "sla_updated",
      entity_type: "sla",
      entity_id: "default",
      data: state.sla,
      actor_name: state.currentUser.display_name,
      actor_email: state.currentUser.email
    });
    return state.sla;
  }
  if (url.pathname === "/api/support/tags") {
    const body = parseJsonBody<{ name: string; description?: string | null }>(init);
    const tag: TagRecord = {
      id: titleToId("tag", body.name),
      name: body.name.trim().toLowerCase(),
      description: body.description ?? null
    };
    state.tags.unshift(tag);
    return { tag };
  }
  if (url.pathname === "/api/admin/spam-rules") {
    const body = parseJsonBody<{
      ruleType: "allow" | "block";
      scope: "sender" | "domain" | "subject" | "body";
      pattern: string;
    }>(init);
    const rule: SpamRuleRecord = {
      id: `rule-${state.spamRules.length + 1}`,
      rule_type: body.ruleType,
      scope: body.scope,
      pattern: body.pattern,
      is_active: true,
      created_at: DEMO_NOW
    };
    state.spamRules.unshift(rule);
    return { rule };
  }
  if (url.pathname === "/api/admin/whatsapp") {
    const body = parseJsonBody<{
      provider: string;
      phoneNumber: string;
      wabaId?: string | null;
      accessToken?: string | null;
      verifyToken?: string | null;
      status?: "active" | "paused" | "inactive";
    }>(init);
    state.whatsAppAccount = {
      id: state.whatsAppAccount?.id ?? "wa-account-1",
      provider: body.provider,
      phoneNumber: body.phoneNumber,
      wabaId: body.wabaId ?? null,
      accessToken: body.accessToken ?? state.whatsAppAccount?.accessToken ?? "",
      verifyToken: body.verifyToken ?? state.whatsAppAccount?.verifyToken ?? "",
      status: body.status ?? "active",
      createdAt: state.whatsAppAccount?.createdAt ?? DEMO_NOW,
      updatedAt: DEMO_NOW
    };
    state.whatsAppOutbox.account = {
      id: state.whatsAppAccount.id,
      provider: state.whatsAppAccount.provider,
      phoneNumber: state.whatsAppAccount.phoneNumber,
      status: state.whatsAppAccount.status,
      updatedAt: DEMO_NOW
    };
    return { status: "saved", id: state.whatsAppAccount.id };
  }
  if (url.pathname === "/api/admin/whatsapp/templates") {
    const body = parseJsonBody<{
      provider?: string;
      name: string;
      language?: string;
      category?: string | null;
      status?: "active" | "paused";
      components?: Array<Record<string, unknown>> | null;
    }>(init);
    const template: WhatsAppTemplate = {
      id: `wa-template-${state.whatsAppTemplates.length + 1}`,
      provider: body.provider ?? "meta",
      name: body.name,
      language: body.language ?? "en_US",
      category: body.category ?? null,
      status: body.status ?? "active",
      components: body.components ?? null
    };
    state.whatsAppTemplates.unshift(template);
    return { template };
  }
  if (url.pathname === "/api/admin/whatsapp/outbox") {
    state.whatsAppOutbox.queue.sent24h += 3;
    state.whatsAppOutbox.queue.sentTotal += 3;
    state.whatsAppOutbox.queue.queued = Math.max(0, state.whatsAppOutbox.queue.queued - 3);
    state.whatsAppOutbox.queue.dueNow = Math.max(0, state.whatsAppOutbox.queue.dueNow - 2);
    state.whatsAppOutbox.queue.failed = Math.max(0, state.whatsAppOutbox.queue.failed - 1);
    state.whatsAppOutbox.queue.lastSentAt = DEMO_NOW;
    return { status: "processed", delivered: 3, skipped: 1 };
  }
  if (url.pathname === "/api/admin/agents") {
    const body = parseJsonBody<{
      name: string;
      provider?: string;
      baseUrl: string;
      authType?: string;
      sharedSecret: string;
      status?: "active" | "paused";
      policyMode?: "draft_only" | "auto_send";
      scopes?: Record<string, unknown>;
      capabilities?: Record<string, unknown>;
      policy?: Record<string, unknown>;
    }>(init);
    const agent: AgentIntegration = {
      id: `agent-${state.agents.length + 1}`,
      name: body.name,
      provider: body.provider ?? "openai",
      base_url: body.baseUrl,
      auth_type: body.authType ?? "hmac",
      shared_secret: body.sharedSecret,
      status: body.status ?? "active",
      policy_mode: body.policyMode ?? "draft_only",
      scopes: body.scopes ?? {},
      capabilities: body.capabilities ?? {},
      policy: body.policy ?? {},
      created_at: DEMO_NOW,
      updated_at: DEMO_NOW
    };
    state.agents.unshift(agent);
    state.agentOutboxes[agent.id] = {
      integrationId: agent.id,
      integrationStatus: agent.status,
      throughput: {
        configuredMaxEventsPerRun: Number(agent.capabilities?.max_events_per_run ?? 25),
        effectiveLimit: Number(agent.capabilities?.max_events_per_run ?? 25)
      },
      queue: {
        pending: 0,
        dueNow: 0,
        processing: 0,
        failed: 0,
        deliveredTotal: 0,
        delivered24h: 0,
        nextAttemptAt: null,
        lastDeliveredAt: null,
        lastFailedAt: null,
        lastError: null
      }
    };
    return { status: "created", agent };
  }
  if (
    parts[0] === "api" &&
    parts[1] === "admin" &&
    parts[2] === "agents" &&
    parts[4] === "outbox" &&
    parts[5] === "deliver"
  ) {
    const agentOutbox = state.agentOutboxes[parts[3]];
    if (agentOutbox) {
      const delivered = Math.min(Number(url.searchParams.get("limit") ?? 25), Math.max(1, agentOutbox.queue.dueNow));
      agentOutbox.queue.pending = Math.max(0, agentOutbox.queue.pending - delivered);
      agentOutbox.queue.dueNow = Math.max(0, agentOutbox.queue.dueNow - delivered);
      agentOutbox.queue.deliveredTotal += delivered;
      agentOutbox.queue.delivered24h += delivered;
      agentOutbox.queue.lastDeliveredAt = DEMO_NOW;
      return { status: "delivered", delivered, skipped: 0, limitUsed: delivered };
    }
    return { status: "delivered", delivered: 0, skipped: 0, limitUsed: 0 };
  }
  if (url.pathname === "/api/admin/inbound/settings") {
    const body = parseJsonBody<{
      webhookUrl: string;
      threshold: number;
      windowMinutes: number;
      cooldownMinutes: number;
    }>(init);
    state.inboundSettings = {
      ...state.inboundSettings,
      webhookUrl: body.webhookUrl,
      threshold: Number(body.threshold),
      windowMinutes: Number(body.windowMinutes),
      cooldownMinutes: Number(body.cooldownMinutes),
      updatedAt: DEMO_NOW
    };
    return { status: "saved", config: state.inboundSettings };
  }
  if (url.pathname === "/api/admin/inbound/retry") {
    const body = parseJsonBody<{ eventIds?: string[] }>(init);
    const requestedIds = body.eventIds?.length
      ? body.eventIds
      : state.failedInboundEvents
          .slice(0, Number(url.searchParams.get("limit") ?? 10))
          .map((event) => event.id);
    state.failedInboundEvents = state.failedInboundEvents.filter(
      (event) => !requestedIds.includes(event.id)
    );
    state.inboundMetrics.summary.failedQueue = state.failedInboundEvents.length;
    return {
      status: "queued",
      requested: requestedIds.length,
      retried: requestedIds.length,
      failed: 0,
      ids: requestedIds
    };
  }
  if (url.pathname === "/api/admin/inbound/alerts") {
    return { status: "checked", sent: false, reason: "below_threshold" };
  }
  if (url.pathname === "/api/admin/calls/outbox") {
    const delivered = Math.min(Number(url.searchParams.get("limit") ?? 25), Math.max(1, state.callOutbox.queue.dueNow));
    state.callOutbox.queue.queued = Math.max(0, state.callOutbox.queue.queued - delivered);
    state.callOutbox.queue.dueNow = Math.max(0, state.callOutbox.queue.dueNow - delivered);
    state.callOutbox.queue.sentTotal += delivered;
    state.callOutbox.queue.sent24h += delivered;
    state.callOutbox.queue.lastSentAt = DEMO_NOW;
    return { status: "processed", delivered, skipped: 0, provider: state.callOutbox.provider };
  }
  if (url.pathname === "/api/admin/calls/retry") {
    const body = parseJsonBody<{ eventIds?: string[] }>(init);
    const requestedIds = body.eventIds?.length
      ? body.eventIds
      : state.failedCallEvents
          .slice(0, Number(url.searchParams.get("limit") ?? 25))
          .map((event) => event.id);
    state.failedCallEvents = state.failedCallEvents.filter((event) => !requestedIds.includes(event.id));
    return { status: "queued", requested: requestedIds.length, retried: requestedIds.length, ids: requestedIds };
  }
  if (url.pathname === "/api/admin/calls/dead-letter") {
    const body = parseJsonBody<{ action?: string; eventIds?: string[]; filter?: { status?: string } }>(init);
    const recoverable = body.eventIds?.length
      ? state.deadLetters.filter((event) => body.eventIds?.includes(event.id))
      : state.deadLetters.filter((event) => (body.filter?.status ? event.status === body.filter.status : true));
    state.deadLetters = state.deadLetters.filter(
      (event) => !recoverable.some((candidate) => candidate.id === event.id)
    );
    return {
      status: "ok",
      action: body.action ?? "recover",
      recoveredCount: recoverable.length,
      message: `${recoverable.length} events recovered`
    };
  }
  if (url.pathname === "/api/tickets/create") {
    const body = parseJsonBody<CreateTicketInput>(init);
    const ticketId = `TKT-${state.nextTicketNumber++}`;
    const isVoice = body.contactMode === "call";
    const isWhatsApp = body.contactMode === "whatsapp";
    const customerId = `cust-${ticketId.toLowerCase()}`;
    state.customers[customerId] = {
      id: customerId,
      kind: "unregistered",
      external_system: null,
      external_user_id: null,
      display_name: body.to ?? body.toPhone ?? "New Contact",
      primary_email: isWhatsApp ? null : body.to ?? null,
      primary_phone: body.toPhone ?? null,
      address: null,
      merged_into_customer_id: null,
      merged_at: null,
      identities: [
        ...(body.to ? [{ type: "email" as const, value: body.to, isPrimary: true }] : []),
        ...(body.toPhone ? [{ type: "phone" as const, value: body.toPhone, isPrimary: true }] : [])
      ]
    };
    const ticket = createTicket({
      id: ticketId,
      requester_email: isWhatsApp
        ? `whatsapp:${body.toPhone ?? "unknown"}`
        : body.to ?? body.toPhone ?? "unknown@example.com",
      requesterName: body.to ?? body.toPhone ?? "New Contact",
      requesterPhone: body.toPhone ?? null,
      customerId,
      subject: body.subject,
      category: body.category ?? "general",
      metadata: body.metadata ?? {},
      tags: body.tags ?? [],
      has_whatsapp: isWhatsApp,
      has_voice: isVoice,
      status: "open",
      priority: "normal",
      assigned_user_id: state.currentUser.id,
      created_at: DEMO_NOW,
      updated_at: DEMO_NOW,
      preview: trimPreview(body.description ?? body.subject) ?? body.subject,
      unread: false,
      archived: false
    });
    state.tickets.unshift(ticket);
    let messageId: string | null = null;
    let callSessionId: string | undefined;
    if (isVoice) {
      const message = createMailboxMessage(state, {
        ticketId,
        mailboxId: null,
        threadId: `ticket-thread-${ticketId.toLowerCase()}`,
        direction: "outbound",
        channel: "voice",
        from: DEFAULT_WHATSAPP_NUMBER,
        to: [body.toPhone ?? ""],
        text: body.description ?? body.subject,
        sentAt: DEMO_NOW,
        callSession: { status: "queued", durationSeconds: null, recordingUrl: null },
        statusEvents: [{ status: "queued" }]
      });
      messageId = message.id;
      callSessionId = `call-session-${ticketId.toLowerCase()}`;
    } else if (isWhatsApp) {
      const message = createMailboxMessage(state, {
        ticketId,
        mailboxId: DEFAULT_MAILBOX_ID,
        threadId: `ticket-thread-${ticketId.toLowerCase()}`,
        direction: "outbound",
        channel: "whatsapp",
        from: DEFAULT_WHATSAPP_NUMBER,
        to: [body.toPhone ?? ""],
        subject: body.subject,
        text: body.description ?? body.subject,
        sentAt: DEMO_NOW,
        waStatus: "queued",
        attachments: (body.attachments ?? []).slice(0, 1).map((attachment, index) =>
          createAttachment(
            `${ticketId}-att-${index + 1}`,
            attachment.filename,
            attachment.contentType ?? "application/octet-stream",
            1024
          )
        ),
        statusEvents: [{ status: "queued" }]
      });
      messageId = message.id;
    } else {
      const message = createMailboxMessage(state, {
        ticketId,
        mailboxId: DEFAULT_MAILBOX_ID,
        threadId: `ticket-thread-${ticketId.toLowerCase()}`,
        direction: "outbound",
        channel: "email",
        from: DEFAULT_MAILBOX_ADDRESS,
        to: [body.to ?? ""],
        subject: body.subject,
        text: body.description ?? body.subject,
        sentAt: DEMO_NOW,
        attachments: (body.attachments ?? []).map((attachment, index) =>
          createAttachment(
            `${ticketId}-att-${index + 1}`,
            attachment.filename,
            attachment.contentType ?? "application/octet-stream",
            1024
          )
        )
      });
      messageId = message.id;
    }
    appendTicketEvent(ticketId, {
      event_type: "status_updated",
      actor_user_id: state.currentUser.id,
      data: { to: "open" }
    });
    appendAuditLog({
      action: "ticket_created",
      entity_type: "ticket",
      entity_id: ticketId,
      data: { channel: isVoice ? "voice" : isWhatsApp ? "whatsapp" : "email" },
      actor_name: state.currentUser.display_name,
      actor_email: state.currentUser.email
    });
    return isVoice
      ? ({
          status: "created",
          ticketId,
          messageId: messageId!,
          callSessionId: callSessionId!,
          channel: "voice"
        } satisfies CreateTicketSuccessResponse)
      : isWhatsApp
        ? ({
            status: "created",
            ticketId,
            messageId,
            channel: "whatsapp"
          } satisfies CreateTicketSuccessResponse)
      : ({
          status: "created",
          ticketId,
          messageId,
          channel: "email"
        } satisfies CreateTicketSuccessResponse);
  }
  if (parts[0] === "api" && parts[1] === "tickets" && parts[3] === "replies") {
    const body = parseJsonBody<{
      text?: string | null;
      recipient?: string | null;
      template?: { name: string; language: string; components?: Array<Record<string, unknown>> } | null;
      attachments?: Array<{
        filename: string;
        contentType?: string | null;
        size?: number | null;
        contentBase64: string;
      }> | null;
    }>(init);
    const ticket = getTicketById(parts[2]);
    const recipient = body.recipient ?? findCustomerByTicket(ticket.id)?.primary_email ?? ticket.requester_email;
    const channel = recipient.includes("@") && !body.template ? "email" : "whatsapp";
    const message = createMailboxMessage(state, {
      ticketId: ticket.id,
      mailboxId: channel === "email" ? DEFAULT_MAILBOX_ID : null,
      threadId: `ticket-thread-${ticket.id.toLowerCase()}`,
      direction: "outbound",
      channel,
      from: channel === "email" ? state.currentUser.email : DEFAULT_WHATSAPP_NUMBER,
      to: [recipient],
      subject: channel === "email" ? `Re: ${ticket.subject ?? "Support update"}` : null,
      text: body.text ?? (body.template ? `Template sent: ${body.template.name}` : ""),
      sentAt: DEMO_NOW,
      attachments: (body.attachments ?? []).map((attachment, index) =>
        createAttachment(
          `${ticket.id}-reply-att-${index + 1}`,
          attachment.filename,
          attachment.contentType ?? "application/octet-stream",
          attachment.size ?? 1024
        )
      ),
      waStatus: channel === "whatsapp" ? "sent" : null,
      aiMeta: body.template ? { template_name: body.template.name, template: true } : null
    });
    touchTicket(ticket.id);
    appendAuditLog({
      action: "ticket_reply_sent",
      entity_type: "ticket",
      entity_id: ticket.id,
      data: { messageId: message.id, channel },
      actor_name: state.currentUser.display_name,
      actor_email: state.currentUser.email
    });
    return { status: "sent" };
  }
  if (url.pathname === "/api/calls/outbound") {
    const body = parseJsonBody<{ ticketId: string; candidateId?: string | null; toPhone?: string | null; reason: string }>(
      init
    );
    const options = buildCallOptions(body.ticketId);
    if (!body.toPhone && !body.candidateId && options.selectionRequired) {
      return {
        status: "selection_required",
        errorCode: "selection_required",
        detail: "Choose which number to dial for this customer.",
        defaultCandidateId: options.defaultCandidateId,
        candidates: options.candidates
      };
    }
    const selectedPhone =
      body.toPhone ??
      options.candidates.find((candidate) => candidate.candidateId === body.candidateId)?.phone ??
      options.candidates[0]?.phone;
    if (!selectedPhone) {
      return { status: "blocked", errorCode: "no_number", detail: "No call destination available." };
    }
    const callSessionId = `call-session-${body.ticketId.toLowerCase()}-${Date.now()}`;
    const message = createMailboxMessage(state, {
      ticketId: body.ticketId,
      mailboxId: null,
      threadId: `ticket-thread-${body.ticketId.toLowerCase()}`,
      direction: "outbound",
      channel: "voice",
      from: DEFAULT_WHATSAPP_NUMBER,
      to: [selectedPhone],
      text: body.reason,
      sentAt: DEMO_NOW,
      callSession: { status: "queued", durationSeconds: null, recordingUrl: null },
      statusEvents: [{ status: "queued" }]
    });
    touchTicket(body.ticketId);
    appendAuditLog({
      action: "outbound_call_queued",
      entity_type: "ticket",
      entity_id: body.ticketId,
      data: { callSessionId, toPhone: selectedPhone },
      actor_name: state.currentUser.display_name,
      actor_email: state.currentUser.email
    });
    return { status: "queued", callSessionId, messageId: message.id, toPhone: selectedPhone, idempotent: false };
  }
  if (url.pathname === "/api/whatsapp/send") {
    const body = parseJsonBody<{
      ticketId?: string | null;
      to: string;
      text?: string;
      template?: { name: string; language: string; components?: Array<Record<string, unknown>> } | null;
    }>(init);
    if (body.ticketId) {
      createMailboxMessage(state, {
        ticketId: body.ticketId,
        mailboxId: null,
        threadId: `ticket-thread-${body.ticketId.toLowerCase()}`,
        direction: "outbound",
        channel: "whatsapp",
        from: DEFAULT_WHATSAPP_NUMBER,
        to: [body.to],
        text: body.text ?? (body.template ? `Template sent: ${body.template.name}` : ""),
        sentAt: DEMO_NOW,
        waStatus: "sent",
        aiMeta: body.template ? { template_name: body.template.name } : null
      });
      touchTicket(body.ticketId);
    }
    return { status: "sent" };
  }
  if (url.pathname === "/api/email/send") {
    const body = parseJsonBody<{
      from: string;
      to: string[];
      subject: string;
      text?: string;
      attachments?: Array<{ filename: string; contentType?: string | null; contentBase64: string }>;
    }>(init);
    const mailbox = state.mailboxes.find((entry) => entry.address === body.from) ?? state.mailboxes[0];
    const normalizedSubject = body.subject.replace(/^re:\s*/i, "").trim().toLowerCase();
    const existingThread = state.messages.find(
      (message) =>
        message.mailboxId === mailbox.id &&
        message.threadId &&
        normalizeAddress(message.subject ?? "") === normalizedSubject
    );
    const threadId =
      existingThread?.threadId ??
      `thread-generated-${state.messages.filter((message) => message.mailboxId === mailbox.id).length + 1}`;
    const message = createMailboxMessage(state, {
      mailboxId: mailbox.id,
      ticketId: null,
      threadId,
      direction: "outbound",
      channel: "email",
      from: body.from,
      to: body.to,
      subject: body.subject,
      text: body.text ?? "",
      sentAt: DEMO_NOW,
      attachments: (body.attachments ?? []).map((attachment, index) =>
        createAttachment(
          `mail-send-${Date.now()}-${index + 1}`,
          attachment.filename,
          attachment.contentType ?? "application/octet-stream",
          1024
        )
      )
    });
    appendAuditLog({
      action: "mail_sent",
      entity_type: "mail_message",
      entity_id: message.id,
      data: { threadId },
      actor_name: state.currentUser.display_name,
      actor_email: state.currentUser.email
    });
    return { status: "sent", messageId: message.id };
  }
  if (url.pathname === "/api/tickets/bulk-email") {
    throw new Error("Bulk email requires Live Data mode. Switch sample data off in Settings to send real customer emails.");
  }
  if (url.pathname === "/api/support/saved-views") {
    const body = parseJsonBody<{ name: string; filters: SupportSavedView["filters"] }>(init);
    const view: SupportSavedView = {
      id: `view-${state.nextSavedViewNumber++}`,
      name: body.name,
      filters: body.filters,
      createdAt: DEMO_NOW,
      updatedAt: DEMO_NOW
    };
    state.supportSavedViews.unshift(view);
    return { view };
  }
  if (url.pathname === "/api/auth/logout") return { status: "ok" };

  throw new Error(`No demo mock route for POST ${url.pathname}`);
}

function handlePatch(url: URL, init?: RequestInit) {
  const state = getState();
  const parts = parsePathname(url.pathname);

  if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "users" && parts.length === 4) {
    const body = parseJsonBody<{ roleId?: string; isActive?: boolean }>(init);
    const user = state.users.find((entry) => entry.id === parts[3]);
    if (!user) throw new Error("User not found");
    if (typeof body.isActive === "boolean") user.is_active = body.isActive;
    if (body.roleId) {
      const role = state.roles.find((entry) => entry.id === body.roleId);
      user.role_id = role?.id ?? user.role_id;
      user.role_name = role?.name ?? user.role_name;
    }
    return { status: "updated", user };
  }
  if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "users" && parts[4] === "password-reset") {
    return {
      status: "created",
      resetLink: `https://example.com/reset-password?token=${parts[3]}-demo-reset`,
      expiresAt: "2026-03-20T08:30:00Z"
    };
  }
  if (parts[0] === "api" && parts[1] === "support" && parts[2] === "tags" && parts.length === 4) {
    const body = parseJsonBody<{ name?: string; description?: string | null }>(init);
    const tag = state.tags.find((entry) => entry.id === parts[3]);
    if (!tag) throw new Error("Tag not found");
    if (body.name) tag.name = body.name.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(body, "description")) tag.description = body.description ?? null;
    return { tag };
  }
  if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "spam-rules" && parts.length === 4) {
    const body = parseJsonBody<{ isActive?: boolean; pattern?: string }>(init);
    const rule = state.spamRules.find((entry) => entry.id === parts[3]);
    if (!rule) throw new Error("Rule not found");
    if (typeof body.isActive === "boolean") rule.is_active = body.isActive;
    if (body.pattern) rule.pattern = body.pattern;
    return { rule };
  }
  if (parts[0] === "api" && parts[1] === "messages" && parts[3] === "spam") {
    const body = parseJsonBody<{ isSpam: boolean; reason?: string | null }>(init);
    const message = getMessageById(parts[2]);
    message.isSpam = body.isSpam;
    message.spamReason = body.isSpam ? body.reason ?? "manual_review" : null;
    return {
      status: "updated",
      message: { id: message.id, is_spam: message.isSpam, spam_reason: message.spamReason }
    };
  }
  if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "whatsapp" && parts[3] === "templates" && parts.length === 5) {
    const body = parseJsonBody<{
      provider?: string;
      name?: string;
      language?: string;
      category?: string | null;
      status?: "active" | "paused";
      components?: Array<Record<string, unknown>> | null;
    }>(init);
    const template = state.whatsAppTemplates.find((entry) => entry.id === parts[4]);
    if (!template) throw new Error("Template not found");
    if (body.provider) template.provider = body.provider;
    if (body.name) template.name = body.name;
    if (body.language) template.language = body.language;
    if (Object.prototype.hasOwnProperty.call(body, "category")) template.category = body.category ?? null;
    if (body.status) template.status = body.status;
    if (Object.prototype.hasOwnProperty.call(body, "components")) template.components = body.components ?? null;
    return { template };
  }
  if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "agents" && parts.length === 4) {
    const body = parseJsonBody<{
      name?: string;
      provider?: string;
      baseUrl?: string;
      authType?: string;
      sharedSecret?: string;
      status?: "active" | "paused";
      policyMode?: "draft_only" | "auto_send";
      scopes?: Record<string, unknown>;
      capabilities?: Record<string, unknown>;
      policy?: Record<string, unknown>;
    }>(init);
    const agent = state.agents.find((entry) => entry.id === parts[3]);
    if (!agent) throw new Error("Agent not found");
    if (body.name) agent.name = body.name;
    if (body.provider) agent.provider = body.provider;
    if (body.baseUrl) agent.base_url = body.baseUrl;
    if (body.authType) agent.auth_type = body.authType;
    if (body.sharedSecret) agent.shared_secret = body.sharedSecret;
    if (body.status) agent.status = body.status;
    if (body.policyMode) agent.policy_mode = body.policyMode;
    if (body.scopes) agent.scopes = body.scopes;
    if (body.capabilities) agent.capabilities = body.capabilities;
    if (body.policy) agent.policy = body.policy;
    agent.updated_at = DEMO_NOW;
    if (state.agentOutboxes[agent.id]) {
      state.agentOutboxes[agent.id].integrationStatus = agent.status;
      state.agentOutboxes[agent.id].throughput.configuredMaxEventsPerRun = Number(
        agent.capabilities?.max_events_per_run ??
          state.agentOutboxes[agent.id].throughput.configuredMaxEventsPerRun ??
          25
      );
      state.agentOutboxes[agent.id].throughput.effectiveLimit = Number(
        agent.capabilities?.max_events_per_run ?? state.agentOutboxes[agent.id].throughput.effectiveLimit
      );
    }
    return { status: "updated", agent };
  }
  if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "calls" && parts[3] === "dead-letter") {
    const body = parseJsonBody<{ eventId: string; action: "recover" | "quarantine" | "discard" }>(init);
    const event = state.deadLetters.find((entry) => entry.id === body.eventId);
    if (!event) throw new Error("Dead letter event not found");
    if (body.action === "recover" || body.action === "discard") {
      state.deadLetters = state.deadLetters.filter((entry) => entry.id !== body.eventId);
    } else {
      event.status = "quarantined";
      event.updated_at = DEMO_NOW;
    }
    return {
      status: "updated",
      action: body.action,
      eventId: body.eventId,
      message: `Dead-letter event ${body.action}ed.`
    };
  }
  if (parts[0] === "api" && parts[1] === "tickets" && parts.length === 3) {
    const ticket = getTicketById(parts[2]);
    const body = parseJsonBody<{
      status?: ApiTicket["status"];
      priority?: ApiTicket["priority"];
      assignedUserId?: string | null;
      category?: string;
      metadata?: Record<string, unknown>;
    }>(init);
    if (body.status) {
      ticket.status = body.status;
      appendTicketEvent(ticket.id, {
        event_type: "status_updated",
        actor_user_id: state.currentUser.id,
        data: { to: body.status }
      });
    }
    if (body.priority) {
      ticket.priority = body.priority;
      appendTicketEvent(ticket.id, {
        event_type: "priority_updated",
        actor_user_id: state.currentUser.id,
        data: { to: body.priority }
      });
    }
    if (Object.prototype.hasOwnProperty.call(body, "assignedUserId")) {
      ticket.assigned_user_id = body.assignedUserId ?? null;
      appendTicketEvent(ticket.id, {
        event_type: "assignment_updated",
        actor_user_id: state.currentUser.id,
        data: { assignedUserId: body.assignedUserId ?? null }
      });
    }
    if (body.category) ticket.category = body.category;
    if (body.metadata) ticket.metadata = body.metadata;
    touchTicket(ticket.id);
    appendAuditLog({
      action: "ticket_updated",
      entity_type: "ticket",
      entity_id: ticket.id,
      data: body,
      actor_name: state.currentUser.display_name,
      actor_email: state.currentUser.email
    });
    return { ticket: toApiTicket(ticket) };
  }
  if (parts[0] === "api" && parts[1] === "customers" && parts.length === 3) {
    const body = parseJsonBody<{
      displayName?: string | null;
      primaryEmail?: string | null;
      primaryPhone?: string | null;
      address?: string | null;
      ticketId?: string | null;
    }>(init);
    const customer = state.customers[parts[2]];
    if (!customer) throw new Error("Customer not found");
    if (Object.prototype.hasOwnProperty.call(body, "displayName")) customer.display_name = body.displayName ?? null;
    if (Object.prototype.hasOwnProperty.call(body, "primaryEmail")) customer.primary_email = body.primaryEmail ?? null;
    if (Object.prototype.hasOwnProperty.call(body, "primaryPhone")) customer.primary_phone = body.primaryPhone ?? null;
    if (Object.prototype.hasOwnProperty.call(body, "address")) customer.address = body.address ?? null;
    return { customer };
  }
  if (parts[0] === "api" && parts[1] === "tickets" && parts[3] === "drafts" && parts.length === 5) {
    const body = parseJsonBody<{ status: "used" | "dismissed" }>(init);
    const drafts = state.draftsByTicketId[parts[2]] ?? [];
    const draft = drafts.find((entry) => entry.id === parts[4]);
    if (!draft) throw new Error("Draft not found");
    draft.status = body.status;
    return { status: draft.status };
  }
  if (parts[0] === "api" && parts[1] === "tickets" && parts[3] === "tags") {
    const body = parseJsonBody<{ addTags?: string[]; removeTags?: string[] }>(init);
    const ticket = getTicketById(parts[2]);
    const set = new Set(ticket.tags ?? []);
    for (const tag of body.addTags ?? []) {
      const normalized = tag.trim().toLowerCase();
      if (!normalized) continue;
      set.add(normalized);
      if (!state.tags.some((entry) => entry.name === normalized)) {
        state.tags.push({ id: titleToId("tag", normalized), name: normalized, description: null });
      }
    }
    for (const tag of body.removeTags ?? []) {
      set.delete(tag.trim().toLowerCase());
    }
    ticket.tags = Array.from(set);
    touchTicket(ticket.id);
    return { status: "updated" };
  }
  if (url.pathname === "/api/tickets/bulk") {
    const body = parseJsonBody<{
      ticketIds: string[];
      status?: ApiTicket["status"];
      priority?: ApiTicket["priority"];
      assignedUserId?: string | null;
      addTags?: string[];
      removeTags?: string[];
    }>(init);
    const updated = body.ticketIds.filter((ticketId) => {
      const ticket = state.tickets.find((entry) => entry.id === ticketId);
      if (!ticket) return false;
      if (body.status) ticket.status = body.status;
      if (body.priority) ticket.priority = body.priority;
      if (Object.prototype.hasOwnProperty.call(body, "assignedUserId")) {
        ticket.assigned_user_id = body.assignedUserId ?? null;
      }
      const nextTags = new Set(ticket.tags ?? []);
      for (const tag of body.addTags ?? []) nextTags.add(tag.trim().toLowerCase());
      for (const tag of body.removeTags ?? []) nextTags.delete(tag.trim().toLowerCase());
      ticket.tags = Array.from(nextTags);
      touchTicket(ticket.id);
      return true;
    });
    return { status: "updated", updatedTicketIds: updated, updatedCount: updated.length };
  }
  if (parts[0] === "api" && parts[1] === "messages" && parts[3] === "whatsapp-resend") {
    const message = getMessageById(parts[2]);
    message.waStatus = "sent";
    message.waTimestamp = DEMO_NOW;
    return { status: "queued" };
  }
  if (parts[0] === "api" && parts[1] === "messages" && parts.length === 3) {
    const body = parseJsonBody<{ isStarred?: boolean; isPinned?: boolean; isRead?: boolean }>(init);
    const anchorMessage = getMessageById(parts[2]);
    const threadId = anchorMessage.threadId;
    const threadMessages = threadId ? state.messages.filter((message) => message.threadId === threadId) : [anchorMessage];
    const updatedIds: string[] = [];
    for (const message of threadMessages) {
      if (Object.prototype.hasOwnProperty.call(body, "isStarred")) message.isStarred = Boolean(body.isStarred);
      if (Object.prototype.hasOwnProperty.call(body, "isPinned")) message.isPinned = Boolean(body.isPinned);
      if (Object.prototype.hasOwnProperty.call(body, "isRead")) message.isRead = Boolean(body.isRead);
      updatedIds.push(message.id);
    }
    return { updatedIds };
  }
  if (parts[0] === "api" && parts[1] === "merge-reviews" && parts.length === 3) {
    const body = parseJsonBody<{ decision: "approve" | "reject"; note?: string | null }>(init);
    const review = state.mergeReviews.find((entry) => entry.id === parts[2]);
    if (!review) throw new Error("Merge review not found");
    review.status = body.decision === "approve" ? "approved" : "rejected";
    review.reviewed_by_user_id = state.currentUser.id;
    review.reviewed_at = DEMO_NOW;
    review.updated_at = DEMO_NOW;
    appendAuditLog({
      action: `merge_review_${body.decision}d`,
      entity_type: "merge_review",
      entity_id: review.id,
      data: { note: body.note ?? null },
      actor_name: state.currentUser.display_name,
      actor_email: state.currentUser.email
    });
    return { status: "updated", task: review, mergeResult: body.decision === "approve" ? { applied: true } : null };
  }

  throw new Error(`No demo mock route for PATCH ${url.pathname}`);
}

function handleDelete(url: URL) {
  const state = getState();
  const parts = parsePathname(url.pathname);

  if (parts[0] === "api" && parts[1] === "support" && parts[2] === "tags" && parts.length === 4) {
    state.tags = state.tags.filter((tag) => tag.id !== parts[3]);
    return { status: "deleted" };
  }
  if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "spam-rules" && parts.length === 4) {
    state.spamRules = state.spamRules.filter((rule) => rule.id !== parts[3]);
    return { status: "deleted" };
  }
  if (parts[0] === "api" && parts[1] === "admin" && parts[2] === "whatsapp" && parts[3] === "templates" && parts.length === 5) {
    state.whatsAppTemplates = state.whatsAppTemplates.filter((template) => template.id !== parts[4]);
    return { status: "deleted" };
  }
  if (parts[0] === "api" && parts[1] === "support" && parts[2] === "saved-views" && parts.length === 4) {
    state.supportSavedViews = state.supportSavedViews.filter((view) => view.id !== parts[3]);
    return { status: "deleted" };
  }

  throw new Error(`No demo mock route for DELETE ${url.pathname}`);
}

export async function mockApiFetch<T>(url: string, init?: RequestInit) {
  assertNotAborted(init?.signal);
  const parsedUrl = new URL(url, "http://demo.local");
  const method = (init?.method ?? "GET").toUpperCase();

  let payload: unknown;
  if (method === "GET") {
    payload = handleGet(parsedUrl);
  } else if (method === "POST") {
    payload = handlePost(parsedUrl, init);
  } else if (method === "PATCH") {
    payload = handlePatch(parsedUrl, init);
  } else if (method === "DELETE") {
    payload = handleDelete(parsedUrl);
  } else {
    throw new Error(`No demo mock route for ${method} ${parsedUrl.pathname}`);
  }

  assertNotAborted(init?.signal);
  return cloneValue(payload as T);
}

export function resetMockApiState() {
  demoState = buildInitialState();
}
