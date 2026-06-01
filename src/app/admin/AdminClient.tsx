"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Bot, Phone, RefreshCw, Shield, Users, Workflow } from "lucide-react";
import AppShell from "@/app/components/AppShell";
import { ActionFeedbackModal } from "@/app/workspace/components/ActionFeedbackModal";
import { HealthIndicator } from "@/app/workspace/components/shared/HealthIndicator";
import { MetricCard } from "@/app/workspace/components/shared/MetricCard";
import { StatusBadge } from "@/app/workspace/components/shared/StatusBadge";
import { Badge } from "@/app/workspace/components/ui/badge";
import { Button } from "@/app/workspace/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/app/workspace/components/ui/card";
import { Input } from "@/app/workspace/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/app/workspace/components/ui/tabs";
import { Textarea } from "@/app/workspace/components/ui/textarea";
import {
  AgentIntegration,
  AgentFailedEvent,
  AgentRunPolicyReplay,
  AgentRunSummary,
  AgentPromptTemplateRecord,
  AiSafetyDiagnostics,
  AdminMailboxRecord,
  AgentOutboxMetrics,
  AdminUserRecord,
  AuditLogRecord,
  CallFailedEvent,
  CallOutboxMetrics,
  CallProviderNumber,
  CallTranscriptAiFailedJob,
  CallTranscriptAiMetrics,
  CallRejections,
  DeadLetterEvent,
  DeadLetterSummary,
  InboundAlertConfig,
  InboundFailedEvent,
  InboundMetrics,
  KnowledgeDocument,
  KnowledgeFolder,
  KnowledgeIngestionReadiness,
  KnowledgeQuarantineEvent,
  KnowledgeRetrievalEvent,
  KnowledgeRetentionSweepResult,
  KnowledgeSearchResult,
  ProfileLookupMetrics,
  RoleRecord,
  SecuritySnapshot,
  SpamMessageRecord,
  SpamRuleRecord,
  TagRecord,
  WorkspaceModulesConfig,
  WorkspaceModuleUsageSummary,
  WhatsAppTemplate,
  WhatsAppFailedEvent,
  WhatsAppOutboxMetrics,
  batchRecoverDeadLetters,
  createAdminMailbox,
  createAgentIntegration,
  createKnowledgeFolder,
  createSpamRule,
  createTag,
  createUser,
  createWhatsAppTemplate,
  deactivateCallProviderNumber,
  deleteSpamRule,
  deleteTag,
  deleteWhatsAppTemplate,
  deliverAgentOutbox,
  activateAgentPromptTemplate,
  exportKnowledgeBundle,
  listFailedAgentEvents,
  listKnowledgeDocuments,
  listKnowledgeFolders,
  listKnowledgeQuarantineEvents,
  listKnowledgeRetrievalEvents,
  listAgentRuns,
  listAgentPromptTemplates,
  getAiSafetyDiagnostics,
  getAgentRunReplay,
  getAgentOutboxMetrics,
  getKnowledgeIngestionReadiness,
  getCallRejections,
  getCallOutboxMetrics,
  getCallTranscriptAiMetrics,
  getDeadLetterSummary,
  getInboundSettings,
  getInboundMetrics,
  getProfileLookupMetrics,
  getSecuritySnapshot,
  getSlaConfig,
  getWorkspaceModules,
  getWorkspaceModuleUsage,
  getWhatsAppAccount,
  getWhatsAppOutboxMetrics,
  listFailedWhatsAppEvents,
  listAgentIntegrations,
  listAdminMailboxes,
  listAuditLogs,
  listFailedCallEvents,
  listFailedCallTranscriptAiJobs,
  listFailedInboundEvents,
  listCallProviderNumbers,
  listDeadLetterEvents,
  listRoles,
  listSpamMessages,
  listSpamRules,
  listTags,
  listUsers,
  listWhatsAppTemplates,
  patchDeadLetterEvent,
  publishKnowledgeDocument,
  previewKnowledgeRetention,
  requestPasswordResetLink,
  retryFailedCallEvents,
  retryFailedCallTranscriptAiJobs,
  retryFailedAgentOutboxEvents,
  rollbackAgentPromptTemplate,
  runKnowledgeRetention,
  retryFailedWhatsAppOutboxEvents,
  retryInboundEvents,
  runCallOutbox,
  runCallTranscriptAiOutbox,
  runInboundAlertCheck,
  runWhatsAppOutbox,
  saveCallProviderNumber,
  saveWhatsAppAccount,
  searchKnowledge,
  setKnowledgeDocumentLegalHold,
  setMessageSpamStatus,
  updateAgentIntegration,
  updateInboundSettings,
  updateSlaConfig,
  updateSpamRule,
  updateTag,
  updateUser,
  updateWorkspaceModules,
  updateWhatsAppTemplate,
  uploadKnowledgeDocument
} from "@/app/lib/api/admin";
import { ApiError } from "@/app/lib/api/http";
import { Checkbox } from "@/app/workspace/components/ui/checkbox";

type TabKey = "overview" | "workspace" | "knowledge" | "automation" | "operations";
type AgentPolicyMode = AgentIntegration["policy_mode"];
type OperationsSectionKey = "inbound" | "inbound-settings" | "calls" | "call-rejections" | "audit-logs";
type OperationsFilters = {
  windowHours: number;
  eventLimit: number;
  auditLimit: number;
};

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type SummaryMetric = {
  label: string;
  value: string | number;
  unit?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  trendTone?: "positive" | "negative" | "neutral";
  status?: "healthy" | "warning" | "critical";
};

type AttentionSignal = {
  message: string;
  healthy: boolean;
  severity?: "info" | "warning" | "error";
};

type UserForm = {
  email: string;
  displayName: string;
  password: string;
  roleId: string;
};

type MailboxForm = {
  address: string;
  memberEmails: string;
};

type SlaForm = {
  firstResponseMinutes: number;
  resolutionMinutes: number;
};

type TagForm = {
  name: string;
  description: string;
};

type SpamRuleForm = {
  ruleType: "allow" | "block";
  scope: "sender" | "domain" | "subject" | "body";
  pattern: string;
};

type WhatsAppForm = {
  provider: string;
  phoneNumber: string;
  wabaId: string;
  accessToken: string;
  verifyToken: string;
  status: "active" | "paused" | "inactive";
};

type CallProviderNumberForm = {
  id: string;
  provider: string;
  phoneNumber: string;
  accountSid: string;
  status: "active" | "paused" | "inactive";
};

type AgentForm = {
  name: string;
  provider: string;
  baseUrl: string;
  authType: string;
  sharedSecret: string;
  status: "active" | "paused";
  policyMode: AgentPolicyMode;
  maxEventsPerRun: string;
  allowMergeActions: boolean;
  allowVoiceActions: boolean;
  scopesJson: string;
  policyJson: string;
};

const WORKSPACE_MODULE_FIELDS: Array<{
  key: keyof WorkspaceModulesConfig["modules"];
  label: string;
  description: string;
  billing: "billable" | "included";
}> = [
  {
    key: "email",
    label: "Email",
    description: "Mailbox ingest, outbound email, and email ticket creation.",
    billing: "billable"
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    description: "WhatsApp messaging, templates, resend flows, and related ticket creation.",
    billing: "billable"
  },
  {
    key: "voice",
    label: "Voice",
    description: "Outbound voice initiation, queue processing, and live call operations.",
    billing: "billable"
  },
  {
    key: "aiAutomation",
    label: "AI automation",
    description: "Autonomous AI text and voice actions when policy allows.",
    billing: "billable"
  },
  {
    key: "venusOrchestration",
    label: "Venus orchestration",
    description: "Optional Venus-derived orchestration paths and runtime hooks.",
    billing: "billable"
  },
  {
    key: "vanillaWebchat",
    label: "Vanilla webchat",
    description: "Human-to-6esk webchat without autonomous AI behavior.",
    billing: "included"
  }
];

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
}

function formatBytes(value: number | null | undefined) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getFilteredUnsafeChunks(event: KnowledgeRetrievalEvent) {
  const value = event.metadata?.filteredUnsafeChunks;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getRetentionLabel(document: KnowledgeDocument) {
  const retention = document.metadata?.retention;
  if (!retention || typeof retention !== "object") return "Retention not set";
  const expiresAt = (retention as { expiresAt?: unknown }).expiresAt;
  return typeof expiresAt === "string" && expiresAt
    ? `Retains until ${formatDate(expiresAt)}`
    : "No automatic expiry";
}

function getLegalHold(document: KnowledgeDocument) {
  const retention = document.metadata?.retention;
  if (!retention || typeof retention !== "object") return false;
  return (retention as { legalHold?: unknown }).legalHold === true;
}

function formatAgentPolicyMode(mode: string | null | undefined) {
  if (mode === "full_auto" || mode === "auto_send") {
    return "Full auto";
  }
  return "Hybrid review";
}

function agentPolicyStatus(mode: string | null | undefined): "healthy" | "warning" {
  return mode === "full_auto" || mode === "auto_send" ? "warning" : "healthy";
}

function mapAgentToForm(agent: AgentIntegration): AgentForm {
  const maxEvents = Number(agent.capabilities?.max_events_per_run);
  return {
    name: agent.name,
    provider: agent.provider,
    baseUrl: agent.base_url,
    authType: agent.auth_type,
    sharedSecret: agent.shared_secret,
    status: agent.status,
    policyMode: agent.policy_mode,
    maxEventsPerRun: Number.isFinite(maxEvents) && maxEvents > 0 ? String(maxEvents) : "",
    allowMergeActions:
      agent.capabilities?.allow_merge_actions === true || agent.capabilities?.allowMergeActions === true,
    allowVoiceActions:
      agent.capabilities?.allow_voice_actions === true || agent.capabilities?.allowVoiceActions === true,
    scopesJson: JSON.stringify(agent.scopes ?? {}, null, 2),
    policyJson: JSON.stringify(agent.policy ?? {}, null, 2)
  };
}

function defaultAgentForm(): AgentForm {
  return {
    name: "6esk AI Agent",
    provider: "elizaos",
    baseUrl: "",
    authType: "hmac",
    sharedSecret: "",
    status: "active",
    policyMode: "hybrid_review",
    maxEventsPerRun: "",
    allowMergeActions: false,
    allowVoiceActions: false,
    scopesJson: "{}",
    policyJson: "{}"
  };
}

function defaultCallProviderNumberForm(): CallProviderNumberForm {
  return {
    id: "",
    provider: "twilio",
    phoneNumber: "",
    accountSid: "",
    status: "active"
  };
}

function generateOpaqueToken() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3">
      <p className="text-xs text-neutral-600">{label}</p>
      <p className="text-base font-semibold text-neutral-900">{value}</p>
    </div>
  );
}

function getTemplateParamCount(template: WhatsAppTemplate) {
  if (!template.components) return 0;
  let count = 0;
  for (const component of template.components) {
    if (!component || typeof component !== "object") continue;
    const params = (component as Record<string, unknown>).parameters;
    if (Array.isArray(params)) {
      count += params.length;
    }
  }
  return count;
}

const TAB_VALUES = new Set(["overview", "workspace", "knowledge", "automation", "operations"]);
const OPERATIONS_SECTION_VALUES = new Set([
  "inbound",
  "inbound-settings",
  "calls",
  "call-rejections",
  "audit-logs"
]);
const DEFAULT_OPERATIONS_FILTERS: OperationsFilters = {
  windowHours: 24,
  eventLimit: 20,
  auditLimit: 50
};

const TAB_COPY: Record<
  TabKey,
  {
    title: string;
    description: string;
    statusLabel: string;
  }
> = {
  overview: {
    title: "Platform governance",
    description: "Users, roles, SLA posture, and security controls for the current workspace.",
    statusLabel: "Governance"
  },
  workspace: {
    title: "Messaging control center",
    description: "Runtime modules, mailboxes, WhatsApp delivery, and spam controls.",
    statusLabel: "Messaging"
  },
  knowledge: {
    title: "AI knowledge base",
    description: "Tenant SOPs, business documents, retrieval readiness, and AI context controls.",
    statusLabel: "Knowledge"
  },
  automation: {
    title: "Automation posture",
    description: "Agent integrations, policy controls, and lookup quality for autonomous flows.",
    statusLabel: "Automation"
  },
  operations: {
    title: "Live operations",
    description: "Inbound failures, call delivery, transcript QA, and audit visibility.",
    statusLabel: "Operations"
  }
};

function clampInteger(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.trunc(value);
  return Math.min(max, Math.max(min, rounded));
}

function normalizeOperationsFilters(input: {
  windowHours: number;
  eventLimit: number;
  auditLimit: number;
}): OperationsFilters {
  return {
    windowHours: clampInteger(input.windowHours, 1, 168, DEFAULT_OPERATIONS_FILTERS.windowHours),
    eventLimit: clampInteger(input.eventLimit, 5, 100, DEFAULT_OPERATIONS_FILTERS.eventLimit),
    auditLimit: clampInteger(input.auditLimit, 10, 200, DEFAULT_OPERATIONS_FILTERS.auditLimit)
  };
}

