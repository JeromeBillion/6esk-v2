"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bot, Phone, RefreshCw, Shield, Users, Workflow } from "lucide-react";
import AppShell from "@/app/components/AppShell";
import { ActionFeedbackModal } from "@/app/workspace/components/ActionFeedbackModal";
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
  AgentOutboxMetrics,
  AdminUserRecord,
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
  SpamMessageRecord,
  SpamRuleRecord,
  TagRecord,
  WhatsAppTemplate,
  WhatsAppOutboxMetrics,
  batchRecoverDeadLetters,
  createAgentIntegration,
  createSpamRule,
  createTag,
  createUser,
  createWhatsAppTemplate,
  deleteSpamRule,
  deleteTag,
  deleteWhatsAppTemplate,
  deliverAgentOutbox,
  getAgentOutboxMetrics,
  getCallRejections,
  getCallOutboxMetrics,
  getDeadLetterSummary,
  getInboundSettings,
  getInboundMetrics,
  getProfileLookupMetrics,
  getSecuritySnapshot,
  getSlaConfig,
  getWhatsAppAccount,
  getWhatsAppOutboxMetrics,
  listAgentIntegrations,
  listAuditLogs,
  listFailedCallEvents,
  listFailedInboundEvents,
  listDeadLetterEvents,
  listRoles,
  listSpamMessages,
  listSpamRules,
  listTags,
  listUsers,
  listWhatsAppTemplates,
  patchDeadLetterEvent,
  requestPasswordResetLink,
  retryFailedCallEvents,
  retryInboundEvents,
  runCallOutbox,
  runInboundAlertCheck,
  runWhatsAppOutbox,
  saveWhatsAppAccount,
  setMessageSpamStatus,
  updateAgentIntegration,
  updateInboundSettings,
  updateSlaConfig,
  updateSpamRule,
  updateTag,
  updateUser,
  updateWhatsAppTemplate
} from "@/app/lib/api/admin";
import { ApiError } from "@/app/lib/api/http";
import { Checkbox } from "@/app/workspace/components/ui/checkbox";

type TabKey = "overview" | "workspace" | "automation" | "operations";
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

