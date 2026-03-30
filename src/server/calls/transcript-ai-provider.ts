export type CallTranscriptAiProvider = "managed_http" | "mock";
export type CallTranscriptQaStatus = "pass" | "watch" | "review";
export type CallTranscriptQaSeverity = "low" | "medium" | "high" | "critical";
export type CallTranscriptQaFlag = {
  code: string;
  severity: CallTranscriptQaSeverity;
  title: string;
  detail: string;
  evidence: string | null;
};
export type CallTranscriptActionItem = {
  owner: "agent" | "supervisor" | "system";
  priority: "low" | "medium" | "high";
  description: string;
};

export type SubmitTranscriptAiJobArgs = {
  jobId: string;
  callSessionId: string;
  transcriptR2Key: string;
  transcriptText: string;
  metadata?: Record<string, unknown> | null;
};

export type SubmitTranscriptAiJobResult = {
  status: "completed";
  providerJobId: string | null;
  qaStatus: CallTranscriptQaStatus;
  summary: string;
  resolutionNote: string;
  qaFlags: CallTranscriptQaFlag[];
  actionItems: CallTranscriptActionItem[];
  rawResponse: Record<string, unknown> | null;
};

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getTranscriptAiProviderUrl() {
  const explicit = readString(process.env.CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_URL);
  if (explicit) return explicit;
  const appUrl = readString(process.env.APP_URL);
  if (!appUrl) {
    return null;
  }
  return `${trimTrailingSlash(appUrl)}/api/internal/calls/transcript-ai/provider`;
}

function getTranscriptAiProviderTimeoutMs() {
  const parsed = Number(process.env.CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_TIMEOUT_MS ?? "60000");
  if (!Number.isFinite(parsed) || parsed < 5000) {
    return 60000;
  }
  return Math.floor(parsed);
}

function parseFlag(value: unknown): CallTranscriptQaFlag | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const code = readString(row.code);
  const title = readString(row.title);
  const detail = readString(row.detail);
  const severity = readString(row.severity) as CallTranscriptQaSeverity | null;
  if (!code || !title || !detail || !severity) {
    return null;
  }
  if (!["low", "medium", "high", "critical"].includes(severity)) {
    return null;
  }
  return {
    code,
    severity,
    title,
    detail,
    evidence: readString(row.evidence)
  };
}

function parseActionItem(value: unknown): CallTranscriptActionItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  const owner = readString(row.owner) as CallTranscriptActionItem["owner"] | null;
  const priority = readString(row.priority) as CallTranscriptActionItem["priority"] | null;
  const description = readString(row.description);
  if (!owner || !priority || !description) {
    return null;
  }
  if (!["agent", "supervisor", "system"].includes(owner)) {
    return null;
  }
  if (!["low", "medium", "high"].includes(priority)) {
    return null;
  }
  return {
    owner,
    priority,
    description
  };
}

function normalizeManagedResponse(body: Record<string, unknown> | null): SubmitTranscriptAiJobResult {
  const status = readString(body?.status)?.toLowerCase();
  if (status !== "completed") {
    throw new Error("Transcript AI provider returned an incomplete response.");
  }

  const qaStatus = readString(body?.qaStatus) as CallTranscriptQaStatus | null;
  const summary = readString(body?.summary);
  const resolutionNote = readString(body?.resolutionNote);
  if (!qaStatus || !["pass", "watch", "review"].includes(qaStatus)) {
    throw new Error("Transcript AI provider returned an invalid QA status.");
  }
  if (!summary || !resolutionNote) {
    throw new Error("Transcript AI provider returned an incomplete analysis payload.");
  }

  const rawFlags = Array.isArray(body?.qaFlags) ? body.qaFlags : [];
  const rawActionItems = Array.isArray(body?.actionItems) ? body.actionItems : [];
  const flags = rawFlags
    .map(parseFlag)
    .filter((value): value is CallTranscriptQaFlag => Boolean(value));
  const actionItems = rawActionItems
    .map(parseActionItem)
    .filter((value): value is CallTranscriptActionItem => Boolean(value));

  return {
    status: "completed",
    providerJobId: readString(body?.providerJobId),
    qaStatus,
    summary,
    resolutionNote,
    qaFlags: flags,
    actionItems,
    rawResponse:
      body?.rawResponse && typeof body.rawResponse === "object" && !Array.isArray(body.rawResponse)
        ? (body.rawResponse as Record<string, unknown>)
        : null
  };
}

async function submitViaManagedHttp({
  jobId,
  callSessionId,
  transcriptR2Key,
  transcriptText,
  metadata
}: SubmitTranscriptAiJobArgs): Promise<SubmitTranscriptAiJobResult> {
  const providerUrl = getTranscriptAiProviderUrl();
  if (!providerUrl) {
    throw new Error("CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_URL or APP_URL is required.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTranscriptAiProviderTimeoutMs());

  try {
    const response = await fetch(providerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(readString(process.env.CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_SECRET)
          ? { "x-6esk-secret": readString(process.env.CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_SECRET)! }
          : {})
      },
      body: JSON.stringify({
        jobId,
        callSessionId,
        transcriptR2Key,
        transcriptText,
        metadata: metadata ?? {}
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Transcript AI provider rejected job (${response.status})${detail ? `: ${detail}` : "."}`
      );
    }

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    return normalizeManagedResponse(body);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Transcript AI provider timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function submitViaMock({
  callSessionId,
  transcriptText
}: SubmitTranscriptAiJobArgs): SubmitTranscriptAiJobResult {
  const hasEscalation = /refund|cancel|complaint|angry|escalat/i.test(transcriptText);
  return {
    status: "completed",
    providerJobId: `mock-transcript-ai-${callSessionId}`,
    qaStatus: hasEscalation ? "watch" : "pass",
    summary: transcriptText.slice(0, 240),
    resolutionNote: hasEscalation
      ? "Supervisor should review the call for escalation handling."
      : "Call completed without a QA issue in mock mode.",
    qaFlags: hasEscalation
      ? [
          {
            code: "escalation_language",
            severity: "medium",
            title: "Escalation language detected",
            detail: "The caller language suggests potential escalation or dissatisfaction.",
            evidence: transcriptText.slice(0, 180)
          }
        ]
      : [],
    actionItems: hasEscalation
      ? [
          {
            owner: "supervisor",
            priority: "medium",
            description: "Review the transcript and confirm whether a supervisor follow-up is required."
          }
        ]
      : [],
    rawResponse: {
      provider: "mock"
    }
  };
}

export function getTranscriptAiProvider(): CallTranscriptAiProvider {
  const configured = readString(process.env.CALLS_TRANSCRIPT_AI_PROVIDER)?.toLowerCase();
  if (configured === "mock") {
    return "mock";
  }
  return "managed_http";
}

export async function submitTranscriptAiJob(
  provider: CallTranscriptAiProvider,
  input: SubmitTranscriptAiJobArgs
): Promise<SubmitTranscriptAiJobResult> {
  if (provider === "mock") {
    return submitViaMock(input);
  }
  return submitViaManagedHttp(input);
}