export default function AdminClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paramsKey = searchParams.toString();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [loading, setLoading] = useState<Record<TabKey, boolean>>({
    overview: false,
    workspace: false,
    knowledge: false,
    automation: false,
    operations: false
  });
  const [loaded, setLoaded] = useState<Record<TabKey, boolean>>({
    overview: false,
    workspace: false,
    knowledge: false,
    automation: false,
    operations: false
  });
  const [toast, setToast] = useState<ToastState>(null);

  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [userForm, setUserForm] = useState<UserForm>({ email: "", displayName: "", password: "", roleId: "" });
  const [mailboxes, setMailboxes] = useState<AdminMailboxRecord[]>([]);
  const [mailboxForm, setMailboxForm] = useState<MailboxForm>({ address: "", memberEmails: "" });
  const [sla, setSla] = useState<SlaForm>({ firstResponseMinutes: 120, resolutionMinutes: 1440 });
  const [security, setSecurity] = useState<SecuritySnapshot | null>(null);

  const [workspaceModules, setWorkspaceModules] = useState<WorkspaceModulesConfig | null>(null);
  const [workspaceUsage, setWorkspaceUsage] = useState<WorkspaceModuleUsageSummary | null>(null);
  const [knowledgeFolders, setKnowledgeFolders] = useState<KnowledgeFolder[]>([]);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [knowledgeFolderName, setKnowledgeFolderName] = useState("");
  const [knowledgeUploadFile, setKnowledgeUploadFile] = useState<File | null>(null);
  const [knowledgeUploadTitle, setKnowledgeUploadTitle] = useState("");
  const [knowledgeUploadFolderId, setKnowledgeUploadFolderId] = useState("");
  const [knowledgePublishOnUpload, setKnowledgePublishOnUpload] = useState(true);
  const [knowledgeSearchQuery, setKnowledgeSearchQuery] = useState("");
  const [knowledgeSearchResults, setKnowledgeSearchResults] = useState<KnowledgeSearchResult[]>([]);
  const [knowledgeRetrievalEvents, setKnowledgeRetrievalEvents] = useState<KnowledgeRetrievalEvent[]>([]);
  const [knowledgeQuarantineEvents, setKnowledgeQuarantineEvents] = useState<KnowledgeQuarantineEvent[]>([]);
  const [knowledgeIngestionReadiness, setKnowledgeIngestionReadiness] =
    useState<KnowledgeIngestionReadiness | null>(null);
  const [knowledgeRetentionPreview, setKnowledgeRetentionPreview] =
    useState<KnowledgeRetentionSweepResult | null>(null);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [tagForm, setTagForm] = useState<TagForm>({ name: "", description: "" });
  const [tagEditingId, setTagEditingId] = useState<string | null>(null);
  const [spamRules, setSpamRules] = useState<SpamRuleRecord[]>([]);
  const [ruleForm, setRuleForm] = useState<SpamRuleForm>({ ruleType: "block", scope: "sender", pattern: "" });
  const [ruleEditingId, setRuleEditingId] = useState<string | null>(null);
  const [spamMessages, setSpamMessages] = useState<SpamMessageRecord[]>([]);
  const [whatsAppForm, setWhatsAppForm] = useState<WhatsAppForm>({
    provider: "meta",
    phoneNumber: "",
    wabaId: "",
    accessToken: "",
    verifyToken: "",
    status: "inactive"
  });
  const [whatsAppTemplates, setWhatsAppTemplates] = useState<WhatsAppTemplate[]>([]);
  const [whatsAppOutbox, setWhatsAppOutbox] = useState<WhatsAppOutboxMetrics | null>(null);
  const [failedWhatsAppEvents, setFailedWhatsAppEvents] = useState<WhatsAppFailedEvent[]>([]);
  const [showWhatsAppAccessToken, setShowWhatsAppAccessToken] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    name: "",
    language: "en_US",
    category: "",
    status: "active" as "active" | "paused",
    componentsJson: ""
  });
  const [templateEditingId, setTemplateEditingId] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const [agents, setAgents] = useState<AgentIntegration[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [agentForm, setAgentForm] = useState<AgentForm>(defaultAgentForm);
  const [agentOutbox, setAgentOutbox] = useState<AgentOutboxMetrics | null>(null);
  const [failedAgentEvents, setFailedAgentEvents] = useState<AgentFailedEvent[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRunSummary[]>([]);
  const [agentReplay, setAgentReplay] = useState<AgentRunPolicyReplay | null>(null);
  const [replayLoadingRunId, setReplayLoadingRunId] = useState<string | null>(null);
  const [aiSafety, setAiSafety] = useState<AiSafetyDiagnostics | null>(null);
  const [promptTemplates, setPromptTemplates] = useState<AgentPromptTemplateRecord[]>([]);
  const [showAgentSecret, setShowAgentSecret] = useState(false);
  const [profileDays, setProfileDays] = useState(14);
  const [profile, setProfile] = useState<ProfileLookupMetrics | null>(null);

  const [inbound, setInbound] = useState<InboundMetrics | null>(null);
  const [inboundSettings, setInboundSettings] = useState<InboundAlertConfig | null>(null);
  const [failedInboundEvents, setFailedInboundEvents] = useState<InboundFailedEvent[]>([]);
  const [calls, setCalls] = useState<CallOutboxMetrics | null>(null);
  const [callProviderNumbers, setCallProviderNumbers] = useState<CallProviderNumber[]>([]);
  const [callProviderNumberForm, setCallProviderNumberForm] = useState<CallProviderNumberForm>(
    defaultCallProviderNumberForm()
  );
  const [failedCallEvents, setFailedCallEvents] = useState<CallFailedEvent[]>([]);
  const [callTranscriptAi, setCallTranscriptAi] = useState<CallTranscriptAiMetrics | null>(null);
  const [failedCallTranscriptAiJobs, setFailedCallTranscriptAiJobs] = useState<
    CallTranscriptAiFailedJob[]
  >([]);
  const [callRejections, setCallRejections] = useState<CallRejections | null>(null);
  const [deadLetters, setDeadLetters] = useState<DeadLetterEvent[]>([]);
  const [deadLetterSummary, setDeadLetterSummary] = useState<DeadLetterSummary | null>(null);
  const [deadLetterStatusFilter, setDeadLetterStatusFilter] = useState<"all" | "failed" | "poison" | "quarantined">("all");
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [eventActionBusyKey, setEventActionBusyKey] = useState<string | null>(null);
  const [reviewingRejectionId, setReviewingRejectionId] = useState<string | null>(null);
  const [operationsFilters, setOperationsFilters] = useState<OperationsFilters>(DEFAULT_OPERATIONS_FILTERS);
  const [operationsFilterDraft, setOperationsFilterDraft] = useState({
    windowHours: String(DEFAULT_OPERATIONS_FILTERS.windowHours),
    eventLimit: String(DEFAULT_OPERATIONS_FILTERS.eventLimit),
    auditLimit: String(DEFAULT_OPERATIONS_FILTERS.auditLimit)
  });

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );
  const filteredDeadLetters = useMemo(
    () =>
      deadLetterStatusFilter === "all"
        ? deadLetters
        : deadLetters.filter((event) => event.status === deadLetterStatusFilter),
    [deadLetterStatusFilter, deadLetters]
  );
  const hasOperationsFilterChanges = useMemo(
    () =>
      operationsFilterDraft.windowHours !== String(operationsFilters.windowHours) ||
      operationsFilterDraft.eventLimit !== String(operationsFilters.eventLimit) ||
      operationsFilterDraft.auditLimit !== String(operationsFilters.auditLimit),
    [operationsFilterDraft, operationsFilters]
  );

  const replaceQueryState = useCallback(
    (tab: TabKey, section?: OperationsSectionKey | null) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("tab", tab);
      if (tab === "operations" && section) {
        nextParams.set("section", section);
      } else {
        nextParams.delete("section");
      }
      const query = nextParams.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const handleTabChange = useCallback(
    (value: string) => {
      const nextTab = TAB_VALUES.has(value) ? (value as TabKey) : "overview";
      setActiveTab(nextTab);
      const sectionParam = searchParams.get("section");
      const section =
        nextTab === "operations" && sectionParam && OPERATIONS_SECTION_VALUES.has(sectionParam)
          ? (sectionParam as OperationsSectionKey)
          : null;
      replaceQueryState(nextTab, section);
    },
    [replaceQueryState, searchParams]
  );

  const jumpToOperationsSection = useCallback(
    (section: OperationsSectionKey) => {
      setActiveTab("operations");
      replaceQueryState("operations", section);
      window.requestAnimationFrame(() => {
        const target = document.getElementById(`ops-${section}`);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    },
    [replaceQueryState]
  );

  const pushSuccess = useCallback((message: string) => setToast({ tone: "success", message }), []);
  const pushError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof ApiError) {
      setToast({ tone: "error", message: error.message || fallback });
      return;
    }
    if (error instanceof Error) {
      setToast({ tone: "error", message: error.message || fallback });
      return;
    }
    setToast({ tone: "error", message: fallback });
  }, []);

  const copyToClipboard = useCallback(async (value: string, label: string) => {
    if (!value) {
      setToast({ tone: "error", message: `No ${label.toLowerCase()} available.` });
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setToast({ tone: "success", message: `${label} copied` });
    } catch {
      setToast({ tone: "error", message: `Could not copy ${label.toLowerCase()}.` });
    }
  }, []);

  const generateVerifyToken = useCallback(() => {
    setWhatsAppForm((prev) => ({ ...prev, verifyToken: generateOpaqueToken() }));
  }, []);

  const generateAgentSecret = useCallback(() => {
    setAgentForm((prev) => ({ ...prev, sharedSecret: generateOpaqueToken() }));
  }, []);

  const applyOperationsFilters = useCallback(() => {
    const nextFilters = normalizeOperationsFilters({
      windowHours: Number(operationsFilterDraft.windowHours),
      eventLimit: Number(operationsFilterDraft.eventLimit),
      auditLimit: Number(operationsFilterDraft.auditLimit)
    });
    setOperationsFilters(nextFilters);
    setOperationsFilterDraft({
      windowHours: String(nextFilters.windowHours),
      eventLimit: String(nextFilters.eventLimit),
      auditLimit: String(nextFilters.auditLimit)
    });
    setLoaded((prev) => ({ ...prev, operations: false }));
    pushSuccess(
      `Operations filters applied (${nextFilters.windowHours}h, ${nextFilters.eventLimit} events, ${nextFilters.auditLimit} audit rows).`
    );
  }, [operationsFilterDraft, pushSuccess]);

  const resetOperationsFilters = useCallback(() => {
    setOperationsFilters(DEFAULT_OPERATIONS_FILTERS);
    setOperationsFilterDraft({
      windowHours: String(DEFAULT_OPERATIONS_FILTERS.windowHours),
      eventLimit: String(DEFAULT_OPERATIONS_FILTERS.eventLimit),
      auditLimit: String(DEFAULT_OPERATIONS_FILTERS.auditLimit)
    });
    setLoaded((prev) => ({ ...prev, operations: false }));
    pushSuccess("Operations filters reset to defaults.");
  }, [pushSuccess]);

  const resetTagForm = useCallback(() => {
    setTagForm({ name: "", description: "" });
    setTagEditingId(null);
  }, []);

  const startTagEdit = useCallback((tag: TagRecord) => {
    setTagForm({
      name: tag.name,
      description: tag.description ?? ""
    });
    setTagEditingId(tag.id);
  }, []);

  const resetRuleForm = useCallback(() => {
    setRuleForm({ ruleType: "block", scope: "sender", pattern: "" });
    setRuleEditingId(null);
  }, []);

  const startRuleEdit = useCallback((rule: SpamRuleRecord) => {
    setRuleForm({
      ruleType: rule.rule_type,
      scope: rule.scope,
      pattern: rule.pattern
    });
    setRuleEditingId(rule.id);
  }, []);

  const resetTemplateForm = useCallback(() => {
    setTemplateForm({
      name: "",
      language: "en_US",
      category: "",
      status: "active",
      componentsJson: ""
    });
    setTemplateEditingId(null);
    setTemplateError(null);
  }, []);

  const startTemplateEdit = useCallback((template: WhatsAppTemplate) => {
    setTemplateForm({
      name: template.name,
      language: template.language,
      category: template.category ?? "",
      status: template.status,
      componentsJson: template.components ? JSON.stringify(template.components, null, 2) : ""
    });
    setTemplateEditingId(template.id);
    setTemplateError(null);
  }, []);

  const formatComponentsJson = useCallback(() => {
    if (!templateForm.componentsJson.trim()) return;
    try {
      const parsed = JSON.parse(templateForm.componentsJson);
      setTemplateForm((prev) => ({
        ...prev,
        componentsJson: JSON.stringify(parsed, null, 2)
      }));
      setTemplateError(null);
    } catch {
      setTemplateError("Template components JSON is invalid.");
    }
  }, [templateForm.componentsJson]);

  const loadOverview = useCallback(async () => {
    setLoading((prev) => ({ ...prev, overview: true }));
    try {
      const [nextRoles, nextUsers, nextSla, nextSecurity] = await Promise.all([
        listRoles(),
        listUsers(),
        getSlaConfig(),
        getSecuritySnapshot()
      ]);
      setRoles(nextRoles);
      setUsers(nextUsers);
      setSla(nextSla);
      setSecurity(nextSecurity);
      setUserForm((prev) => ({ ...prev, roleId: prev.roleId || nextRoles[0]?.id || "" }));
      setLoaded((prev) => ({ ...prev, overview: true }));
    } catch (error) {
      pushError(error, "Failed loading overview");
    } finally {
      setLoading((prev) => ({ ...prev, overview: false }));
    }
  }, [pushError]);

  const loadWorkspace = useCallback(async () => {
    setLoading((prev) => ({ ...prev, workspace: true }));
    try {
      const [
        modulesPayload,
        usagePayload,
        mailboxRows,
        tagRows,
        ruleRows,
        spamRows,
        accountPayload,
        templates,
        outbox,
        failedOutbox
      ] = await Promise.all([
        getWorkspaceModules(),
        getWorkspaceModuleUsage(),
        listAdminMailboxes(),
        listTags(),
        listSpamRules(),
        listSpamMessages(25),
        getWhatsAppAccount(),
        listWhatsAppTemplates(),
        getWhatsAppOutboxMetrics(),
        listFailedWhatsAppEvents(25)
      ]);
      setWorkspaceModules(modulesPayload.config);
      setWorkspaceUsage(usagePayload.summary);
      setMailboxes(mailboxRows);
      setTags(tagRows);
      setSpamRules(ruleRows);
      setSpamMessages(spamRows);
      if (accountPayload.account) {
        setWhatsAppForm({
          provider: accountPayload.account.provider,
          phoneNumber: accountPayload.account.phoneNumber,
          wabaId: accountPayload.account.wabaId ?? "",
          accessToken: accountPayload.account.accessToken ?? "",
          verifyToken: accountPayload.account.verifyToken ?? "",
          status: accountPayload.account.status
        });
      } else {
        setWhatsAppForm({
          provider: "meta",
          phoneNumber: "",
          wabaId: "",
          accessToken: "",
          verifyToken: "",
          status: "inactive"
        });
      }
      setWhatsAppTemplates(templates);
      setWhatsAppOutbox(outbox);
      setFailedWhatsAppEvents(failedOutbox);
      setLoaded((prev) => ({ ...prev, workspace: true }));
    } catch (error) {
      pushError(error, "Failed loading messaging tab");
    } finally {
      setLoading((prev) => ({ ...prev, workspace: false }));
    }
  }, [pushError]);

  const loadAutomation = useCallback(async () => {
    setLoading((prev) => ({ ...prev, automation: true }));
    try {
      const [agentRows, metrics, safetyDiagnostics, templates] = await Promise.all([
        listAgentIntegrations(),
        getProfileLookupMetrics(profileDays),
        getAiSafetyDiagnostics(50).catch(() => null),
        listAgentPromptTemplates(25).catch(() => [])
      ]);
      setAgents(agentRows);
      setProfile(metrics);
      setAiSafety(safetyDiagnostics);
      setPromptTemplates(templates);
      const nextAgent = agentRows.find((agent) => agent.id === selectedAgentId) ?? agentRows[0] ?? null;
      setSelectedAgentId(nextAgent?.id ?? "");
      if (nextAgent) {
        setAgentForm(mapAgentToForm(nextAgent));
        const [outbox, failedOutbox, runs] = await Promise.all([
          getAgentOutboxMetrics(nextAgent.id).catch(() => null),
          listFailedAgentEvents(nextAgent.id, 25).catch(() => []),
          listAgentRuns(nextAgent.id, 25).catch(() => [])
        ]);
        setAgentOutbox(outbox);
        setFailedAgentEvents(failedOutbox);
        setAgentRuns(runs);
      } else {
        setAgentForm(defaultAgentForm());
        setAgentOutbox(null);
        setFailedAgentEvents([]);
        setAgentRuns([]);
        setAgentReplay(null);
      }
      setLoaded((prev) => ({ ...prev, automation: true }));
    } catch (error) {
      pushError(error, "Failed loading automation tab");
    } finally {
      setLoading((prev) => ({ ...prev, automation: false }));
    }
  }, [profileDays, pushError, selectedAgentId]);

  const loadAgentReplay = useCallback(
    async (runId: string) => {
      if (!selectedAgent) return;
      setReplayLoadingRunId(runId);
      try {
        const replay = await getAgentRunReplay(selectedAgent.id, runId);
        setAgentReplay(replay);
      } catch (error) {
        pushError(error, "Failed loading agent replay evidence");
      } finally {
        setReplayLoadingRunId(null);
      }
    },
    [pushError, selectedAgent]
  );

  const activatePromptTemplateVersion = useCallback(
    async (templateId: string) => {
      try {
        await activateAgentPromptTemplate(templateId, "Activated from Admin automation diagnostics");
        pushSuccess("Prompt template activated.");
        await loadAutomation();
      } catch (error) {
        pushError(error, "Failed activating prompt template");
      }
    },
    [loadAutomation, pushError, pushSuccess]
  );

  const rollbackPromptTemplateVersion = useCallback(async () => {
    try {
      await rollbackAgentPromptTemplate({
        reason: "Rolled back from Admin automation diagnostics"
      });
      pushSuccess("Prompt template rolled back.");
      await loadAutomation();
    } catch (error) {
      pushError(error, "Failed rolling back prompt template");
    }
  }, [loadAutomation, pushError, pushSuccess]);

  const loadKnowledge = useCallback(async () => {
    setLoading((prev) => ({ ...prev, knowledge: true }));
    try {
      const [folders, documents, retrievalEvents, quarantineEvents, ingestionReadiness, retentionPreview] =
        await Promise.all([
          listKnowledgeFolders(),
          listKnowledgeDocuments(),
          listKnowledgeRetrievalEvents(20),
          listKnowledgeQuarantineEvents(20),
          getKnowledgeIngestionReadiness(),
          previewKnowledgeRetention(100)
        ]);
      setKnowledgeFolders(folders);
      setKnowledgeDocuments(documents);
      setKnowledgeRetrievalEvents(retrievalEvents);
      setKnowledgeQuarantineEvents(quarantineEvents);
      setKnowledgeIngestionReadiness(ingestionReadiness);
      setKnowledgeRetentionPreview(retentionPreview);
      setLoaded((prev) => ({ ...prev, knowledge: true }));
    } catch (error) {
      pushError(error, "Failed loading knowledge base");
    } finally {
      setLoading((prev) => ({ ...prev, knowledge: false }));
    }
  }, [pushError]);

  const loadOperations = useCallback(async () => {
    setLoading((prev) => ({ ...prev, operations: true }));
    try {
      const [
        inboundMetrics,
        inboundConfig,
        inboundFailedRows,
        callMetrics,
        providerNumbers,
        failedCalls,
        transcriptAiMetrics,
        failedTranscriptAiRows,
        rejectionMetrics,
        deadLetterPayload,
        deadLetterRows,
        logs
      ] = await Promise.all([
        getInboundMetrics(operationsFilters.windowHours),
        getInboundSettings(),
        listFailedInboundEvents(operationsFilters.eventLimit),
        getCallOutboxMetrics(),
        listCallProviderNumbers(),
        listFailedCallEvents(operationsFilters.eventLimit),
        getCallTranscriptAiMetrics(operationsFilters.eventLimit),
        listFailedCallTranscriptAiJobs(operationsFilters.eventLimit),
        getCallRejections(operationsFilters.windowHours, operationsFilters.eventLimit),
        getDeadLetterSummary(),
        listDeadLetterEvents({ limit: operationsFilters.eventLimit, status: "all" }),
        listAuditLogs(operationsFilters.auditLimit)
      ]);
      setInbound(inboundMetrics);
      setInboundSettings(inboundConfig.config);
      setFailedInboundEvents(inboundFailedRows);
      setCalls(callMetrics);
      setCallProviderNumbers(providerNumbers);
      setFailedCallEvents(failedCalls);
      setCallTranscriptAi(transcriptAiMetrics);
      setFailedCallTranscriptAiJobs(failedTranscriptAiRows);
      setCallRejections(rejectionMetrics);
      setDeadLetterSummary(deadLetterPayload.summary);
      setDeadLetters(deadLetterRows);
      setAuditLogs(logs);
      setLoaded((prev) => ({ ...prev, operations: true }));
    } catch (error) {
      pushError(error, "Failed loading operations tab");
    } finally {
      setLoading((prev) => ({ ...prev, operations: false }));
    }
  }, [operationsFilters, pushError]);

  const refreshTab = useCallback(async () => {
    if (activeTab === "overview") await loadOverview();
    if (activeTab === "workspace") await loadWorkspace();
    if (activeTab === "knowledge") await loadKnowledge();
    if (activeTab === "automation") await loadAutomation();
    if (activeTab === "operations") await loadOperations();
  }, [activeTab, loadAutomation, loadKnowledge, loadOperations, loadOverview, loadWorkspace]);

  const whatsAppWebhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/whatsapp/inbound` : "";
  const whatsAppStatusWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (whatsAppForm.status === "active" && !whatsAppForm.accessToken.trim()) {
      warnings.push("Access token is required while the account is Active.");
    }
    if (whatsAppForm.provider === "meta" && !whatsAppForm.verifyToken.trim()) {
      warnings.push("Verify token is empty. Meta webhook verification will fail.");
    }
    return warnings;
  }, [whatsAppForm.accessToken, whatsAppForm.provider, whatsAppForm.status, whatsAppForm.verifyToken]);

  const summaryMetrics = useMemo<SummaryMetric[]>(() => {
    if (activeTab === "overview") {
      const activeUsers = users.filter((user) => user.is_active).length;
      const inactiveUsers = Math.max(0, users.length - activeUsers);
      const missingSecrets = Number(!security?.agentSecretKeyConfigured) + Number(!security?.inboundSecretConfigured);
      const unencryptedSecrets =
        (security?.agentIntegrationStats.unencrypted ?? 0) + (security?.whatsappTokenStats.unencrypted ?? 0);
      return [
        {
          label: "Users",
          value: users.length,
          trend: activeUsers > 0 ? "up" : "neutral",
          trendValue: `${activeUsers} active`,
          trendTone: activeUsers > 0 ? "positive" : "neutral",
          status: inactiveUsers === 0 ? "healthy" : "warning"
        },
        {
          label: "Roles",
          value: roles.length,
          status: roles.length >= 3 ? "healthy" : "warning"
        },
        {
          label: "Secret Gaps",
          value: missingSecrets,
          trend: missingSecrets > 0 ? "up" : "neutral",
          trendValue: missingSecrets > 0 ? "Action needed" : "Configured",
          trendTone: missingSecrets > 0 ? "negative" : "positive",
          status: missingSecrets === 0 ? "healthy" : "critical"
        },
        {
          label: "Unencrypted Tokens",
          value: unencryptedSecrets,
          status: unencryptedSecrets === 0 ? "healthy" : "warning"
        }
      ];
    }

    if (activeTab === "workspace") {
      const enabledModules = Object.values(workspaceModules?.modules ?? {}).filter(Boolean).length;
      const billableEnabled = WORKSPACE_MODULE_FIELDS.filter(
        (field) => field.billing === "billable" && workspaceModules?.modules[field.key]
      ).length;
      return [
        {
          label: "Mailboxes",
          value: mailboxes.length,
          status: mailboxes.length > 0 ? "healthy" : "warning"
        },
        {
          label: "Enabled Modules",
          value: enabledModules,
          trend: billableEnabled > 0 ? "up" : "neutral",
          trendValue: `${billableEnabled} billable`,
          trendTone: billableEnabled > 0 ? "positive" : "neutral",
          status: enabledModules > 0 ? "healthy" : "warning"
        },
        {
          label: "Spam Queue",
          value: spamMessages.length,
          status: spamMessages.length === 0 ? "healthy" : spamMessages.length < 10 ? "warning" : "critical"
        },
        {
          label: "WA Failures",
          value: failedWhatsAppEvents.length,
          status:
            failedWhatsAppEvents.length === 0 ? "healthy" : failedWhatsAppEvents.length < 5 ? "warning" : "critical"
        }
      ];
    }

    if (activeTab === "automation") {
      const activeAgents = agents.filter((agent) => agent.status === "active").length;
      const failedEvents = failedAgentEvents.length;
      return [
        {
          label: "Agents",
          value: agents.length,
          trend: activeAgents > 0 ? "up" : "neutral",
          trendValue: `${activeAgents} active`,
          trendTone: activeAgents > 0 ? "positive" : "neutral",
          status: activeAgents > 0 ? "healthy" : "warning"
        },
        {
          label: "Policy Mode",
          value: formatAgentPolicyMode(selectedAgent?.policy_mode),
          status: agentPolicyStatus(selectedAgent?.policy_mode)
        },
        {
          label: "Failed Events",
          value: failedEvents,
          status: failedEvents === 0 ? "healthy" : failedEvents < 5 ? "warning" : "critical"
        },
        {
          label: "Safety Blocks",
          value: aiSafety?.summary.blockedPolicyDecisions ?? 0,
          status:
            (aiSafety?.summary.blockedPolicyDecisions ?? 0) === 0
              ? "healthy"
              : (aiSafety?.summary.blockedPolicyDecisions ?? 0) < 5
                ? "warning"
                : "critical"
        },
        {
          label: "Lookup Hit Rate",
          value: `${Math.round(profile?.summary.hitRate ?? 0)}%`,
          status:
            (profile?.summary.hitRate ?? 0) >= 90
              ? "healthy"
              : (profile?.summary.hitRate ?? 0) >= 75
                ? "warning"
                : "critical"
        }
      ];
    }

    if (activeTab === "knowledge") {
      const publishedDocuments = knowledgeDocuments.filter((document) => document.status === "published").length;
      const draftDocuments = Math.max(0, knowledgeDocuments.length - publishedDocuments);
      return [
        {
          label: "Folders",
          value: knowledgeFolders.length,
          status: knowledgeFolders.length > 0 ? "healthy" : "warning"
        },
        {
          label: "Documents",
          value: knowledgeDocuments.length,
          trend: publishedDocuments > 0 ? "up" : "neutral",
          trendValue: `${publishedDocuments} published`,
          trendTone: publishedDocuments > 0 ? "positive" : "neutral",
          status: publishedDocuments > 0 ? "healthy" : "warning"
        },
        {
          label: "Drafts",
          value: draftDocuments,
          status: draftDocuments === 0 ? "healthy" : "warning"
        },
        {
          label: "Search Results",
          value: knowledgeSearchResults.length,
          status: knowledgeSearchResults.length > 0 ? "healthy" : "warning"
        },
        {
          label: "Retrieval Checks",
          value: knowledgeRetrievalEvents.length,
          status: knowledgeRetrievalEvents.length > 0 ? "healthy" : "warning"
        },
        {
          label: "Quarantine",
          value: knowledgeQuarantineEvents.length,
          status: knowledgeQuarantineEvents.length === 0 ? "healthy" : "critical"
        },
        {
          label: "Retention Due",
          value: knowledgeRetentionPreview?.matched ?? 0,
          status: (knowledgeRetentionPreview?.matched ?? 0) === 0 ? "healthy" : "warning"
        }
      ];
    }

    const failedInboundCount = failedInboundEvents.length;
    const failedCallCount = failedCallEvents.length;
    const failedQaCount = failedCallTranscriptAiJobs.length;
    const deadLetterCount = deadLetters.length;
    return [
      {
        label: "Inbound Failures",
        value: failedInboundCount,
        status: failedInboundCount === 0 ? "healthy" : failedInboundCount < 5 ? "warning" : "critical"
      },
      {
        label: "Call Failures",
        value: failedCallCount,
        status: failedCallCount === 0 ? "healthy" : failedCallCount < 5 ? "warning" : "critical"
      },
      {
        label: "QA Failures",
        value: failedQaCount,
        status: failedQaCount === 0 ? "healthy" : failedQaCount < 5 ? "warning" : "critical"
      },
      {
        label: "Dead Letters",
        value: deadLetterCount,
        status: deadLetterCount === 0 ? "healthy" : deadLetterCount < 5 ? "warning" : "critical"
      }
    ];
  }, [
    activeTab,
    agents,
    aiSafety?.summary.blockedPolicyDecisions,
    deadLetters.length,
    failedAgentEvents.length,
    failedCallEvents.length,
    failedCallTranscriptAiJobs.length,
    failedInboundEvents.length,
    failedWhatsAppEvents.length,
    knowledgeDocuments,
    knowledgeFolders.length,
    knowledgeQuarantineEvents.length,
    knowledgeRetentionPreview?.matched,
    knowledgeRetrievalEvents.length,
    knowledgeSearchResults.length,
    mailboxes.length,
    profile?.summary.hitRate,
    roles.length,
    security?.agentIntegrationStats.unencrypted,
    security?.agentSecretKeyConfigured,
    security?.inboundSecretConfigured,
    security?.whatsappTokenStats.unencrypted,
    selectedAgent?.policy_mode,
    spamMessages.length,
    users,
    workspaceModules?.modules
  ]);

  const attentionSignals = useMemo<AttentionSignal[]>(() => {
    if (activeTab === "overview") {
      return [
        {
          healthy: Boolean(security?.agentSecretKeyConfigured),
          severity: "error",
          message: security?.agentSecretKeyConfigured
            ? "Agent secret key is configured."
            : "Agent secret key is missing."
        },
        {
          healthy: Boolean(security?.inboundSecretConfigured),
          severity: "error",
          message: security?.inboundSecretConfigured
            ? "Inbound secret is configured."
            : "Inbound secret is missing."
        },
        {
          healthy: (security?.whatsappTokenStats.unencrypted ?? 0) === 0,
          severity: "warning",
          message:
            (security?.whatsappTokenStats.unencrypted ?? 0) === 0
              ? "WhatsApp tokens are encrypted."
              : `${security?.whatsappTokenStats.unencrypted ?? 0} WhatsApp tokens remain unencrypted.`
        }
      ];
    }

    if (activeTab === "workspace") {
      return [
        {
          healthy: whatsAppStatusWarnings.length === 0,
          severity: "warning",
          message:
            whatsAppStatusWarnings[0] ?? "WhatsApp account settings are complete for the current provider state."
        },
        {
          healthy: failedWhatsAppEvents.length === 0,
          severity: "error",
          message:
            failedWhatsAppEvents.length === 0
              ? "No failed WhatsApp outbox events."
              : `${failedWhatsAppEvents.length} WhatsApp outbox events need retry or review.`
        },
        {
          healthy: spamMessages.length === 0,
          severity: "warning",
          message:
            spamMessages.length === 0
              ? "Spam queue is clear."
              : `${spamMessages.length} spam-flagged messages are waiting for review.`
        }
      ];
    }

    if (activeTab === "automation") {
      return [
        {
          healthy: agents.length > 0,
          severity: "warning",
          message: agents.length > 0 ? "At least one agent integration is configured." : "No agent integration is configured."
        },
        {
          healthy: failedAgentEvents.length === 0,
          severity: "error",
          message:
            failedAgentEvents.length === 0
              ? "No failed automation events."
              : `${failedAgentEvents.length} automation events need retry or operator review.`
        },
        {
          healthy:
            (aiSafety?.summary.maliciousGuardEvents ?? 0) === 0 &&
            (aiSafety?.summary.blockedPolicyDecisions ?? 0) === 0,
          severity: "error",
          message:
            (aiSafety?.summary.maliciousGuardEvents ?? 0) === 0 &&
            (aiSafety?.summary.blockedPolicyDecisions ?? 0) === 0
              ? "No AI safety blocks recorded."
              : `${aiSafety?.summary.maliciousGuardEvents ?? 0} malicious guard events and ${
                  aiSafety?.summary.blockedPolicyDecisions ?? 0
                } blocked policy decisions need review.`
        },
        {
          healthy: (profile?.summary.hitRate ?? 0) >= 90,
          severity: "warning",
          message:
            (profile?.summary.hitRate ?? 0) >= 90
              ? "Profile lookup quality is healthy."
              : `Profile lookup hit rate is ${Math.round(profile?.summary.hitRate ?? 0)}%.`
        }
      ];
    }

    if (activeTab === "knowledge") {
      const publishedDocuments = knowledgeDocuments.filter((document) => document.status === "published").length;
      const unsupportedDocuments = knowledgeDocuments.filter(
        (document) => document.extraction_status !== "completed"
      ).length;
      return [
        {
          healthy: knowledgeIngestionReadiness?.ready === true,
          severity: "error",
          message:
            knowledgeIngestionReadiness?.ready === true
              ? "Knowledge scanner, extractor, and quarantine storage are launch-ready."
              : knowledgeIngestionReadiness
                ? `Knowledge ingestion blockers: ${knowledgeIngestionReadiness.blockers.join(", ")}`
                : "Knowledge ingestion readiness has not loaded."
        },
        {
          healthy: publishedDocuments > 0,
          severity: "warning",
          message:
            publishedDocuments > 0
              ? `${publishedDocuments} knowledge documents are published.`
              : "No published knowledge documents are available for retrieval."
        },
        {
          healthy: unsupportedDocuments === 0,
          severity: "error",
          message:
            unsupportedDocuments === 0
              ? "No failed knowledge extraction jobs."
              : `${unsupportedDocuments} knowledge documents need extraction review.`
        },
        {
          healthy: knowledgeSearchResults.length > 0 || !knowledgeSearchQuery.trim(),
          severity: "warning",
          message:
            knowledgeSearchResults.length > 0 || !knowledgeSearchQuery.trim()
              ? "Knowledge search is ready."
              : "The current knowledge search returned no matching SOP context."
        },
        {
          healthy: knowledgeRetrievalEvents.every((event) => getFilteredUnsafeChunks(event) === 0),
          severity: "warning",
          message: knowledgeRetrievalEvents.some((event) => getFilteredUnsafeChunks(event) > 0)
            ? "Recent retrieval checks filtered unsafe knowledge chunks."
            : "No unsafe retrieval chunks were filtered in recent checks."
        },
        {
          healthy: knowledgeQuarantineEvents.length === 0,
          severity: "error",
          message: knowledgeQuarantineEvents.length === 0
            ? "No quarantined knowledge uploads recorded."
            : `${knowledgeQuarantineEvents.length} recent knowledge uploads were quarantined.`
        },
        {
          healthy: (knowledgeRetentionPreview?.matched ?? 0) === 0,
          severity: "warning",
          message:
            (knowledgeRetentionPreview?.matched ?? 0) === 0
              ? "No knowledge documents are past retention."
              : `${knowledgeRetentionPreview?.matched ?? 0} knowledge documents are past retention.`
        }
      ];
    }

    return [
      {
        healthy: failedInboundEvents.length === 0,
        severity: "error",
        message:
          failedInboundEvents.length === 0
            ? "Inbound queue is clear."
            : `${failedInboundEvents.length} inbound events are waiting for retry.`
      },
      {
        healthy: failedCallEvents.length === 0,
        severity: "error",
        message:
          failedCallEvents.length === 0
            ? "Call outbox is healthy."
            : `${failedCallEvents.length} failed call events need recovery.`
      },
      {
        healthy: failedCallTranscriptAiJobs.length === 0,
        severity: "warning",
        message:
          failedCallTranscriptAiJobs.length === 0
            ? "Transcript QA queue is healthy."
            : `${failedCallTranscriptAiJobs.length} transcript QA jobs failed.`
      }
    ];
  }, [
    activeTab,
    agents.length,
    aiSafety?.summary.blockedPolicyDecisions,
    aiSafety?.summary.maliciousGuardEvents,
    failedAgentEvents.length,
    failedCallEvents.length,
    failedCallTranscriptAiJobs.length,
    failedInboundEvents.length,
    failedWhatsAppEvents.length,
    knowledgeDocuments,
    knowledgeIngestionReadiness,
    knowledgeSearchQuery,
    knowledgeQuarantineEvents.length,
    knowledgeRetrievalEvents,
    knowledgeRetentionPreview?.matched,
    knowledgeSearchResults.length,
    profile?.summary.hitRate,
    security?.agentSecretKeyConfigured,
    security?.inboundSecretConfigured,
    security?.whatsappTokenStats.unencrypted,
    spamMessages.length,
    whatsAppStatusWarnings
  ]);

  const activeTabCopy = TAB_COPY[activeTab];
  const activeTabHealthy = attentionSignals.every((item) => item.healthy);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (!tabParam || !TAB_VALUES.has(tabParam)) return;
    setActiveTab(tabParam as TabKey);
  }, [paramsKey, searchParams]);

  useEffect(() => {
    if (activeTab !== "operations") return;
    const sectionParam = searchParams.get("section");
    if (!sectionParam || !OPERATIONS_SECTION_VALUES.has(sectionParam)) return;
    const section = sectionParam as OperationsSectionKey;
    const target = document.getElementById(`ops-${section}`);
    if (!target) return;
    window.setTimeout(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, [activeTab, loaded.operations, paramsKey, searchParams]);

  useEffect(() => {
    if (activeTab === "overview" && !loaded.overview) {
      void loadOverview();
      return;
    }
    if (activeTab === "workspace" && !loaded.workspace) {
      void loadWorkspace();
      return;
    }
    if (activeTab === "automation" && !loaded.automation) {
      void loadAutomation();
      return;
    }
    if (activeTab === "knowledge" && !loaded.knowledge) {
      void loadKnowledge();
      return;
    }
    if (activeTab === "operations" && !loaded.operations) {
      void loadOperations();
    }
  }, [activeTab, loadAutomation, loadKnowledge, loadOperations, loadOverview, loadWorkspace, loaded]);

  async function saveUser() {
    if (!userForm.email || !userForm.displayName || !userForm.password || !userForm.roleId) {
      setToast({ tone: "error", message: "Complete all user fields." });
      return;
    }
    try {
      await createUser(userForm);
      setUserForm({ email: "", displayName: "", password: "", roleId: roles[0]?.id ?? "" });
      pushSuccess("User saved");
      await loadOverview();
    } catch (error) {
      pushError(error, "Could not save user");
    }
  }

  async function saveSla() {
    try {
      await updateSlaConfig(sla);
      pushSuccess("SLA updated");
      await loadOverview();
    } catch (error) {
      pushError(error, "Could not update SLA");
    }
  }

  async function saveWorkspaceModuleConfig() {
    if (!workspaceModules) {
      setToast({ tone: "error", message: "Workspace modules have not loaded yet." });
      return;
    }
    try {
      const payload = await updateWorkspaceModules(workspaceModules.modules);
      setWorkspaceModules(payload.config);
      pushSuccess("Workspace modules updated");
      await loadWorkspace();
    } catch (error) {
      pushError(error, "Could not update workspace modules");
    }
  }

  async function saveMailbox() {
    const address = mailboxForm.address.trim().toLowerCase();
    const memberEmails = mailboxForm.memberEmails
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    if (!address) {
      setToast({ tone: "error", message: "Mailbox address is required." });
      return;
    }

    try {
      await createAdminMailbox({ address, memberEmails });
      setMailboxForm({ address: "", memberEmails: "" });
      pushSuccess("Mailbox saved");
      await loadWorkspace();
    } catch (error) {
      pushError(error, "Could not save mailbox");
    }
  }

  async function saveTag() {
    if (!tagForm.name.trim()) {
      setToast({ tone: "error", message: "Tag name is required." });
      return;
    }
    try {
      if (tagEditingId) {
        await updateTag(tagEditingId, {
          name: tagForm.name.trim(),
          description: tagForm.description.trim() || null
        });
        pushSuccess("Tag updated");
      } else {
        await createTag({
          name: tagForm.name.trim(),
          description: tagForm.description.trim() || null
        });
        pushSuccess("Tag created");
      }
      resetTagForm();
      await loadWorkspace();
    } catch (error) {
      pushError(error, "Could not save tag");
    }
  }

  async function saveSpamRule() {
    if (!ruleForm.pattern.trim()) {
      setToast({ tone: "error", message: "Spam rule pattern is required." });
      return;
    }
    try {
      if (ruleEditingId) {
        await updateSpamRule(ruleEditingId, {
          pattern: ruleForm.pattern.trim()
        });
        pushSuccess("Spam rule updated");
      } else {
        await createSpamRule({
          ruleType: ruleForm.ruleType,
          scope: ruleForm.scope,
          pattern: ruleForm.pattern.trim()
        });
        pushSuccess("Spam rule created");
      }
      resetRuleForm();
      await loadWorkspace();
    } catch (error) {
      pushError(error, "Could not save spam rule");
    }
  }

  async function saveWhatsAppSettings() {
    if (!whatsAppForm.provider || !whatsAppForm.phoneNumber) {
      setToast({ tone: "error", message: "WhatsApp provider and phone fields are required." });
      return;
    }
    try {
      await saveWhatsAppAccount({
        provider: whatsAppForm.provider,
        phoneNumber: whatsAppForm.phoneNumber,
        wabaId: whatsAppForm.wabaId || null,
        accessToken: whatsAppForm.accessToken || null,
        verifyToken: whatsAppForm.verifyToken || null,
        status: whatsAppForm.status
      });
      pushSuccess("WhatsApp settings saved");
      await loadWorkspace();
    } catch (error) {
      pushError(error, "Could not save WhatsApp settings");
    }
  }

  function resetCallProviderNumberForm() {
    setCallProviderNumberForm(defaultCallProviderNumberForm());
  }

  function editCallProviderNumber(number: CallProviderNumber) {
    setCallProviderNumberForm({
      id: number.id,
      provider: number.provider,
      phoneNumber: number.phoneNumber,
      accountSid: number.accountSid ?? "",
      status:
        number.status === "active" || number.status === "paused" || number.status === "inactive"
          ? number.status
          : "inactive"
    });
  }

  async function saveVoiceProviderNumber() {
    if (!callProviderNumberForm.provider.trim() || !callProviderNumberForm.phoneNumber.trim()) {
      setToast({ tone: "error", message: "Provider and phone number are required." });
      return;
    }

    try {
      await saveCallProviderNumber({
        id: callProviderNumberForm.id || null,
        provider: callProviderNumberForm.provider.trim(),
        phoneNumber: callProviderNumberForm.phoneNumber.trim(),
        accountSid: callProviderNumberForm.accountSid.trim() || null,
        status: callProviderNumberForm.status
      });
      pushSuccess(callProviderNumberForm.id ? "Voice provider number updated" : "Voice provider number added");
      resetCallProviderNumberForm();
      await loadOperations();
    } catch (error) {
      pushError(error, "Could not save voice provider number");
    }
  }

  async function disableVoiceProviderNumber(id: string) {
    const busyKey = `call-provider:${id}`;
    setEventActionBusyKey(busyKey);
    try {
      await deactivateCallProviderNumber(id);
      pushSuccess("Voice provider number disabled");
      if (callProviderNumberForm.id === id) {
        resetCallProviderNumberForm();
      }
      await loadOperations();
    } catch (error) {
      pushError(error, "Could not disable voice provider number");
    } finally {
      setEventActionBusyKey((current) => (current === busyKey ? null : current));
    }
  }

  async function saveWhatsAppTemplateForm() {
    setTemplateError(null);

    let components: Array<Record<string, unknown>> | null = null;
    if (templateForm.componentsJson.trim()) {
      try {
        const parsed = JSON.parse(templateForm.componentsJson);
        components = Array.isArray(parsed) ? parsed : null;
      } catch {
        setTemplateError("Template components JSON is invalid.");
        return;
      }
    }

    const payload = {
      provider: whatsAppForm.provider || "meta",
      name: templateForm.name.trim(),
      language: templateForm.language.trim() || "en_US",
      category: templateForm.category.trim() || null,
      status: templateForm.status,
      components
    };

    if (!payload.name) {
      setTemplateError("Template name is required.");
      return;
    }

    try {
      if (templateEditingId) {
        await updateWhatsAppTemplate(templateEditingId, payload);
      } else {
        await createWhatsAppTemplate(payload);
      }
      pushSuccess(templateEditingId ? "Template updated" : "Template created");
      resetTemplateForm();
      await loadWorkspace();
    } catch (error) {
      pushError(error, "Could not save template");
    }
  }

  async function saveAgent() {
    if (!agentForm.name || !agentForm.baseUrl || !agentForm.sharedSecret) {
      setToast({ tone: "error", message: "Agent name, URL and secret are required." });
      return;
    }
    let policy: Record<string, unknown> | undefined;
    let scopes: Record<string, unknown> | undefined;
    try {
      policy = JSON.parse(agentForm.policyJson || "{}");
    } catch {
      setToast({ tone: "error", message: "Agent policy JSON is invalid." });
      return;
    }
    try {
      scopes = JSON.parse(agentForm.scopesJson || "{}");
    } catch {
      setToast({ tone: "error", message: "Agent scopes JSON is invalid." });
      return;
    }
    const capabilities: Record<string, unknown> = { ...(selectedAgent?.capabilities ?? {}) };
    if (agentForm.maxEventsPerRun.trim()) {
      const parsedLimit = Number(agentForm.maxEventsPerRun);
      if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
        setToast({ tone: "error", message: "Max events per run must be a positive number." });
        return;
      }
      capabilities.max_events_per_run = Math.max(1, Math.min(50, Math.trunc(parsedLimit)));
    } else {
      delete capabilities.max_events_per_run;
    }
    capabilities.allow_merge_actions = agentForm.allowMergeActions;
    capabilities.allow_voice_actions = agentForm.allowVoiceActions;
    try {
      if (selectedAgent) {
        await updateAgentIntegration(selectedAgent.id, {
          name: agentForm.name,
          provider: agentForm.provider,
          baseUrl: agentForm.baseUrl,
          authType: agentForm.authType,
          sharedSecret: agentForm.sharedSecret,
          status: agentForm.status,
          policyMode: agentForm.policyMode,
          scopes,
          capabilities,
          policy
        });
      } else {
        await createAgentIntegration({
          name: agentForm.name,
          provider: agentForm.provider,
          baseUrl: agentForm.baseUrl,
          authType: agentForm.authType,
          sharedSecret: agentForm.sharedSecret,
          status: agentForm.status,
          policyMode: agentForm.policyMode,
          scopes,
          capabilities,
          policy
        });
      }
      pushSuccess("Agent integration saved");
      await loadAutomation();
    } catch (error) {
      pushError(error, "Could not save agent integration");
    }
  }

  async function saveKnowledgeFolder() {
    if (!knowledgeFolderName.trim()) {
      setToast({ tone: "error", message: "Folder name is required." });
      return;
    }
    try {
      await createKnowledgeFolder({ name: knowledgeFolderName.trim() });
      setKnowledgeFolderName("");
      pushSuccess("Knowledge folder saved");
      await loadKnowledge();
    } catch (error) {
      pushError(error, "Could not save knowledge folder");
    }
  }

  async function uploadKnowledgeFile() {
    if (!knowledgeUploadFile) {
      setToast({ tone: "error", message: "Choose a text or Markdown file first." });
      return;
    }
    try {
      await uploadKnowledgeDocument({
        file: knowledgeUploadFile,
        folderId: knowledgeUploadFolderId || null,
        title: knowledgeUploadTitle || null,
        publish: knowledgePublishOnUpload
      });
      setKnowledgeUploadFile(null);
      setKnowledgeUploadTitle("");
      pushSuccess("Knowledge document uploaded");
      await loadKnowledge();
    } catch (error) {
      pushError(error, "Could not upload knowledge document");
    }
  }

  async function publishKnowledgeDocumentNow(documentId: string) {
    try {
      await publishKnowledgeDocument(documentId);
      pushSuccess("Knowledge document published");
      await loadKnowledge();
    } catch (error) {
      pushError(error, "Could not publish knowledge document");
    }
  }

  async function toggleKnowledgeLegalHold(document: KnowledgeDocument) {
    const nextLegalHold = !getLegalHold(document);
    try {
      await setKnowledgeDocumentLegalHold({
        documentId: document.id,
        legalHold: nextLegalHold,
        reason: nextLegalHold ? "Enabled from Admin Knowledge tab" : "Released from Admin Knowledge tab"
      });
      pushSuccess(nextLegalHold ? "Legal hold enabled" : "Legal hold released");
      await loadKnowledge();
    } catch (error) {
      pushError(error, "Could not update legal hold");
    }
  }

  async function downloadKnowledgeExport() {
    try {
      const bundle = await exportKnowledgeBundle({
        includeDeleted: false,
        includeBodyText: true,
        limit: 200
      });
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json"
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `6esk-knowledge-export-${bundle.generatedAt.slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      pushSuccess(`Knowledge export created with ${bundle.documentCount} documents`);
    } catch (error) {
      pushError(error, "Could not export knowledge base");
    }
  }

  async function runKnowledgeSearch() {
    if (!knowledgeSearchQuery.trim()) {
      setToast({ tone: "error", message: "Enter a knowledge search query." });
      return;
    }
    try {
      const payload = await searchKnowledge({ query: knowledgeSearchQuery.trim(), limit: 5 });
      setKnowledgeSearchResults(payload.results ?? []);
      const [retrievalEvents, quarantineEvents, retentionPreview] = await Promise.all([
        listKnowledgeRetrievalEvents(20),
        listKnowledgeQuarantineEvents(20),
        previewKnowledgeRetention(100)
      ]);
      setKnowledgeRetrievalEvents(retrievalEvents);
      setKnowledgeQuarantineEvents(quarantineEvents);
      setKnowledgeRetentionPreview(retentionPreview);
    } catch (error) {
      pushError(error, "Could not search knowledge");
    }
  }

  async function runKnowledgeRetentionNow() {
    try {
      const result = await runKnowledgeRetention(100);
      pushSuccess(`Knowledge retention removed ${result.deleted} expired documents`);
      await loadKnowledge();
    } catch (error) {
      pushError(error, "Could not run knowledge retention");
    }
  }

  async function retryInboundEventNow(eventId: string) {
    const busyKey = `inbound:${eventId}`;
    setEventActionBusyKey(busyKey);
    try {
      const result = await retryInboundEvents(1, [eventId]);
      if (result.retried > 0) {
        pushSuccess("Inbound event queued for retry");
      } else {
        setToast({ tone: "error", message: "Inbound event is no longer retryable." });
      }
      await loadOperations();
    } catch (error) {
      pushError(error, "Could not retry inbound event");
    } finally {
      setEventActionBusyKey((prev) => (prev === busyKey ? null : prev));
    }
  }

  async function retryFailedCallEventNow(eventId: string) {
    const busyKey = `call:${eventId}`;
    setEventActionBusyKey(busyKey);
    try {
      const result = await retryFailedCallEvents(1, [eventId]);
      if (result.retried > 0) {
        pushSuccess("Call outbox event queued for retry");
      } else {
        setToast({ tone: "error", message: "Call event is no longer retryable." });
      }
      await loadOperations();
    } catch (error) {
      pushError(error, "Could not retry call event");
    } finally {
      setEventActionBusyKey((prev) => (prev === busyKey ? null : prev));
    }
  }

  async function retryFailedCallTranscriptAiJobNow(jobId: string) {
    const busyKey = `call-ai:${jobId}`;
    setEventActionBusyKey(busyKey);
    try {
      const result = await retryFailedCallTranscriptAiJobs(1, [jobId]);
      if (result.retried > 0) {
        pushSuccess("Call transcript QA job queued for retry");
      } else {
        setToast({ tone: "error", message: "Transcript QA job is no longer retryable." });
      }
      await loadOperations();
    } catch (error) {
      pushError(error, "Could not retry transcript QA job");
    } finally {
      setEventActionBusyKey((prev) => (prev === busyKey ? null : prev));
    }
  }

  async function runTranscriptQaRetryDrill() {
    const candidate = failedCallTranscriptAiJobs[0];
    if (!candidate) {
      setToast({
        tone: "error",
        message: "No failed transcript QA job is available for the drill."
      });
      return;
    }

    const busyKey = "call-ai:drill";
    setEventActionBusyKey(busyKey);
    try {
      const retryResult = await retryFailedCallTranscriptAiJobs(1, [candidate.id]);
      if (retryResult.retried < 1) {
        setToast({
          tone: "error",
          message: "Transcript QA drill could not queue the selected failed job."
        });
        await loadOperations();
        return;
      }

      const deliverResult = await runCallTranscriptAiOutbox(1);
      pushSuccess(
        `Transcript QA drill ran for ${candidate.callSessionId}. Retried ${retryResult.retried} job and executed ${deliverResult.delivered} analysis pass.`
      );
      await loadOperations();
    } catch (error) {
      pushError(error, "Could not run transcript QA retry drill");
    } finally {
      setEventActionBusyKey((prev) => (prev === busyKey ? null : prev));
    }
  }

  async function retryFailedWhatsAppEventNow(eventId: string) {
    const busyKey = `whatsapp:${eventId}`;
    setEventActionBusyKey(busyKey);
    try {
      const result = await retryFailedWhatsAppOutboxEvents(1, [eventId]);
      if (result.retried > 0) {
        pushSuccess("WhatsApp outbox event queued for retry");
      } else {
        setToast({ tone: "error", message: "WhatsApp event is no longer retryable." });
      }
      await loadWorkspace();
    } catch (error) {
      pushError(error, "Could not retry WhatsApp event");
    } finally {
      setEventActionBusyKey((prev) => (prev === busyKey ? null : prev));
    }
  }

  async function retryFailedAgentEventNow(eventId: string) {
    if (!selectedAgent?.id) return;
    const busyKey = `agent:${eventId}`;
    setEventActionBusyKey(busyKey);
    try {
      const result = await retryFailedAgentOutboxEvents(selectedAgent.id, 1, [eventId]);
      if (result.retried > 0) {
        pushSuccess("Agent outbox event queued for retry");
      } else {
        setToast({ tone: "error", message: "Agent event is no longer retryable." });
      }
      await loadAutomation();
    } catch (error) {
      pushError(error, "Could not retry agent event");
    } finally {
      setEventActionBusyKey((prev) => (prev === busyKey ? null : prev));
    }
  }

  return (
    <AppShell>
      <div className="h-full bg-neutral-50 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-neutral-900">Admin</h1>
              <p className="text-sm text-neutral-600 mt-1">
                Reconnected admin surfaces for users, messaging controls, automation, and operations.
              </p>
            </div>
            <Button variant="outline" className="gap-2" onClick={() => void refreshTab()}>
              <RefreshCw className={loading[activeTab] ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
              Refresh Tab
            </Button>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.35fr_0.8fr]">
            <Card className="border-neutral-200 bg-white">
              <CardHeader className="space-y-3 pb-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge
                        status={activeTabHealthy ? "active" : activeTab === "operations" ? "failed" : "pending"}
                        label={activeTabCopy.statusLabel}
                      />
                      {loaded[activeTab] ? (
                        <Badge variant="outline">Live state loaded</Badge>
                      ) : (
                        <Badge variant="outline">Loading current tab</Badge>
                      )}
                    </div>
                    <CardTitle>{activeTabCopy.title}</CardTitle>
                    <CardDescription>{activeTabCopy.description}</CardDescription>
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-right">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-neutral-500">Current zone</div>
                    <div className="mt-1 text-lg font-semibold text-neutral-900">{TAB_COPY[activeTab].statusLabel}</div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {summaryMetrics.map((metric) => (
                  <MetricCard
                    key={metric.label}
                    label={metric.label}
                    value={metric.value}
                    unit={metric.unit}
                    trend={metric.trend}
                    trendValue={metric.trendValue}
                    trendTone={metric.trendTone}
                    status={metric.status}
                    size="sm"
                  />
                ))}
              </CardContent>
            </Card>

            <Card className="border-neutral-200 bg-white">
              <CardHeader className="pb-4">
                <CardTitle>Needs attention</CardTitle>
                <CardDescription>
                  Surface the current risks first, then use the tab content below to act on them.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {attentionSignals.map((item) => (
                  <HealthIndicator
                    key={item.message}
                    healthy={item.healthy}
                    severity={item.severity}
                    message={item.message}
                    size="sm"
                  />
                ))}
              </CardContent>
            </Card>
          </div>

          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList className="h-auto flex-wrap gap-1 rounded-2xl border border-neutral-200 bg-white p-1">
              <TabsTrigger value="overview" className="gap-2">
                <Shield className="w-4 h-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="workspace" className="gap-2">
                <Workflow className="w-4 h-4" />
                Messaging
              </TabsTrigger>
              <TabsTrigger value="knowledge" className="gap-2">
                <BookOpen className="w-4 h-4" />
                Knowledge
              </TabsTrigger>
              <TabsTrigger value="automation" className="gap-2">
                <Bot className="w-4 h-4" />
                Automation
              </TabsTrigger>
              <TabsTrigger value="operations" className="gap-2">
                <Phone className="w-4 h-4" />
                Operations
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Users & Roles</CardTitle>
                  <CardDescription>Create users and manage status/role assignments.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <Input
                      placeholder="Email"
                      value={userForm.email}
                      onChange={(event) => setUserForm((prev) => ({ ...prev, email: event.target.value }))}
                    />
                    <Input
                      placeholder="Display name"
                      value={userForm.displayName}
                      onChange={(event) => setUserForm((prev) => ({ ...prev, displayName: event.target.value }))}
                    />
                    <Input
                      type="password"
                      placeholder="Password"
                      value={userForm.password}
                      onChange={(event) => setUserForm((prev) => ({ ...prev, password: event.target.value }))}
                    />
                    <select
                      className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                      value={userForm.roleId}
                      onChange={(event) => setUserForm((prev) => ({ ...prev, roleId: event.target.value }))}
                    >
                      <option value="">Select role</option>
                      {roles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {role.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={() => void saveUser()}>Create / Update User</Button>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-neutral-200">
                    <table className="w-full text-sm">
                      <thead className="bg-neutral-100/70">
                        <tr>
                          <th className="text-left px-3 py-2">User</th>
                          <th className="text-left px-3 py-2">Role</th>
                          <th className="text-left px-3 py-2">Status</th>
                          <th className="text-left px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((user) => (
                          <tr key={user.id} className="border-t border-neutral-200">
                            <td className="px-3 py-2">
                              <div className="font-medium text-neutral-900">{user.display_name}</div>
                              <div className="text-xs text-neutral-600">{user.email}</div>
                            </td>
                            <td className="px-3 py-2">
                              <select
                                className="h-8 rounded-md border border-neutral-200 bg-white px-2 text-xs"
                                value={user.role_id ?? ""}
                                onChange={(event) =>
                                  void updateUser(user.id, { roleId: event.target.value })
                                    .then(loadOverview)
                                    .catch((error) => pushError(error, "Could not update user role"))
                                }
                              >
                                {roles.map((role) => (
                                  <option key={role.id} value={role.id}>
                                    {role.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                variant={user.is_active ? "outline" : "secondary"}
                                size="sm"
                                onClick={() =>
                                  void updateUser(user.id, { isActive: !user.is_active })
                                    .then(loadOverview)
                                    .catch((error) => pushError(error, "Could not update user status"))
                                }
                              >
                                {user.is_active ? "Active" : "Inactive"}
                              </Button>
                            </td>
                            <td className="px-3 py-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  void requestPasswordResetLink(user.id)
                                    .then(async (payload) => {
                                      try {
                                        await navigator.clipboard.writeText(payload.resetLink);
                                        pushSuccess("Password reset link copied");
                                      } catch {
                                        pushSuccess(`Password reset link ready: ${payload.resetLink}`);
                                      }
                                    })
                                    .catch((error) => pushError(error, "Could not generate reset link"))
                                }
                              >
                                Reset link
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>SLA Targets</CardTitle>
                    <CardDescription>Set first response and resolution targets.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Input
                      type="number"
                      min={1}
                      value={sla.firstResponseMinutes}
                      onChange={(event) => setSla((prev) => ({ ...prev, firstResponseMinutes: Number(event.target.value) }))}
                    />
                    <Input
                      type="number"
                      min={1}
                      value={sla.resolutionMinutes}
                      onChange={(event) => setSla((prev) => ({ ...prev, resolutionMinutes: Number(event.target.value) }))}
                    />
                    <Button onClick={() => void saveSla()}>Save SLA</Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Security Snapshot</CardTitle>
                    <CardDescription>Environment and secret posture checks.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <Metric label="Client IP" value={security?.clientIp ?? "unknown"} />
                      <Metric label="Agent Integrations" value={security?.agentIntegrationStats.total ?? 0} />
                      <Metric label="Encrypted Agent Secrets" value={security?.agentIntegrationStats.encrypted ?? 0} />
                      <Metric label="Encrypted WA Tokens" value={security?.whatsappTokenStats.encrypted ?? 0} />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={security?.agentSecretKeyConfigured ? "secondary" : "outline"}>
                        Agent secret key {security?.agentSecretKeyConfigured ? "configured" : "missing"}
                      </Badge>
                      <Badge variant={security?.inboundSecretConfigured ? "secondary" : "outline"}>
                        Inbound secret {security?.inboundSecretConfigured ? "configured" : "missing"}
                      </Badge>
                      <Badge variant="outline">
                        Unencrypted agent secrets {security?.agentIntegrationStats.unencrypted ?? 0}
                      </Badge>
                      <Badge variant="outline">
                        Missing WA tokens {security?.whatsappTokenStats.missing ?? 0}
                      </Badge>
                    </div>
                    <div className="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600 space-y-2">
                      <p>Admin allowlist: {(security?.adminAllowlist ?? []).join(", ") || "not configured"}</p>
                      <p>Agent allowlist: {(security?.agentAllowlist ?? []).join(", ") || "not configured"}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="workspace" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Workspace Modules</CardTitle>
                  <CardDescription>
                    Runtime entitlements for channel and orchestration capabilities. Core admin, ops, and analytics remain available outside these toggles.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {WORKSPACE_MODULE_FIELDS.map((field) => (
                      <label
                        key={field.key}
                        className="flex items-start gap-3 rounded-lg border border-neutral-200 p-4"
                      >
                        <Checkbox
                          checked={workspaceModules?.modules[field.key] === true}
                          disabled={!workspaceModules}
                          onCheckedChange={(checked) =>
                            setWorkspaceModules((previous) =>
                              previous
                                ? {
                                    ...previous,
                                    modules: {
                                      ...previous.modules,
                                      [field.key]: checked === true
                                    }
                                  }
                                : previous
                            )
                          }
                        />
                        <span>
                          <span className="flex items-center gap-2 text-sm font-medium text-neutral-900">
                            {field.label}
                            <Badge variant={field.billing === "included" ? "secondary" : "outline"}>
                              {field.billing === "included" ? "Included" : "Billable"}
                            </Badge>
                          </span>
                          <span className="mt-1 block text-xs text-neutral-600">
                            {field.description}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={() => void saveWorkspaceModuleConfig()} disabled={!workspaceModules}>
                      Save Modules
                    </Button>
                    <p className="text-xs text-neutral-500">
                      Updated {workspaceModules?.updatedAt ? formatDate(workspaceModules.updatedAt) : "never"}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Module Usage (30 days)</CardTitle>
                  <CardDescription>
                    Lean pilot metering for billable modules and AI runtime actions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {(workspaceUsage?.modules ?? []).map((moduleUsage) => {
                      const moduleField = WORKSPACE_MODULE_FIELDS.find(
                        (field) => field.key === moduleUsage.moduleKey
                      );
                      return (
                        <div
                          key={moduleUsage.moduleKey}
                          className="rounded-lg border border-neutral-200 p-4 space-y-2"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-neutral-900">
                                {moduleField?.label ?? moduleUsage.moduleKey}
                              </p>
                              <p className="text-xs text-neutral-500">
                                {moduleUsage.totalQuantity} events · {moduleUsage.eventCount} writes
                              </p>
                            </div>
                            <Badge
                              variant={moduleField?.billing === "included" ? "secondary" : "outline"}
                            >
                              {moduleField?.billing === "included" ? "Included" : "Billable"}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs">
                            <Badge variant="outline">Human {moduleUsage.actorBreakdown.human}</Badge>
                            <Badge variant="outline">AI {moduleUsage.actorBreakdown.ai}</Badge>
                            <Badge variant="outline">System {moduleUsage.actorBreakdown.system}</Badge>
                          </div>
                          <div className="space-y-1 text-xs text-neutral-600">
                            {(moduleUsage.usageKinds.length ? moduleUsage.usageKinds : [{ usageKind: "No events yet", quantity: 0, eventCount: 0 }]).slice(0, 3).map((kind) => (
                              <div
                                key={`${moduleUsage.moduleKey}-${kind.usageKind}`}
                                className="flex items-center justify-between gap-3"
                              >
                                <span className="truncate">{kind.usageKind}</span>
                                <span className="text-neutral-500">{kind.quantity}</span>
                              </div>
                            ))}
                          </div>
                          <p className="text-[11px] text-neutral-500">
                            Last seen {formatDate(moduleUsage.lastSeenAt)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-neutral-500">
                    Generated {formatDate(workspaceUsage?.generatedAt)} for the last{" "}
                    {workspaceUsage?.windowDays ?? 30} days.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Platform Mailboxes</CardTitle>
                  <CardDescription>
                    Shared inboxes owned inside 6esk. Personal mailboxes are created automatically when admins create users.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg border border-neutral-200 p-4 space-y-3">
                    <div>
                      <p className="text-sm font-medium text-neutral-900">Create or update platform mailbox</p>
                      <p className="mt-1 text-xs text-neutral-600">
                        Re-save the same address to replace member access. Use comma-separated user emails for inbox membership.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-[0.8fr_1.2fr] gap-2">
                      <Input
                        value={mailboxForm.address}
                        onChange={(event) =>
                          setMailboxForm((previous) => ({ ...previous, address: event.target.value }))
                        }
                        placeholder="support@6ex.co.za"
                      />
                      <Input
                        value={mailboxForm.memberEmails}
                        onChange={(event) =>
                          setMailboxForm((previous) => ({ ...previous, memberEmails: event.target.value }))
                        }
                        placeholder="agent1@6ex.co.za, agent2@6ex.co.za"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => void saveMailbox()}>Save Mailbox</Button>
                      <Button
                        variant="outline"
                        onClick={() => setMailboxForm({ address: "", memberEmails: "" })}
                      >
                        Reset
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {mailboxes.map((mailbox) => (
                      <div
                        key={mailbox.id}
                        className="rounded-lg border border-neutral-200 p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-neutral-900">{mailbox.address}</p>
                            <p className="text-xs text-neutral-500">
                              Created {formatDate(mailbox.created_at)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={mailbox.type === "platform" ? "outline" : "secondary"}>
                              {mailbox.type}
                            </Badge>
                            {mailbox.owner_email ? (
                              <Badge variant="secondary">{mailbox.owner_email}</Badge>
                            ) : null}
                          </div>
                        </div>
                        <p className="text-xs text-neutral-600">
                          Members:{" "}
                          {mailbox.members.length
                            ? mailbox.members.map((member) => member.email).join(", ")
                            : mailbox.type === "platform"
                              ? "Lead admins only until members are added."
                              : "Owner mailbox"}
                        </p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Tags</CardTitle>
                    <CardDescription>Create, describe, and maintain reusable support tags.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-lg border border-neutral-200 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-neutral-900">
                            {tagEditingId ? "Edit tag" : "New tag"}
                          </p>
                          <p className="text-xs text-neutral-600">
                            Keep naming and description standards in Admin instead of ad hoc prompts.
                          </p>
                        </div>
                        {tagEditingId ? (
                          <Button variant="ghost" size="sm" onClick={resetTagForm}>
                            Cancel
                          </Button>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-[0.85fr_1.15fr] gap-2">
                        <Input
                          value={tagForm.name}
                          onChange={(event) =>
                            setTagForm((prev) => ({ ...prev, name: event.target.value }))
                          }
                          placeholder="vip-customer"
                        />
                        <Input
                          value={tagForm.description}
                          onChange={(event) =>
                            setTagForm((prev) => ({ ...prev, description: event.target.value }))
                          }
                          placeholder="Description shown to admins and agents"
                        />
                      </div>

                      <div className="flex gap-2">
                        <Button onClick={() => void saveTag()}>
                          {tagEditingId ? "Save Tag" : "Create Tag"}
                        </Button>
                        {!tagEditingId ? (
                          <Button variant="outline" onClick={resetTagForm}>
                            Reset
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {tags.map((tag) => (
                        <div key={tag.id} className="flex items-start justify-between rounded-lg border border-neutral-200 p-3 gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-neutral-900">{tag.name}</p>
                            <p className="mt-1 text-xs text-neutral-600">
                              {tag.description?.trim() ? tag.description : "No description yet."}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => startTagEdit(tag)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                void deleteTag(tag.id)
                                  .then(() => {
                                    if (tagEditingId === tag.id) {
                                      resetTagForm();
                                    }
                                    return loadWorkspace();
                                  })
                                  .catch((error) => pushError(error, "Could not delete tag"))
                              }
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Spam Rules</CardTitle>
                    <CardDescription>Create and toggle spam filtering patterns.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-lg border border-neutral-200 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-neutral-900">
                            {ruleEditingId ? "Edit spam rule" : "New spam rule"}
                          </p>
                          <p className="text-xs text-neutral-600">
                            Tune allow/block patterns without leaving the unified Admin surface.
                          </p>
                        </div>
                        {ruleEditingId ? (
                          <Button variant="ghost" size="sm" onClick={resetRuleForm}>
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <select
                          className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
                          value={ruleForm.ruleType}
                          onChange={(event) => setRuleForm((prev) => ({ ...prev, ruleType: event.target.value as "allow" | "block" }))}
                        >
                          <option value="block">Block</option>
                          <option value="allow">Allow</option>
                        </select>
                        <select
                          className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
                          value={ruleForm.scope}
                          onChange={(event) => setRuleForm((prev) => ({ ...prev, scope: event.target.value as "sender" | "domain" | "subject" | "body" }))}
                        >
                          <option value="sender">Sender</option>
                          <option value="domain">Domain</option>
                          <option value="subject">Subject</option>
                          <option value="body">Body</option>
                        </select>
                        <Input value={ruleForm.pattern} onChange={(event) => setRuleForm((prev) => ({ ...prev, pattern: event.target.value }))} placeholder="pattern" />
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={() => void saveSpamRule()}>
                          {ruleEditingId ? "Save Rule" : "Create Rule"}
                        </Button>
                        {!ruleEditingId ? (
                          <Button variant="outline" onClick={resetRuleForm}>
                            Reset
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {spamRules.map((rule) => (
                        <div key={rule.id} className="rounded-lg border border-neutral-200 p-2 text-sm flex items-center justify-between gap-2">
                          <span>{rule.rule_type}:{rule.scope} · {rule.pattern}</span>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => startRuleEdit(rule)}>Edit</Button>
                            <Button variant="outline" size="sm" onClick={() => void updateSpamRule(rule.id, { isActive: !rule.is_active }).then(loadWorkspace)}>Toggle</Button>
                            <Button variant="ghost" size="sm" onClick={() => void deleteSpamRule(rule.id).then(loadWorkspace)}>Delete</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>WhatsApp & Spam Queue</CardTitle>
                  <CardDescription>Outbound setup, templates, and spam review.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <select
                          className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                          value={whatsAppForm.provider}
                          onChange={(event) =>
                            setWhatsAppForm((prev) => ({ ...prev, provider: event.target.value }))
                          }
                        >
                          <option value="meta">Meta Cloud API</option>
                          <option value="twilio">Twilio</option>
                          <option value="messagebird">MessageBird</option>
                        </select>
                        <Input
                          value={whatsAppForm.phoneNumber}
                          onChange={(event) =>
                            setWhatsAppForm((prev) => ({ ...prev, phoneNumber: event.target.value }))
                          }
                          placeholder={whatsAppForm.provider === "meta" ? "phone number ID" : "phone number"}
                        />
                        <select
                          className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                          value={whatsAppForm.status}
                          onChange={(event) =>
                            setWhatsAppForm((prev) => ({
                              ...prev,
                              status: event.target.value as "active" | "paused" | "inactive"
                            }))
                          }
                        >
                          <option value="inactive">Inactive</option>
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                        </select>
                        <Input
                          value={whatsAppForm.wabaId}
                          onChange={(event) =>
                            setWhatsAppForm((prev) => ({ ...prev, wabaId: event.target.value }))
                          }
                          placeholder="WABA ID"
                        />
                        <div className="md:col-span-2 flex gap-2">
                          <Input
                            type={showWhatsAppAccessToken ? "text" : "password"}
                            value={whatsAppForm.accessToken}
                            onChange={(event) =>
                              setWhatsAppForm((prev) => ({ ...prev, accessToken: event.target.value }))
                            }
                            placeholder="Access token"
                          />
                          <Button
                            variant="outline"
                            onClick={() => setShowWhatsAppAccessToken((prev) => !prev)}
                          >
                            {showWhatsAppAccessToken ? "Hide" : "Show"}
                          </Button>
                        </div>
                        <div className="md:col-span-2 flex gap-2">
                          <Input
                            value={whatsAppForm.verifyToken}
                            onChange={(event) =>
                              setWhatsAppForm((prev) => ({ ...prev, verifyToken: event.target.value }))
                            }
                            placeholder="Verify token"
                          />
                          <Button variant="outline" onClick={generateVerifyToken}>
                            Generate
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => void copyToClipboard(whatsAppForm.verifyToken, "Verify token")}
                          >
                            Copy
                          </Button>
                        </div>
                        <div className="md:col-span-3 flex gap-2">
                          <Input value={whatsAppWebhookUrl} readOnly placeholder="Webhook URL" />
                          <Button
                            variant="outline"
                            onClick={() => void copyToClipboard(whatsAppWebhookUrl, "Webhook URL")}
                          >
                            Copy
                          </Button>
                        </div>
                      </div>

                      {whatsAppStatusWarnings.length > 0 ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
                          {whatsAppStatusWarnings.map((warning) => (
                            <p key={warning}>{warning}</p>
                          ))}
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-2">
                        <Button onClick={() => void saveWhatsAppSettings()}>Save WhatsApp</Button>
                        <Button variant="outline" onClick={() => void runWhatsAppOutbox(25).then(loadWorkspace)}>
                          Run WA Outbox
                        </Button>
                        <Button variant="outline" onClick={() => void loadWorkspace()}>
                          Refresh WA
                        </Button>
                        {whatsAppOutbox?.account?.id ? (
                          <Badge variant="outline">Account {whatsAppOutbox.account.id}</Badge>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Metric label="Queued" value={whatsAppOutbox?.queue.queued ?? 0} />
                        <Metric label="Due Now" value={whatsAppOutbox?.queue.dueNow ?? 0} />
                        <Metric label="Processing" value={whatsAppOutbox?.queue.processing ?? 0} />
                        <Metric label="Failed" value={whatsAppOutbox?.queue.failed ?? 0} />
                      </div>

                      <div className="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600 space-y-1">
                        <p>Provider: {whatsAppOutbox?.account?.provider ?? whatsAppForm.provider}</p>
                        <p>Last sent: {formatDate(whatsAppOutbox?.queue.lastSentAt ?? null)}</p>
                        <p>Next attempt: {formatDate(whatsAppOutbox?.queue.nextAttemptAt ?? null)}</p>
                        {whatsAppOutbox?.queue.lastError ? (
                          <p className="text-red-600">Last outbox error: {whatsAppOutbox.queue.lastError}</p>
                        ) : null}
                      </div>

                      <div className="space-y-2 max-h-56 overflow-y-auto">
                        {failedWhatsAppEvents.length === 0 ? (
                          <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                            No failed WhatsApp outbox events.
                          </div>
                        ) : (
                          failedWhatsAppEvents.map((event) => {
                            const busyKey = `whatsapp:${event.id}`;
                            const isBusy = eventActionBusyKey === busyKey;
                            const payloadTo =
                              typeof event.payload?.to === "string" ? event.payload.to : "unknown recipient";
                            return (
                              <div key={event.id} className="rounded-md border border-neutral-200 p-2 text-xs">
                                <p className="font-medium text-neutral-900">{payloadTo}</p>
                                <p className="text-neutral-600">
                                  {event.status} • Attempts {event.attempt_count} • Next{" "}
                                  {formatDate(event.next_attempt_at)}
                                </p>
                                <p className="mt-1 text-neutral-500">{event.last_error ?? "No error detail"}</p>
                                <div className="mt-2 flex items-center gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={isBusy}
                                    onClick={() => void retryFailedWhatsAppEventNow(event.id)}
                                  >
                                    {isBusy ? "Retrying..." : "Retry now"}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void copyToClipboard(event.id, "WhatsApp event ID")}
                                  >
                                    Copy ID
                                  </Button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="rounded-lg border border-neutral-200 p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-neutral-900">
                              {templateEditingId ? "Edit template" : "New template"}
                            </p>
                            <p className="text-xs text-neutral-600">
                              Maintain active WhatsApp templates without leaving Admin.
                            </p>
                          </div>
                          {templateEditingId ? (
                            <Button variant="ghost" size="sm" onClick={resetTemplateForm}>
                              Cancel
                            </Button>
                          ) : null}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <Input
                            value={templateForm.name}
                            onChange={(event) =>
                              setTemplateForm((prev) => ({ ...prev, name: event.target.value }))
                            }
                            placeholder="Template name"
                          />
                          <Input
                            value={templateForm.language}
                            onChange={(event) =>
                              setTemplateForm((prev) => ({ ...prev, language: event.target.value }))
                            }
                            placeholder="Language"
                          />
                          <Input
                            value={templateForm.category}
                            onChange={(event) =>
                              setTemplateForm((prev) => ({ ...prev, category: event.target.value }))
                            }
                            placeholder="Category"
                          />
                          <select
                            className="h-9 rounded-md border border-neutral-200 bg-white px-3 text-sm"
                            value={templateForm.status}
                            onChange={(event) =>
                              setTemplateForm((prev) => ({
                                ...prev,
                                status: event.target.value as "active" | "paused"
                              }))
                            }
                          >
                            <option value="active">Active</option>
                            <option value="paused">Paused</option>
                          </select>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-neutral-600">Components JSON</label>
                            <Button variant="ghost" size="sm" onClick={formatComponentsJson}>
                              Format JSON
                            </Button>
                          </div>
                          <Textarea
                            rows={6}
                            className="font-mono text-xs"
                            value={templateForm.componentsJson}
                            onChange={(event) =>
                              setTemplateForm((prev) => ({ ...prev, componentsJson: event.target.value }))
                            }
                            placeholder='[{"type":"body","parameters":[{"type":"text","text":"{{1}}"}]}]'
                          />
                        </div>

                        {templateError ? <p className="text-xs text-red-600">{templateError}</p> : null}

                        <div className="flex gap-2">
                          <Button onClick={() => void saveWhatsAppTemplateForm()}>
                            {templateEditingId ? "Update Template" : "Create Template"}
                          </Button>
                          {!templateEditingId ? (
                            <Button variant="outline" onClick={resetTemplateForm}>
                              Reset
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {whatsAppTemplates.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-neutral-200 p-4 text-sm text-neutral-500">
                          No WhatsApp templates saved yet.
                        </div>
                      ) : (
                        whatsAppTemplates.map((template) => (
                          <div key={template.id} className="rounded-lg border border-neutral-200 p-3 text-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-medium text-neutral-900">
                                  {template.name} ({template.language})
                                </p>
                                <p className="mt-1 text-xs text-neutral-600">
                                  {template.category ? `Category: ${template.category} · ` : ""}
                                  Status: {template.status}
                                  {template.components ? ` · Params: ${getTemplateParamCount(template)}` : ""}
                                </p>
                              </div>
                              <Badge variant="outline">{template.status}</Badge>
                            </div>
                            <div className="mt-3 flex gap-2">
                              <Button variant="outline" size="sm" onClick={() => startTemplateEdit(template)}>
                                Edit
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  void updateWhatsAppTemplate(template.id, {
                                    status: template.status === "active" ? "paused" : "active"
                                  })
                                    .then(() => {
                                      pushSuccess("Template status updated");
                                      return loadWorkspace();
                                    })
                                    .catch((error) => pushError(error, "Could not update template"))
                                }
                              >
                                Toggle
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  void deleteWhatsAppTemplate(template.id)
                                    .then(() => {
                                      pushSuccess("Template deleted");
                                      return loadWorkspace();
                                    })
                                    .catch((error) => pushError(error, "Could not delete template"))
                                }
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {spamMessages.map((message) => (
                        <div key={message.id} className="rounded-md border border-neutral-200 p-3 text-xs">
                          <p className="font-medium text-neutral-900">{message.subject ?? "(no subject)"}</p>
                          <p className="mt-1 text-neutral-600">{message.from_email}</p>
                          <p className="mt-1 text-neutral-500">{message.mailbox_address}</p>
                          {message.spam_reason ? (
                            <p className="mt-2 text-red-600">{message.spam_reason}</p>
                          ) : null}
                          <div className="mt-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void setMessageSpamStatus(message.id, { isSpam: false })
                                  .then(() => {
                                    pushSuccess("Message removed from spam");
                                    return loadWorkspace();
                                  })
                                  .catch((error) => pushError(error, "Could not update spam status"))
                              }
                            >
                              Mark Not Spam
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="knowledge" className="space-y-6">
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>Ingestion Readiness</CardTitle>
                      <CardDescription>Scanner, extractor, and quarantine storage configuration for SOP uploads.</CardDescription>
                    </div>
                    <Badge variant={knowledgeIngestionReadiness?.ready ? "outline" : "destructive"}>
                      {knowledgeIngestionReadiness?.ready ? "Ready" : "Blocked"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div className="rounded-md border border-neutral-200 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Scanner</p>
                      <p className="mt-1 font-medium text-neutral-900">
                        {knowledgeIngestionReadiness?.scanner.status ?? "not_loaded"}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        {knowledgeIngestionReadiness?.scanner.required ? "Required" : "Optional"} ·{" "}
                        {knowledgeIngestionReadiness?.scanner.timeoutMs ?? 0}ms timeout
                      </p>
                    </div>
                    <div className="rounded-md border border-neutral-200 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Extractor</p>
                      <p className="mt-1 font-medium text-neutral-900">
                        {knowledgeIngestionReadiness?.extractor.status ?? "not_loaded"}
                      </p>
                      <p className="mt-1 text-xs text-neutral-500">
                        PDF, DOC, DOCX · {knowledgeIngestionReadiness?.extractor.timeoutMs ?? 0}ms timeout
                      </p>
                    </div>
                    <div className="rounded-md border border-neutral-200 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Quarantine Storage</p>
                      <p className="mt-1 font-medium text-neutral-900">
                        {knowledgeIngestionReadiness?.quarantineStorage.status ?? "not_loaded"}
                      </p>
                      <p className="mt-1 break-all text-xs text-neutral-500">
                        {knowledgeIngestionReadiness?.quarantineStorage.prefix ?? "No prefix loaded"}
                      </p>
                    </div>
                  </div>
                  {knowledgeIngestionReadiness && knowledgeIngestionReadiness.blockers.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {knowledgeIngestionReadiness.blockers.map((blocker) => (
                        <Badge key={blocker} variant="destructive">
                          {blocker}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {knowledgeIngestionReadiness && knowledgeIngestionReadiness.warnings.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {knowledgeIngestionReadiness.warnings.map((warning) => (
                        <Badge key={warning} variant="secondary">
                          {warning}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-[0.9fr_1.1fr] gap-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Knowledge Folders</CardTitle>
                    <CardDescription>Organize tenant SOPs and business context before publishing.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <Input
                        value={knowledgeFolderName}
                        onChange={(event) => setKnowledgeFolderName(event.target.value)}
                        placeholder="Folder name"
                      />
                      <Button onClick={() => void saveKnowledgeFolder()}>Create</Button>
                    </div>
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {knowledgeFolders.length === 0 ? (
                        <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                          No folders yet.
                        </div>
                      ) : (
                        knowledgeFolders.map((folder) => (
                          <div key={folder.id} className="rounded-md border border-neutral-200 p-3">
                            <div className="text-sm font-medium text-neutral-900">{folder.name}</div>
                            <div className="mt-1 text-xs text-neutral-500">
                              {folder.parent_id ? "Nested folder" : "Root folder"} · {formatDate(folder.updated_at)}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Upload Knowledge</CardTitle>
                    <CardDescription>Text, Markdown, PDF, DOC, and DOCX are accepted when scanners and extraction are configured.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Input
                        value={knowledgeUploadTitle}
                        onChange={(event) => setKnowledgeUploadTitle(event.target.value)}
                        placeholder="Document title"
                      />
                      <select
                        className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
                        value={knowledgeUploadFolderId}
                        onChange={(event) => setKnowledgeUploadFolderId(event.target.value)}
                      >
                        <option value="">No folder</option>
                        {knowledgeFolders.map((folder) => (
                          <option key={folder.id} value={folder.id}>
                            {folder.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <Input
                      type="file"
                      accept=".txt,.md,.markdown,.pdf,.doc,.docx,text/plain,text/markdown,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={(event) => setKnowledgeUploadFile(event.target.files?.[0] ?? null)}
                    />
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2 text-sm text-neutral-700">
                        <Checkbox
                          checked={knowledgePublishOnUpload}
                          onCheckedChange={(checked) => setKnowledgePublishOnUpload(checked === true)}
                        />
                        Publish on upload
                      </label>
                      <Button onClick={() => void uploadKnowledgeFile()}>Upload</Button>
                      {knowledgeUploadFile ? (
                        <Badge variant="secondary">
                          {knowledgeUploadFile.name} · {formatBytes(knowledgeUploadFile.size)}
                        </Badge>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6">
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle>Documents</CardTitle>
                        <CardDescription>Published documents are eligible for retrieval.</CardDescription>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => void downloadKnowledgeExport()}>
                        Export JSON
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 max-h-96 overflow-y-auto">
                    {knowledgeDocuments.length === 0 ? (
                      <div className="rounded-md border border-dashed border-neutral-200 p-4 text-sm text-neutral-500">
                        No knowledge documents uploaded.
                      </div>
                    ) : (
                      knowledgeDocuments.map((document) => (
                        <div
                          key={document.id}
                          className={
                            getLegalHold(document)
                              ? "rounded-lg border border-amber-200 bg-amber-50/50 p-3"
                              : "rounded-lg border border-neutral-200 p-3"
                          }
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-neutral-900">
                                {document.title || document.filename}
                              </div>
                              <div className="mt-1 text-xs text-neutral-500">
                                {document.filename} · {formatBytes(document.byte_size)} ·{" "}
                                {formatDate(document.updated_at)}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-500">
                                <span>
                                  {knowledgeFolders.find((folder) => folder.id === document.folder_id)?.name ??
                                    "No folder"}
                                </span>
                                <span>Checksum {document.checksum_sha256.slice(0, 12)}</span>
                                <span>
                                  Published {document.published_at ? formatDate(document.published_at) : "not yet"}
                                </span>
                                <span>{getRetentionLabel(document)}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant={document.status === "published" ? "default" : "secondary"}>
                                {document.status}
                              </Badge>
                              <Badge
                                variant={document.extraction_status === "completed" ? "outline" : "destructive"}
                              >
                                {document.extraction_status}
                              </Badge>
                              {getLegalHold(document) ? (
                                <Badge variant="outline">Legal hold</Badge>
                              ) : null}
                              {document.status !== "published" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void publishKnowledgeDocumentNow(document.id)}
                                >
                                  Publish
                                </Button>
                              ) : null}
                              {document.status !== "deleted" ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void toggleKnowledgeLegalHold(document)}
                                >
                                  {getLegalHold(document) ? "Release Hold" : "Hold"}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                          {document.extraction_error ? (
                            <p className="mt-2 text-xs text-red-600">{document.extraction_error}</p>
                          ) : null}
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Retrieval Check</CardTitle>
                    <CardDescription>Search published SOP content before connecting it to Dexter prompts.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-2">
                      <Input
                        value={knowledgeSearchQuery}
                        onChange={(event) => setKnowledgeSearchQuery(event.target.value)}
                        placeholder="Search query"
                      />
                      <Button variant="outline" onClick={() => void runKnowledgeSearch()}>
                        Search
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {knowledgeSearchResults.length === 0 ? (
                        <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                          No retrieval results loaded.
                        </div>
                      ) : (
                        knowledgeSearchResults.map((result) => (
                          <div key={result.chunkId} className="rounded-md border border-neutral-200 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium text-neutral-900">
                                {result.title || result.filename}
                              </p>
                              <div className="flex items-center gap-2">
                                <Badge variant="outline">Chunk {result.chunkIndex + 1}</Badge>
                                <Badge variant="outline">Score {result.score.toFixed(2)}</Badge>
                              </div>
                            </div>
                            <p className="mt-2 line-clamp-4 text-xs text-neutral-600">{result.content}</p>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="border-t border-neutral-100 pt-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                          Recent retrieval diagnostics
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void Promise.all([
                              listKnowledgeRetrievalEvents(20),
                              listKnowledgeQuarantineEvents(20),
                              previewKnowledgeRetention(100)
                            ]).then(([retrievalEvents, quarantineEvents, retentionPreview]) => {
                              setKnowledgeRetrievalEvents(retrievalEvents);
                              setKnowledgeQuarantineEvents(quarantineEvents);
                              setKnowledgeRetentionPreview(retentionPreview);
                            })
                          }
                        >
                          Refresh
                        </Button>
                      </div>
                      <div className="space-y-2 max-h-52 overflow-y-auto">
                        {knowledgeRetrievalEvents.length === 0 ? (
                          <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                            No retrieval checks recorded.
                          </div>
                        ) : (
                          knowledgeRetrievalEvents.map((event) => {
                            const filteredChunks = getFilteredUnsafeChunks(event);
                            return (
                              <div key={event.id} className="rounded-md border border-neutral-200 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="text-sm font-medium text-neutral-900">{event.query}</p>
                                  <div className="flex items-center gap-2">
                                    <Badge variant={event.result_count > 0 ? "default" : "secondary"}>
                                      {event.result_count} results
                                    </Badge>
                                    {filteredChunks > 0 ? (
                                      <Badge variant="destructive">{filteredChunks} filtered</Badge>
                                    ) : (
                                      <Badge variant="outline">0 filtered</Badge>
                                    )}
                                  </div>
                                </div>
                                <p className="mt-1 text-xs text-neutral-500">{formatDate(event.created_at)}</p>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <div className="border-t border-neutral-100 pt-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            Retention enforcement
                          </p>
                          <p className="mt-1 text-xs text-neutral-500">
                            {knowledgeRetentionPreview
                              ? `${knowledgeRetentionPreview.matched} expired documents ready, ${knowledgeRetentionPreview.skippedLegalHold} on legal hold.`
                              : "Retention preview not loaded."}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={(knowledgeRetentionPreview?.matched ?? 0) === 0}
                          onClick={() => void runKnowledgeRetentionNow()}
                        >
                          Run
                        </Button>
                      </div>
                      <div className="space-y-2 max-h-44 overflow-y-auto">
                        {!knowledgeRetentionPreview || knowledgeRetentionPreview.documents.length === 0 ? (
                          <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                            No expired knowledge documents found.
                          </div>
                        ) : (
                          knowledgeRetentionPreview.documents.map((document) => (
                            <div key={document.id} className="rounded-md border border-neutral-200 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-medium text-neutral-900">
                                    {document.title || document.filename}
                                  </p>
                                  <p className="mt-1 text-xs text-neutral-500">
                                    {formatBytes(document.byteSize)} · Expires {formatDate(document.expiresAt)}
                                  </p>
                                </div>
                                <Badge variant="secondary">{document.status}</Badge>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="border-t border-neutral-100 pt-3">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Recent quarantine events
                      </p>
                      <div className="space-y-2 max-h-52 overflow-y-auto">
                        {knowledgeQuarantineEvents.length === 0 ? (
                          <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                            No quarantined uploads recorded.
                          </div>
                        ) : (
                          knowledgeQuarantineEvents.map((event) => (
                            <div key={event.id} className="rounded-md border border-red-100 bg-red-50/50 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="text-sm font-medium text-neutral-900">{event.filename}</p>
                                  <p className="mt-1 text-xs text-neutral-500">
                                    {formatBytes(event.byte_size)} · {event.content_type} ·{" "}
                                    {formatDate(event.created_at)}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge variant="destructive">{event.reason_code}</Badge>
                                  <Badge variant="outline">{event.scanner_status}</Badge>
                                </div>
                              </div>
                              {event.detail ? (
                                <p className="mt-2 text-xs text-red-700">{event.detail}</p>
                              ) : null}
                              <p className="mt-2 text-xs text-neutral-500">
                                Checksum {event.checksum_sha256.slice(0, 12)}
                                {event.scanner ? ` · Scanner ${event.scanner}` : ""}
                                {event.scanner_signature ? ` · ${event.scanner_signature}` : ""}
                              </p>
                              {event.storage_key ? (
                                <p className="mt-1 break-all text-xs text-neutral-500">
                                  Evidence {event.storage_provider ?? "object"} ·{" "}
                                  {event.storage_bucket ? `${event.storage_bucket}/` : ""}
                                  {event.storage_key}
                                </p>
                              ) : (
                                <p className="mt-1 text-xs text-neutral-400">Evidence blob not stored</p>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="automation" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Agent Integration</CardTitle>
                  <CardDescription>Configure AI runtime and outbox throughput.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    <select className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm" value={selectedAgentId} onChange={(event) => {
                      const id = event.target.value;
                      setSelectedAgentId(id);
                      setAgentReplay(null);
                      const agent = agents.find((item) => item.id === id);
                      setAgentForm(agent ? mapAgentToForm(agent) : defaultAgentForm());
                    }}>
                      <option value="">Create new</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                      ))}
                    </select>
                    <Button variant="outline" onClick={() => { setSelectedAgentId(""); setAgentReplay(null); setAgentForm(defaultAgentForm()); }}>New</Button>
                    {selectedAgent ? <Badge variant="outline">{selectedAgent.status}</Badge> : null}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Input value={agentForm.name} onChange={(event) => setAgentForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="name" />
                    <select
                      className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
                      value={agentForm.provider}
                      onChange={(event) => setAgentForm((prev) => ({ ...prev, provider: event.target.value }))}
                    >
                      <option value="elizaos">ElizaOS</option>
                      <option value="custom">Custom</option>
                    </select>
                    <select
                      className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
                      value={agentForm.authType}
                      onChange={(event) => setAgentForm((prev) => ({ ...prev, authType: event.target.value }))}
                    >
                      <option value="hmac">HMAC</option>
                      <option value="shared_secret">Shared secret</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-2">
                    <Input value={agentForm.baseUrl} onChange={(event) => setAgentForm((prev) => ({ ...prev, baseUrl: event.target.value }))} placeholder="base url" />
                    <div className="flex gap-2">
                      <Input
                        type={showAgentSecret ? "text" : "password"}
                        value={agentForm.sharedSecret}
                        onChange={(event) => setAgentForm((prev) => ({ ...prev, sharedSecret: event.target.value }))}
                        placeholder="secret"
                      />
                      <Button variant="outline" onClick={() => setShowAgentSecret((prev) => !prev)}>
                        {showAgentSecret ? "Hide" : "Show"}
                      </Button>
                      <Button variant="outline" onClick={generateAgentSecret}>
                        Generate
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <select
                      className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
                      value={agentForm.policyMode}
                      onChange={(event) =>
                        setAgentForm((prev) => ({
                          ...prev,
                          policyMode: event.target.value as AgentPolicyMode
                        }))
                      }
                    >
                      <option value="hybrid_review">Hybrid review</option>
                      <option value="full_auto">Full auto</option>
                      <option value="draft_only">Draft only legacy</option>
                      <option value="auto_send">Auto-send legacy</option>
                    </select>
                    <select
                      className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
                      value={agentForm.status}
                      onChange={(event) =>
                        setAgentForm((prev) => ({
                          ...prev,
                          status: event.target.value as "active" | "paused"
                        }))
                      }
                    >
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                    </select>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={agentForm.maxEventsPerRun}
                      onChange={(event) =>
                        setAgentForm((prev) => ({ ...prev, maxEventsPerRun: event.target.value }))
                      }
                      placeholder="max events per run"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lg border border-neutral-200 p-3">
                    <label className="flex items-start gap-3">
                      <Checkbox
                        checked={agentForm.allowMergeActions}
                        onCheckedChange={(checked) =>
                          setAgentForm((prev) => ({ ...prev, allowMergeActions: checked === true }))
                        }
                      />
                      <span>
                        <span className="block text-sm font-medium text-neutral-900">Allow merge actions</span>
                        <span className="block text-xs text-neutral-600">
                          Enables direct AI ticket/customer merges when policy and confidence allow it.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-3">
                      <Checkbox
                        checked={agentForm.allowVoiceActions}
                        onCheckedChange={(checked) =>
                          setAgentForm((prev) => ({ ...prev, allowVoiceActions: checked === true }))
                        }
                      />
                      <span>
                        <span className="block text-sm font-medium text-neutral-900">Allow voice actions</span>
                        <span className="block text-xs text-neutral-600">
                          Enables AI-initiated call option and outbound voice actions.
                        </span>
                      </span>
                    </label>
                  </div>
                  <div className="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600 space-y-1">
                    <p>
                      Webhook URL:{" "}
                      {agentForm.baseUrl
                        ? `${agentForm.baseUrl.replace(/\/+$/, "")}/hooks/6esk/events`
                        : "Set a base URL to generate the webhook path."}
                    </p>
                    <p>Provider / auth: {agentForm.provider} · {agentForm.authType}</p>
                    <p>Mailbox scopes: {selectedAgent?.scopes && Array.isArray(selectedAgent.scopes.mailbox_ids) ? selectedAgent.scopes.mailbox_ids.length : 0}</p>
                    <p>
                      Effective throughput cap:{" "}
                      {agentOutbox?.throughput.effectiveLimit ??
                        (agentForm.maxEventsPerRun.trim() || "default")}
                    </p>
                    {selectedAgent ? (
                      <p>
                        Last updated: {formatDate(selectedAgent.updated_at)} · Created {formatDate(selectedAgent.created_at)}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-neutral-600">Scopes JSON</label>
                      <Textarea rows={5} value={agentForm.scopesJson} onChange={(event) => setAgentForm((prev) => ({ ...prev, scopesJson: event.target.value }))} />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-neutral-600">Policy JSON</label>
                      <Textarea rows={5} value={agentForm.policyJson} onChange={(event) => setAgentForm((prev) => ({ ...prev, policyJson: event.target.value }))} />
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button onClick={() => void saveAgent()}>Save Agent</Button>
                    {agentForm.baseUrl ? (
                      <Button
                        variant="outline"
                        onClick={() =>
                          void copyToClipboard(
                            `${agentForm.baseUrl.replace(/\/+$/, "")}/hooks/6esk/events`,
                            "Agent webhook URL"
                          )
                        }
                      >
                        Copy Webhook
                      </Button>
                    ) : null}
                    {selectedAgent ? <Button variant="outline" onClick={() => void deliverAgentOutbox(selectedAgent.id, 25).then(loadAutomation)}>Deliver Outbox</Button> : null}
                    {agentOutbox ? <Badge variant="secondary">Pending {agentOutbox.queue.pending} · Failed {agentOutbox.queue.failed}</Badge> : null}
                  </div>
                  {agentOutbox ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <Metric label="Pending" value={agentOutbox.queue.pending} />
                      <Metric label="Due Now" value={agentOutbox.queue.dueNow} />
                      <Metric label="Delivered 24h" value={agentOutbox.queue.delivered24h} />
                      <Metric label="Failed" value={agentOutbox.queue.failed} />
                    </div>
                  ) : null}
                  <div className="rounded-lg border border-neutral-200 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-neutral-900">Recent runs</p>
                        <p className="text-xs text-neutral-500">Control-plane run ledger for this agent.</p>
                      </div>
                      <Badge variant="outline">{agentRuns.length}</Badge>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {agentRuns.length === 0 ? (
                        <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                          No agent runs recorded yet.
                        </div>
                      ) : (
                        agentRuns.map((run) => (
                          <div key={run.id} className="rounded-md border border-neutral-200 p-2 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium text-neutral-900">{run.status}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-neutral-500">{formatDate(run.created_at)}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={replayLoadingRunId === run.id}
                                  onClick={() => void loadAgentReplay(run.id)}
                                >
                                  {replayLoadingRunId === run.id ? "Loading" : "Replay"}
                                </Button>
                              </div>
                            </div>
                            <div className="mt-1 text-neutral-600">{run.lane_key}</div>
                            {run.error ? <div className="mt-1 text-red-600">{run.error}</div> : null}
                          </div>
                        ))
                      )}
                    </div>
                    {agentReplay ? (
                      <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="font-semibold text-neutral-900">
                              Replay evidence · {agentReplay.status}
                            </p>
                            <p className="mt-1 text-neutral-600">{agentReplay.explanation}</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void copyToClipboard(
                                JSON.stringify(agentReplay, null, 2),
                                "Agent replay JSON"
                              )
                            }
                          >
                            Copy JSON
                          </Button>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                          <Metric label="Events" value={agentReplay.evidence.events.length} />
                          <Metric label="Steps" value={agentReplay.evidence.steps.length} />
                          <Metric label="Tools" value={agentReplay.evidence.toolCalls.length} />
                          <Metric label="Guards" value={agentReplay.evidence.guardEvents.length} />
                          <Metric label="Policies" value={agentReplay.evidence.policyDecisions.length} />
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="outline">
                            Prompt {agentReplay.promptSandbox ? "attached" : "missing"}
                          </Badge>
                          <Badge variant="outline">
                            Template {agentReplay.promptTemplate?.template_version ?? "missing"}
                          </Badge>
                          <Badge variant="outline">
                            Run {agentReplay.run.id.slice(0, 8)}
                          </Badge>
                          {agentReplay.missingEvidence.map((item) => (
                            <Badge key={item} variant="secondary">
                              Missing {item}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-lg border border-neutral-200 p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-neutral-900">AI safety diagnostics</p>
                        <p className="text-xs text-neutral-500">
                          Tenant-scoped guard events, tool-policy denials, and redacted blocked samples.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">Guard {aiSafety?.summary.guardEvents ?? 0}</Badge>
                        <Badge variant="outline">Blocked {aiSafety?.summary.blockedPolicyDecisions ?? 0}</Badge>
                        <Badge variant="outline">Review {aiSafety?.summary.reviewPolicyDecisions ?? 0}</Badge>
                        <Button variant="ghost" size="sm" onClick={() => void loadAutomation()}>
                          Refresh
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <Metric label="Malicious" value={aiSafety?.summary.maliciousGuardEvents ?? 0} />
                      <Metric label="Suspicious" value={aiSafety?.summary.suspiciousGuardEvents ?? 0} />
                      <Metric label="Read-only" value={aiSafety?.summary.readOnlyPolicyDecisions ?? 0} />
                      <Metric label="Policy Blocks" value={aiSafety?.summary.blockedPolicyDecisions ?? 0} />
                    </div>
                    <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-neutral-700">Prompt templates</p>
                          <p className="text-xs text-neutral-500">
                            Runtime prompt rollout and rollback control for Dexter command envelopes.
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void rollbackPromptTemplateVersion()}
                        >
                          Rollback
                        </Button>
                      </div>
                      <div className="mt-3 space-y-2 max-h-44 overflow-y-auto">
                        {promptTemplates.length === 0 ? (
                          <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                            No prompt templates loaded.
                          </div>
                        ) : (
                          promptTemplates.map((template) => (
                            <div
                              key={template.id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white p-2 text-xs"
                            >
                              <div>
                                <p className="font-medium text-neutral-900">
                                  {template.template_version}
                                </p>
                                <p className="text-neutral-500">
                                  {template.template_key} · {template.template_hash.slice(0, 12)}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Badge variant={template.status === "active" ? "secondary" : "outline"}>
                                  {template.status}
                                </Badge>
                                {template.status !== "active" ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void activatePromptTemplateVersion(template.id)}
                                  >
                                    Activate
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                      <div className="space-y-2 max-h-56 overflow-y-auto">
                        <p className="text-xs font-semibold text-neutral-700">Recent guard events</p>
                        {!aiSafety || aiSafety.guardEvents.length === 0 ? (
                          <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                            No guard events recorded.
                          </div>
                        ) : (
                          aiSafety.guardEvents.map((event) => (
                            <div key={event.id} className="rounded-md border border-neutral-200 p-2 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium text-neutral-900">
                                  {event.severity} · {event.source_kind}
                                </span>
                                <span className="text-neutral-500">{formatDate(event.created_at)}</span>
                              </div>
                              <p className="mt-1 text-neutral-600">
                                {event.subject ?? "No subject"} · {event.decision}
                              </p>
                              {event.reason_codes.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {event.reason_codes.slice(0, 4).map((code) => (
                                    <Badge key={`${event.id}-${code}`} variant="outline">
                                      {code}
                                    </Badge>
                                  ))}
                                </div>
                              ) : null}
                              {event.content_sample ? (
                                <p className="mt-2 rounded bg-neutral-50 p-2 text-neutral-600">
                                  {event.content_sample}
                                </p>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                      <div className="space-y-2 max-h-56 overflow-y-auto">
                        <p className="text-xs font-semibold text-neutral-700">Recent policy decisions</p>
                        {!aiSafety || aiSafety.policyDecisions.length === 0 ? (
                          <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                            No policy decisions recorded.
                          </div>
                        ) : (
                          aiSafety.policyDecisions.map((decision) => (
                            <div key={decision.id} className="rounded-md border border-neutral-200 p-2 text-xs">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium text-neutral-900">
                                  {decision.tool_name} · {decision.decision}
                                </span>
                                <span className="text-neutral-500">{formatDate(decision.created_at)}</span>
                              </div>
                              <p className="mt-1 text-neutral-600">
                                {decision.tool_class} · {decision.policy_mode}
                              </p>
                              {decision.reason_codes.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {decision.reason_codes.slice(0, 4).map((code) => (
                                    <Badge key={`${decision.id}-${code}`} variant="outline">
                                      {code}
                                    </Badge>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {failedAgentEvents.length === 0 ? (
                      <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                        No failed agent outbox events.
                      </div>
                    ) : (
                      failedAgentEvents.map((event) => {
                        const busyKey = `agent:${event.id}`;
                        const isBusy = eventActionBusyKey === busyKey;
                        return (
                          <div key={event.id} className="rounded-md border border-neutral-200 p-2 text-xs">
                            <p className="font-medium text-neutral-900">{event.event_type}</p>
                            <p className="text-neutral-600">
                              {event.status} • Attempts {event.attempt_count} • Next{" "}
                              {formatDate(event.next_attempt_at)}
                            </p>
                            <p className="mt-1 text-neutral-500">{event.last_error ?? "No error detail"}</p>
                            <div className="mt-2 flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => void retryFailedAgentEventNow(event.id)}
                              >
                                {isBusy ? "Retrying..." : "Retry now"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void copyToClipboard(event.id, "Agent event ID")}
                              >
                                Copy ID
                              </Button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Profile Lookup</CardTitle>
                  <CardDescription>Operational lookup quality over time.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2">
                    <select className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm" value={profileDays} onChange={(event) => setProfileDays(Number(event.target.value))}>
                      <option value={7}>7d</option>
                      <option value={14}>14d</option>
                      <option value={30}>30d</option>
                      <option value={60}>60d</option>
                    </select>
                    <Button variant="outline" onClick={() => void loadAutomation()}>Refresh</Button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    <Metric label="Total" value={profile?.summary.total ?? 0} />
                    <Metric label="Matched" value={profile?.summary.matched ?? 0} />
                    <Metric label="Cache" value={profile?.summary.matchedCache ?? 0} />
                    <Metric label="Missed" value={profile?.summary.missed ?? 0} />
                    <Metric label="Errors" value={profile?.summary.errored ?? 0} />
                    <Metric label="Timeout" value={profile?.summary.timeoutErrors ?? 0} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="operations" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Operations Shortcuts</CardTitle>
                  <CardDescription>Jump directly to operational sections and related queues.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => jumpToOperationsSection("inbound")}>
                      Inbound
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => jumpToOperationsSection("inbound-settings")}>
                      Inbound Settings
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => jumpToOperationsSection("calls")}>
                      Calls
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => jumpToOperationsSection("call-rejections")}>
                      Call Rejections
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => jumpToOperationsSection("audit-logs")}>
                      Audit Logs
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/tickets?channel=voice">Open voice queue</Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/tickets?channel=email">Open email queue</Link>
                    </Button>
                    <Button asChild variant="ghost" size="sm">
                      <Link href="/mail?view=spam">Open spam queue</Link>
                    </Button>
                  </div>
                  <div className="rounded-lg border border-neutral-200 bg-white/70 p-3 dark:border-neutral-800 dark:bg-neutral-950/80">
                    <p className="text-xs text-neutral-600 dark:text-neutral-300">
                      Tune data depth for operations telemetry and event queues.
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                      <label className="grid gap-1 text-sm text-neutral-800 dark:text-neutral-200">
                        Window (hours)
                        <Input
                          type="number"
                          min={1}
                          max={168}
                          value={operationsFilterDraft.windowHours}
                          onChange={(event) =>
                            setOperationsFilterDraft((previous) => ({
                              ...previous,
                              windowHours: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-sm text-neutral-800 dark:text-neutral-200">
                        Event rows
                        <Input
                          type="number"
                          min={5}
                          max={100}
                          value={operationsFilterDraft.eventLimit}
                          onChange={(event) =>
                            setOperationsFilterDraft((previous) => ({
                              ...previous,
                              eventLimit: event.target.value
                            }))
                          }
                        />
                      </label>
                      <label className="grid gap-1 text-sm text-neutral-800 dark:text-neutral-200">
                        Audit rows
                        <Input
                          type="number"
                          min={10}
                          max={200}
                          value={operationsFilterDraft.auditLimit}
                          onChange={(event) =>
                            setOperationsFilterDraft((previous) => ({
                              ...previous,
                              auditLimit: event.target.value
                            }))
                          }
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={applyOperationsFilters}
                        disabled={!hasOperationsFilterChanges || loading.operations}
                      >
                        Apply Filters
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={resetOperationsFilters}
                        disabled={loading.operations}
                      >
                        Reset Defaults
                      </Button>
                      <p className="text-xs text-neutral-500 dark:text-neutral-400">
                        Current: {operationsFilters.windowHours}h window, {operationsFilters.eventLimit} event rows,{" "}
                        {operationsFilters.auditLimit} audit rows.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card id="ops-inbound" className="scroll-mt-24">
                  <CardHeader>
                    <CardTitle>Inbound</CardTitle>
                    <CardDescription>Retry and alert controls for inbound failures.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <Metric label="Failed Queue" value={inbound?.summary.failedQueue ?? 0} />
                      <Metric label="Due Retry" value={inbound?.summary.dueRetryNow ?? 0} />
                      <Metric label="Processing" value={inbound?.summary.processingNow ?? 0} />
                      <Metric label={`Processed ${operationsFilters.windowHours}h`} value={inbound?.summary.processedWindow ?? 0} />
                    </div>
                    <div className="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600 space-y-1">
                      <p>
                        Alert status: {inbound?.alert.status ?? "unknown"} · Webhook{" "}
                        {inbound?.alert.webhookConfigured ? "configured" : "missing"}
                      </p>
                      <p>
                        Threshold {inbound?.alert.threshold ?? 0} in {inbound?.alert.windowMinutes ?? 0} min ·
                        cooldown {inbound?.alert.cooldownMinutes ?? 0} min
                      </p>
                      <p>Last alert: {formatDate(inbound?.alert.lastSentAt)}</p>
                      <p>
                        Recommendation: {inbound?.alert.recommendation.reason ?? "unknown"} · suggested range{" "}
                        {inbound?.alert.recommendation.suggestedMinThreshold ?? 0}-
                        {inbound?.alert.recommendation.suggestedMaxThreshold ?? 0}
                      </p>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="outline" onClick={() => void retryInboundEvents(operationsFilters.eventLimit).then(loadOperations)}>Retry Failed</Button>
                      <Button variant="outline" onClick={() => void runInboundAlertCheck().then(loadOperations)}>Run Alert</Button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {(inbound?.failureReasons ?? []).slice(0, 4).map((reason) => (
                        <div key={reason.code} className="rounded-lg border border-neutral-200 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-neutral-900">{reason.label}</p>
                            <Badge variant="outline">{reason.severity}</Badge>
                          </div>
                          <p className="mt-1 text-xs text-neutral-600">{reason.count} failures · {reason.triageLabel}</p>
                          <p className="mt-1 text-xs text-neutral-500">{reason.triageHint}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card id="ops-inbound-settings" className="scroll-mt-24">
                  <CardHeader>
                    <CardTitle>Inbound Alert Settings</CardTitle>
                    <CardDescription>Control alert thresholds and webhook escalation.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Input
                        value={inboundSettings?.webhookUrl ?? ""}
                        placeholder="Webhook URL"
                        onChange={(event) =>
                          setInboundSettings((previous) =>
                            previous ? { ...previous, webhookUrl: event.target.value } : previous
                          )
                        }
                      />
                      <Input
                        type="number"
                        min={1}
                        value={inboundSettings?.threshold ?? 0}
                        onChange={(event) =>
                          setInboundSettings((previous) =>
                            previous ? { ...previous, threshold: Number(event.target.value) } : previous
                          )
                        }
                      />
                      <Input
                        type="number"
                        min={1}
                        value={inboundSettings?.windowMinutes ?? 0}
                        onChange={(event) =>
                          setInboundSettings((previous) =>
                            previous ? { ...previous, windowMinutes: Number(event.target.value) } : previous
                          )
                        }
                      />
                      <Input
                        type="number"
                        min={1}
                        value={inboundSettings?.cooldownMinutes ?? 0}
                        onChange={(event) =>
                          setInboundSettings((previous) =>
                            previous ? { ...previous, cooldownMinutes: Number(event.target.value) } : previous
                          )
                        }
                      />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        onClick={() =>
                          inboundSettings
                            ? void updateInboundSettings({
                                webhookUrl: inboundSettings.webhookUrl,
                                threshold: inboundSettings.threshold,
                                windowMinutes: inboundSettings.windowMinutes,
                                cooldownMinutes: inboundSettings.cooldownMinutes
                              })
                                .then(() => {
                                  pushSuccess("Inbound settings saved");
                                  return loadOperations();
                                })
                                .catch((error) => pushError(error, "Could not save inbound settings"))
                            : undefined
                        }
                        disabled={!inboundSettings}
                      >
                        Re-save Settings
                      </Button>
                    </div>
                    <div className="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600 space-y-1">
                      <p>Source: {inboundSettings?.source ?? "unknown"}</p>
                      <p>Updated: {formatDate(inboundSettings?.updatedAt)}</p>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {failedInboundEvents.length === 0 ? (
                        <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                          No failed inbound events in queue.
                        </div>
                      ) : (
                        failedInboundEvents.map((event) => {
                          const busyKey = `inbound:${event.id}`;
                          const isBusy = eventActionBusyKey === busyKey;
                          return (
                            <div key={event.id} className="rounded-md border border-neutral-200 p-2 text-xs">
                              <p className="font-medium text-neutral-900">{event.idempotency_key}</p>
                              <p className="text-neutral-600">
                                Attempts {event.attempt_count} • Next {formatDate(event.next_attempt_at)}
                              </p>
                              <p className="mt-1 text-neutral-500">{event.last_error ?? "No error detail"}</p>
                              <div className="mt-2 flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={isBusy}
                                  onClick={() => void retryInboundEventNow(event.id)}
                                >
                                  {isBusy ? "Retrying..." : "Retry now"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void copyToClipboard(event.id, "Inbound event ID")}
                                >
                                  Copy ID
                                </Button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card id="ops-calls" className="scroll-mt-24">
                  <CardHeader>
                    <CardTitle>Calls</CardTitle>
                    <CardDescription>Outbox delivery and dead-letter recovery.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Metric label="Queued" value={calls?.queue.queued ?? 0} />
                      <Metric label="Failed" value={calls?.queue.failed ?? 0} />
                      <Metric label="Dead letters" value={deadLetterSummary?.total ?? 0} />
                      <Metric label="Rejected webhooks" value={callRejections?.summary.reduce((sum, item) => sum + item.count, 0) ?? 0} />
                    </div>
                    {deadLetterSummary ? (
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">Failed {deadLetterSummary.byStatus.failed}</Badge>
                        <Badge variant="outline">Poison {deadLetterSummary.byStatus.poison}</Badge>
                        <Badge variant="outline">Quarantined {deadLetterSummary.byStatus.quarantined}</Badge>
                        {deadLetterSummary.oldestEvent ? (
                          <Badge variant="secondary">
                            Oldest {deadLetterSummary.oldestEvent.id.slice(0, 8)} · {deadLetterSummary.oldestEvent.age_minutes} min
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                    {deadLetterSummary?.byErrorCode?.length ? (
                      <div className="flex flex-wrap gap-2">
                        {deadLetterSummary.byErrorCode.slice(0, 4).map((entry) => (
                          <Badge key={entry.code} variant="outline">
                            {entry.code}: {entry.count}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <div className="rounded-lg border border-neutral-200 p-3 text-xs text-neutral-600 space-y-1">
                      <p>Webhook mode: {calls?.webhookSecurity.mode ?? "unknown"}</p>
                      <p>
                        Timestamp required: {calls?.webhookSecurity.timestampRequired ? "yes" : "no"} · max skew{" "}
                        {calls?.webhookSecurity.maxSkewSeconds ?? 0}s
                      </p>
                      <p>Legacy body signature: {calls?.webhookSecurity.legacyBodySignature ? "enabled" : "disabled"}</p>
                    </div>
                    <div className="rounded-lg border border-neutral-200 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-neutral-900">Voice provider numbers</p>
                          <p className="text-xs text-neutral-500">
                            Tenant-owned phone/account routes for strict inbound Twilio calls.
                          </p>
                        </div>
                        <Badge variant={callProviderNumbers.some((number) => number.status === "active") ? "secondary" : "outline"}>
                          {callProviderNumbers.filter((number) => number.status === "active").length} active
                        </Badge>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                        <Input
                          value={callProviderNumberForm.provider}
                          onChange={(event) =>
                            setCallProviderNumberForm((prev) => ({ ...prev, provider: event.target.value }))
                          }
                          placeholder="provider"
                        />
                        <Input
                          value={callProviderNumberForm.phoneNumber}
                          onChange={(event) =>
                            setCallProviderNumberForm((prev) => ({ ...prev, phoneNumber: event.target.value }))
                          }
                          placeholder="+27..."
                        />
                        <Input
                          value={callProviderNumberForm.accountSid}
                          onChange={(event) =>
                            setCallProviderNumberForm((prev) => ({ ...prev, accountSid: event.target.value }))
                          }
                          placeholder="Twilio Account SID"
                        />
                        <select
                          className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
                          value={callProviderNumberForm.status}
                          onChange={(event) =>
                            setCallProviderNumberForm((prev) => ({
                              ...prev,
                              status: event.target.value as "active" | "paused" | "inactive"
                            }))
                          }
                        >
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                          <option value="inactive">Inactive</option>
                        </select>
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => void saveVoiceProviderNumber()}>
                            {callProviderNumberForm.id ? "Update" : "Add"}
                          </Button>
                          <Button variant="outline" size="sm" onClick={resetCallProviderNumberForm}>
                            Clear
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {callProviderNumbers.length === 0 ? (
                          <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                            No voice provider numbers configured.
                          </div>
                        ) : (
                          callProviderNumbers.map((number) => {
                            const busyKey = `call-provider:${number.id}`;
                            const isBusy = eventActionBusyKey === busyKey;
                            return (
                              <div
                                key={number.id}
                                className="flex flex-col gap-2 rounded-md border border-neutral-200 p-2 text-xs md:flex-row md:items-center md:justify-between"
                              >
                                <div>
                                  <p className="font-medium text-neutral-900">
                                    {number.phoneNumber} · {number.provider}
                                  </p>
                                  <p className="text-neutral-500">
                                    Account {number.accountSid ?? "not set"} · Updated {formatDate(number.updatedAt)}
                                  </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={number.status === "active" ? "secondary" : "outline"}>
                                    {number.status}
                                  </Badge>
                                  <Button variant="ghost" size="sm" onClick={() => editCallProviderNumber(number)}>
                                    Edit
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={isBusy || number.status === "inactive"}
                                    onClick={() => void disableVoiceProviderNumber(number.id)}
                                  >
                                    {isBusy ? "Disabling..." : "Disable"}
                                  </Button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="outline" onClick={() => void runCallOutbox(operationsFilters.eventLimit).then(loadOperations)}>Run Outbox</Button>
                      <Button variant="outline" onClick={() => void retryFailedCallEvents(operationsFilters.eventLimit).then(loadOperations)}>Retry Failed</Button>
                      <Button
                        variant="outline"
                        onClick={() => void runCallTranscriptAiOutbox(operationsFilters.eventLimit).then(loadOperations)}
                      >
                        Run Transcript QA
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void retryFailedCallTranscriptAiJobs(operationsFilters.eventLimit).then(loadOperations)}
                      >
                        Retry Failed QA
                      </Button>
                      <Button variant="outline" onClick={() => void batchRecoverDeadLetters({ filter: { status: "failed" } }).then(loadOperations)}>Batch Recover</Button>
                      <select
                        className="h-9 rounded-md border border-neutral-200 bg-white px-2 text-sm"
                        value={deadLetterStatusFilter}
                        onChange={(event) =>
                          setDeadLetterStatusFilter(
                            event.target.value as "all" | "failed" | "poison" | "quarantined"
                          )
                        }
                      >
                        <option value="all">All statuses</option>
                        <option value="failed">Failed</option>
                        <option value="poison">Poison</option>
                        <option value="quarantined">Quarantined</option>
                      </select>
                    </div>
                    <div className="rounded-lg border border-neutral-200 p-3 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-neutral-900">Transcript QA</p>
                          <p className="text-xs text-neutral-500">
                            AI-derived call quality signals from stored transcripts. Not shown in Support.
                          </p>
                        </div>
                        <Badge variant="outline">{callTranscriptAi?.provider ?? "unknown"}</Badge>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Metric label="Analyzed 24h" value={callTranscriptAi?.analysis.analyzed24h ?? 0} />
                        <Metric label="Flagged 24h" value={callTranscriptAi?.analysis.flagged24h ?? 0} />
                        <Metric label="Review 24h" value={callTranscriptAi?.analysis.review24h ?? 0} />
                        <Metric label="QA jobs failed" value={callTranscriptAi?.queue.failed ?? 0} />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">Pass {callTranscriptAi?.analysis.pass24h ?? 0}</Badge>
                        <Badge variant="outline">Watch {callTranscriptAi?.analysis.watch24h ?? 0}</Badge>
                        <Badge variant="outline">Review {callTranscriptAi?.analysis.review24h ?? 0}</Badge>
                        <Badge variant="outline">Flags {callTranscriptAi?.analysis.totalQaFlags24h ?? 0}</Badge>
                        <Badge variant="outline">
                          Actions {callTranscriptAi?.analysis.totalActionItems24h ?? 0}
                        </Badge>
                      </div>
                      <div className="rounded-md border border-dashed border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-600 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-medium text-neutral-900">Failed QA Retry Drill</p>
                            <p className="mt-1">
                              Uses the oldest failed transcript-QA job, retries it once, runs a
                              single QA outbox pass, then reloads this panel. This is an operator
                              rehearsal, not a simulator.
                            </p>
                          </div>
                          <Badge variant="secondary">
                            {failedCallTranscriptAiJobs.length > 0 ? "Ready" : "Waiting for a failed job"}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <div className="rounded-md border border-neutral-200 bg-white p-2">
                            <p className="font-medium text-neutral-900">1. Target</p>
                            <p className="mt-1 text-neutral-600">
                              {failedCallTranscriptAiJobs[0]?.callSessionId ?? "No failed transcript QA job loaded."}
                            </p>
                          </div>
                          <div className="rounded-md border border-neutral-200 bg-white p-2">
                            <p className="font-medium text-neutral-900">2. Success signal</p>
                            <p className="mt-1 text-neutral-600">
                              Failed count should drop, or the job should leave the failed list and
                              re-enter queue/processing.
                            </p>
                          </div>
                          <div className="rounded-md border border-neutral-200 bg-white p-2">
                            <p className="font-medium text-neutral-900">3. Escalate if stuck</p>
                            <p className="mt-1 text-neutral-600">
                              If the same error repeats after retry, treat it as provider/config
                              failure and keep it in Admin triage.
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={
                              eventActionBusyKey === "call-ai:drill" ||
                              failedCallTranscriptAiJobs.length === 0
                            }
                            onClick={() => void runTranscriptQaRetryDrill()}
                          >
                            {eventActionBusyKey === "call-ai:drill"
                              ? "Running drill..."
                              : "Run Retry Drill"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={loading.operations}
                            onClick={() => void loadOperations()}
                          >
                            Refresh QA Panel
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {callTranscriptAi?.recentFlagged.length ? (
                            callTranscriptAi.recentFlagged.map((item) => (
                              <div key={item.jobId} className="rounded-md border border-neutral-200 p-2 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="font-medium text-neutral-900">
                                    {item.qaStatus} · {item.ticketId}
                                  </p>
                                  <span className="text-neutral-500">{formatDate(item.completedAt)}</span>
                                </div>
                                <p className="mt-1 text-neutral-600">
                                  {item.summary ?? "No summary available."}
                                </p>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {item.qaFlags.slice(0, 3).map((flag) => (
                                    <Badge key={`${item.jobId}-${flag.code}`} variant="outline">
                                      {flag.severity}: {flag.title}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                              No recent flagged transcript QA calls.
                            </div>
                          )}
                        </div>
                        <div className="space-y-2 max-h-48 overflow-y-auto">
                          {failedCallTranscriptAiJobs.length === 0 ? (
                            <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                              No failed transcript QA jobs.
                            </div>
                          ) : (
                            failedCallTranscriptAiJobs.map((job) => {
                              const busyKey = `call-ai:${job.id}`;
                              const isBusy = eventActionBusyKey === busyKey;
                              return (
                                <div key={job.id} className="rounded-md border border-neutral-200 p-2 text-xs">
                                  <p className="font-medium text-neutral-900">{job.callSessionId}</p>
                                  <p className="text-neutral-600">
                                    {job.status} • Attempts {job.attemptCount} • Next {formatDate(job.nextAttemptAt)}
                                  </p>
                                  <p className="mt-1 text-neutral-500">{job.lastError ?? "No error detail"}</p>
                                  <div className="mt-2 flex items-center gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={isBusy}
                                      onClick={() => void retryFailedCallTranscriptAiJobNow(job.id)}
                                    >
                                      {isBusy ? "Retrying..." : "Retry now"}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => void copyToClipboard(job.id, "Transcript QA job ID")}
                                    >
                                      Copy ID
                                    </Button>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {filteredDeadLetters.map((event) => (
                        <div key={event.id} className="rounded-md border border-neutral-200 p-2 text-xs">
                          <p className="font-medium text-neutral-900">{event.id}</p>
                          <p className="text-neutral-600">{event.status} · {event.direction} · attempts {event.attempt_count}/{event.max_attempts}</p>
                          <p className="mt-1 text-neutral-500">{event.last_error ?? event.reason ?? "no detail"}</p>
                          <p className="mt-1 text-neutral-500">Next attempt {formatDate(event.next_attempt_at)} · Updated {formatDate(event.updated_at)}</p>
                          <div className="flex gap-2 mt-2">
                            <Button variant="outline" size="sm" onClick={() => void patchDeadLetterEvent({ eventId: event.id, action: "recover" }).then(loadOperations)}>Recover</Button>
                            <Button variant="outline" size="sm" onClick={() => void patchDeadLetterEvent({ eventId: event.id, action: "quarantine" }).then(loadOperations)}>Quarantine</Button>
                            <Button variant="ghost" size="sm" onClick={() => void patchDeadLetterEvent({ eventId: event.id, action: "discard" }).then(loadOperations)}>Discard</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                <Card id="ops-call-rejections" className="scroll-mt-24">
                  <CardHeader>
                    <CardTitle>Call Rejections</CardTitle>
                    <CardDescription>Recent webhook rejection reasons and failed call attempts.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {(callRejections?.summary ?? []).map((item) => (
                        <div key={`${item.reason}-${item.mode}`} className="rounded-lg border border-neutral-200 p-3">
                          <p className="text-xs text-neutral-500">{item.mode}</p>
                          <p className="text-sm font-medium text-neutral-900">{item.reason}</p>
                          <p className="text-xs text-neutral-600">{item.count} events</p>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {(callRejections?.recent ?? []).length === 0 ? (
                          <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                            No recent webhook rejections in the selected window.
                          </div>
                        ) : (
                          (callRejections?.recent ?? []).map((event) => (
                            <div key={event.id} className="rounded-md border border-neutral-200 p-2 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-medium text-neutral-900">{String(event.data?.reason ?? "unknown")}</p>
                                <span className="text-neutral-500">{formatDate(event.createdAt)}</span>
                              </div>
                              <p className="mt-1 text-neutral-600">
                                {String(event.data?.mode ?? "unknown")} · {String(event.data?.endpoint ?? "unknown endpoint")}
                              </p>
                              <div className="mt-2 flex items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    setReviewingRejectionId((prev) => (prev === event.id ? null : event.id))
                                  }
                                >
                                  {reviewingRejectionId === event.id ? "Hide review" : "Review"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void copyToClipboard(event.id, "Rejection event ID")}
                                >
                                  Copy ID
                                </Button>
                              </div>
                              {reviewingRejectionId === event.id ? (
                                <pre className="mt-2 overflow-x-auto rounded-md bg-neutral-100 p-2 text-[11px] text-neutral-600">
                                  {JSON.stringify(event.data ?? {}, null, 2)}
                                </pre>
                              ) : null}
                            </div>
                          ))
                        )}
                      </div>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {failedCallEvents.length === 0 ? (
                          <div className="rounded-md border border-dashed border-neutral-200 p-3 text-xs text-neutral-500">
                            No failed call outbox events.
                          </div>
                        ) : (
                          failedCallEvents.map((event) => {
                            const busyKey = `call:${event.id}`;
                            const isBusy = eventActionBusyKey === busyKey;
                            return (
                              <div key={event.id} className="rounded-md border border-neutral-200 p-2 text-xs">
                                <p className="font-medium text-neutral-900">{event.id}</p>
                                <p className="text-neutral-600">
                                  {event.status} • Attempts {event.attempt_count} • Next {formatDate(event.next_attempt_at)}
                                </p>
                                <p className="mt-1 text-neutral-500">{event.last_error ?? "No error detail"}</p>
                                <div className="mt-2 flex items-center gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={isBusy}
                                    onClick={() => void retryFailedCallEventNow(event.id)}
                                  >
                                    {isBusy ? "Retrying..." : "Retry now"}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void copyToClipboard(event.id, "Call event ID")}
                                  >
                                    Copy ID
                                  </Button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card id="ops-audit-logs" className="scroll-mt-24">
                <CardHeader>
                  <CardTitle>Audit Logs</CardTitle>
                  <CardDescription>Latest admin/system events.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2 max-h-80 overflow-y-auto">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="rounded-lg border border-neutral-200 p-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-neutral-900">{log.action}</span>
                        <span className="text-xs text-neutral-500">{formatDate(log.created_at)}</span>
                      </div>
                      <p className="text-xs text-neutral-600 mt-1">
                        {log.entity_type}{log.entity_id ? ` · ${log.entity_id}` : ""}
                        {log.actor_email ? ` · ${log.actor_email}` : log.actor_name ? ` · ${log.actor_name}` : ""}
                      </p>
                      {log.data ? (
                        <pre className="mt-2 overflow-x-auto rounded-md bg-neutral-100 p-2 text-[11px] text-neutral-600">
                          {JSON.stringify(log.data, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
      <ActionFeedbackModal
        open={Boolean(toast)}
        onClose={() => setToast(null)}
        tone={toast?.tone === "success" ? "success" : "error"}
        title={toast?.tone === "success" ? "Admin update complete" : "Admin action failed"}
        message={toast?.message ?? ""}
        autoCloseMs={toast?.tone === "success" ? 1600 : undefined}
      />
    </AppShell>
  );
}