type UserForm = {
  email: string;
  displayName: string;
  password: string;
  roleId: string;
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

type AgentForm = {
  name: string;
  provider: string;
  baseUrl: string;
  authType: string;
  sharedSecret: string;
  status: "active" | "paused";
  policyMode: "draft_only" | "auto_send";
  maxEventsPerRun: string;
  allowMergeActions: boolean;
  allowVoiceActions: boolean;
  scopesJson: string;
  policyJson: string;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
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
    policyMode: "draft_only",
    maxEventsPerRun: "",
    allowMergeActions: false,
    allowVoiceActions: false,
    scopesJson: "{}",
    policyJson: "{}"
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

const TAB_VALUES = new Set(["overview", "workspace", "automation", "operations"]);
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
    automation: false,
    operations: false
  });
  const [loaded, setLoaded] = useState<Record<TabKey, boolean>>({
    overview: false,
    workspace: false,
    automation: false,
    operations: false
  });
  const [toast, setToast] = useState<ToastState>(null);

  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [userForm, setUserForm] = useState<UserForm>({ email: "", displayName: "", password: "", roleId: "" });
  const [sla, setSla] = useState<SlaForm>({ firstResponseMinutes: 120, resolutionMinutes: 1440 });
  const [security, setSecurity] = useState<SecuritySnapshot | null>(null);

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
  const [showAgentSecret, setShowAgentSecret] = useState(false);
  const [profileDays, setProfileDays] = useState(14);
  const [profile, setProfile] = useState<ProfileLookupMetrics | null>(null);

  const [inbound, setInbound] = useState<InboundMetrics | null>(null);
  const [inboundSettings, setInboundSettings] = useState<InboundAlertConfig | null>(null);
  const [failedInboundEvents, setFailedInboundEvents] = useState<InboundFailedEvent[]>([]);
  const [calls, setCalls] = useState<CallOutboxMetrics | null>(null);
  const [failedCallEvents, setFailedCallEvents] = useState<CallFailedEvent[]>([]);
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
      const [tagRows, ruleRows, spamRows, accountPayload, templates, outbox] = await Promise.all([
        listTags(),
        listSpamRules(),
        listSpamMessages(25),
        getWhatsAppAccount(),
        listWhatsAppTemplates(),
        getWhatsAppOutboxMetrics()
      ]);
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
      const [agentRows, metrics] = await Promise.all([
        listAgentIntegrations(),
        getProfileLookupMetrics(profileDays)
      ]);
      setAgents(agentRows);
      setProfile(metrics);
      const nextAgent = agentRows.find((agent) => agent.id === selectedAgentId) ?? agentRows[0] ?? null;
      setSelectedAgentId(nextAgent?.id ?? "");
      if (nextAgent) {
        setAgentForm(mapAgentToForm(nextAgent));
        const outbox = await getAgentOutboxMetrics(nextAgent.id).catch(() => null);
        setAgentOutbox(outbox);
      } else {
        setAgentForm(defaultAgentForm());
        setAgentOutbox(null);
      }
      setLoaded((prev) => ({ ...prev, automation: true }));
    } catch (error) {
      pushError(error, "Failed loading automation tab");
    } finally {
      setLoading((prev) => ({ ...prev, automation: false }));
    }
  }, [profileDays, pushError, selectedAgentId]);

  const loadOperations = useCallback(async () => {
    setLoading((prev) => ({ ...prev, operations: true }));
    try {
      const [
        inboundMetrics,
        inboundConfig,
        inboundFailedRows,
        callMetrics,
        failedCalls,
        rejectionMetrics,
        deadLetterPayload,
        deadLetterRows,
        logs
      ] = await Promise.all([
        getInboundMetrics(operationsFilters.windowHours),
        getInboundSettings(),
        listFailedInboundEvents(operationsFilters.eventLimit),
        getCallOutboxMetrics(),
        listFailedCallEvents(operationsFilters.eventLimit),
        getCallRejections(operationsFilters.windowHours, operationsFilters.eventLimit),
        getDeadLetterSummary(),
        listDeadLetterEvents({ limit: operationsFilters.eventLimit, status: "all" }),
        listAuditLogs(operationsFilters.auditLimit)
      ]);
      setInbound(inboundMetrics);
      setInboundSettings(inboundConfig.config);
      setFailedInboundEvents(inboundFailedRows);
      setCalls(callMetrics);
      setFailedCallEvents(failedCalls);
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
    if (activeTab === "automation") await loadAutomation();
    if (activeTab === "operations") await loadOperations();
  }, [activeTab, loadAutomation, loadOperations, loadOverview, loadWorkspace]);

  const whatsAppWebhookUrl =
    typeof window !== "undefined" ? `${window.location.origin}/api/whatsapp/inbound` : "";
  const whatsAppStatusWarnings: string[] = [];
  if (whatsAppForm.status === "active" && !whatsAppForm.accessToken.trim()) {
    whatsAppStatusWarnings.push("Access token is required while the account is Active.");
  }
  if (whatsAppForm.provider === "meta" && !whatsAppForm.verifyToken.trim()) {
    whatsAppStatusWarnings.push("Verify token is empty. Meta webhook verification will fail.");
  }

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
    if (activeTab === "operations" && !loaded.operations) {
      void loadOperations();
    }
  }, [activeTab, loadAutomation, loadOperations, loadOverview, loadWorkspace, loaded]);

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

          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="overview" className="gap-2">
                <Shield className="w-4 h-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="workspace" className="gap-2">
                <Workflow className="w-4 h-4" />
                Messaging
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
                      const agent = agents.find((item) => item.id === id);
                      setAgentForm(agent ? mapAgentToForm(agent) : defaultAgentForm());
                    }}>
                      <option value="">Create new</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                      ))}
                    </select>
                    <Button variant="outline" onClick={() => { setSelectedAgentId(""); setAgentForm(defaultAgentForm()); }}>New</Button>
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
                          policyMode: event.target.value as "draft_only" | "auto_send"
                        }))
                      }
                    >
                      <option value="draft_only">Draft only</option>
                      <option value="auto_send">Auto-send</option>
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
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="outline" onClick={() => void runCallOutbox(operationsFilters.eventLimit).then(loadOperations)}>Run Outbox</Button>
                      <Button variant="outline" onClick={() => void retryFailedCallEvents(operationsFilters.eventLimit).then(loadOperations)}>Retry Failed</Button>
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
