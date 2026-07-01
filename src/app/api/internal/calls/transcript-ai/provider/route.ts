import { timingSafeEqual } from "crypto";
import { z } from "zod";

import {
  createAiProviderAbortSignal,
  getAiProviderResponsesUrl,
  resolveTenantAiProviderPlan
} from "@/server/ai/provider-gateway";
import { validateAgentOutput } from "@/server/agents/output-validator";
import { resolveCallSessionProviderScope } from "@/server/calls/service";
import { recordModuleUsageEvent } from "@/server/module-metering";
import {
  listActiveProviderWebhookSecrets,
  markProviderWebhookSecretUsed,
  ProviderWebhookSecretConfigurationError,
  shouldRequireTenantProviderWebhookSecrets,
  type ActiveProviderWebhookSecret
} from "@/server/provider-webhook-secrets";
import { checkModuleEntitlement } from "@/server/tenant/module-guard";

export const runtime = "nodejs";

const MAX_TRANSCRIPT_AI_JOB_BYTES = 2 * 1024 * 1024;
const MAX_TRANSCRIPT_TEXT_CHARS = 250_000;

const qaFlagSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().min(1),
  detail: z.string().min(1),
  evidence: z.string().trim().nullable().optional().default(null)
});

const actionItemSchema = z.object({
  owner: z.enum(["agent", "supervisor", "system"]),
  priority: z.enum(["low", "medium", "high"]),
  description: z.string().min(1)
});

const analysisSchema = z.object({
  summary: z.string().min(1),
  resolutionNote: z.string().min(1),
  qaStatus: z.enum(["pass", "watch", "review"]),
  qaFlags: z.array(qaFlagSchema).max(8),
  actionItems: z.array(actionItemSchema).max(8)
});

const jobSchema = z.object({
  jobId: z.string().uuid(),
  callSessionId: z.string().uuid(),
  transcriptR2Key: z.string().min(1),
  transcriptText: z.string().min(1).max(MAX_TRANSCRIPT_TEXT_CHARS),
  metadata: z.record(z.unknown()).optional().nullable()
});

const tenantIdSchema = z.string().uuid();

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function resolveTenantId(metadata: Record<string, unknown> | null | undefined) {
  const candidate = readString(metadata?.tenantId) ?? readString(metadata?.tenant_id);
  const parsed = tenantIdSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function getInternalSecret() {
  return (
    readString(process.env.CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_SECRET) ??
    readString(process.env.CALLS_STT_PROVIDER_HTTP_SECRET)
  );
}

function constantTimeEquals(left: string | null | undefined, right: string) {
  const leftValue = readString(left);
  if (!leftValue) return false;
  const leftBuffer = Buffer.from(leftValue, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function isContentLengthTooLarge(request: Request) {
  const raw = request.headers.get("content-length");
  if (!raw) return false;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > MAX_TRANSCRIPT_AI_JOB_BYTES;
}

async function parseJobPayload(request: Request) {
  const bodyText = await request.text();
  if (Buffer.byteLength(bodyText, "utf8") > MAX_TRANSCRIPT_AI_JOB_BYTES) {
    throw new Error("payload_too_large");
  }
  return jobSchema.parse(JSON.parse(bodyText));
}

async function listTenantAiHttpSecrets(scope: { tenantId: string; workspaceKey: string }) {
  try {
    return await listActiveProviderWebhookSecrets({
      scope,
      provider: "managed_ai",
      secretType: "http_secret"
    });
  } catch (error) {
    if (error instanceof ProviderWebhookSecretConfigurationError) {
      throw error;
    }
    throw error;
  }
}

function findMatchingSecret(
  providedSecret: string | null,
  providerSecrets: ActiveProviderWebhookSecret[]
) {
  return providerSecrets.find((secret) => constantTimeEquals(providedSecret, secret.secret)) ?? null;
}

function buildPrompt(parsedJob: z.infer<typeof jobSchema>) {
  const context = {
    ticketId:
      typeof parsedJob.metadata?.ticketId === "string" ? parsedJob.metadata.ticketId : null,
    provider:
      typeof parsedJob.metadata?.provider === "string" ? parsedJob.metadata.provider : null,
    durationSeconds:
      typeof parsedJob.metadata?.durationSeconds === "number"
        ? parsedJob.metadata.durationSeconds
        : null
  };

  return [
    "You are reviewing a support call transcript for operational QA.",
    "Return only the requested JSON object.",
    "Assess whether the call handling deserves no concern, monitoring, or explicit human review.",
    "Flag only meaningful QA issues. Do not invent policy breaches.",
    "Use concise, operator-friendly language.",
    "",
    "Required JSON fields:",
    "- summary: short factual summary of the call",
    "- resolutionNote: what happened or what should happen next",
    "- qaStatus: one of pass, watch, review",
    "- qaFlags: zero or more concrete QA issues",
    "- actionItems: zero or more follow-up actions",
    "",
    `Context: ${JSON.stringify(context)}`,
    "",
    "Transcript:",
    parsedJob.transcriptText
  ].join("\n");
}

function extractResponseText(body: Record<string, unknown> | null) {
  const direct = readString(body?.output_text);
  if (direct) {
    return direct;
  }

  const output = Array.isArray(body?.output) ? body.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as Array<Record<string, unknown>>)
      : [];
    for (const block of content) {
      const text =
        readString(block.text) ?? readString(block.output_text) ?? readString(block.value);
      if (text) {
        return text;
      }
    }
  }
  return null;
}

export async function POST(request: Request) {
  const providedSecret = request.headers.get("x-6esk-secret");
  const requireTenantSecrets = shouldRequireTenantProviderWebhookSecrets();
  if (isContentLengthTooLarge(request)) {
    return Response.json({ error: "Transcript AI job payload is too large." }, { status: 413 });
  }

  if (!requireTenantSecrets) {
    const expectedSecret = getInternalSecret();
    if (!expectedSecret || !constantTimeEquals(providedSecret, expectedSecret)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let parsedJob: z.infer<typeof jobSchema>;
  try {
    parsedJob = await parseJobPayload(request);
  } catch (error) {
    if (error instanceof Error && error.message === "payload_too_large") {
      return Response.json({ error: "Transcript AI job payload is too large." }, { status: 413 });
    }
    return Response.json({ error: "Invalid transcript AI job payload." }, { status: 400 });
  }

  const tenantId = resolveTenantId(parsedJob.metadata);
  if (!tenantId) {
    return Response.json(
      { error: "Transcript AI job metadata must include a valid tenantId." },
      { status: 400 }
    );
  }

  if (requireTenantSecrets) {
    const scope = await resolveCallSessionProviderScope({
      callSessionId: parsedJob.callSessionId
    });
    if (!scope) {
      return Response.json(
        { error: "Call session not found", code: "unresolved_call_provider_route" },
        { status: 404 }
      );
    }
    if (scope.tenantId !== tenantId) {
      return Response.json(
        { error: "Transcript AI job tenant does not match the call session.", code: "tenant_mismatch" },
        { status: 403 }
      );
    }

    let providerSecrets: ActiveProviderWebhookSecret[];
    try {
      providerSecrets = await listTenantAiHttpSecrets(scope);
    } catch (error) {
      if (error instanceof ProviderWebhookSecretConfigurationError) {
        return Response.json(
          { error: error.message, code: "provider_webhook_secret_configuration_missing" },
          { status: 503 }
        );
      }
      throw error;
    }

    if (!providerSecrets.length) {
      return Response.json(
        {
          error: "Provider webhook secret is not configured for this tenant.",
          code: "provider_webhook_secret_missing"
        },
        { status: 503 }
      );
    }

    const matchedSecret = findMatchingSecret(providedSecret, providerSecrets);
    if (!matchedSecret) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    await markProviderWebhookSecretUsed(matchedSecret.id, scope).catch(() => {});
  }

  if (!(await checkModuleEntitlement("aiAutomation", tenantId))) {
    return Response.json(
      {
        error: "AI Automation module is not enabled for this tenant.",
        code: "module_disabled",
        module: "aiAutomation"
      },
      { status: 409 }
    );
  }

  const providerPlan = await resolveTenantAiProviderPlan(tenantId);
  if (providerPlan.status === "misconfigured") {
    return Response.json(
      { error: providerPlan.denialReason },
      { status: 500 }
    );
  }

  if (providerPlan.status === "disabled") {
    return Response.json(
      { error: "Tenant AI provider is disabled for transcript analysis." },
      { status: 403 }
    );
  }

  const prompt = buildPrompt(parsedJob);
  const abort = createAiProviderAbortSignal(providerPlan.timeoutMs);
  let response: Response;
  try {
    response = await fetch(getAiProviderResponsesUrl(providerPlan), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${providerPlan.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: providerPlan.model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text:
                  "You analyze support-call transcripts and produce strict operational QA JSON."
              }
            ]
          },
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }]
          }
        ],
        max_output_tokens: 1200,
        text: {
          format: {
            type: "json_schema",
            name: "call_transcript_analysis",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["summary", "resolutionNote", "qaStatus", "qaFlags", "actionItems"],
              properties: {
                summary: { type: "string" },
                resolutionNote: { type: "string" },
                qaStatus: { type: "string", enum: ["pass", "watch", "review"] },
                qaFlags: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["code", "severity", "title", "detail", "evidence"],
                    properties: {
                      code: { type: "string" },
                      severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                      title: { type: "string" },
                      detail: { type: "string" },
                      evidence: { type: ["string", "null"] }
                    }
                  }
                },
                actionItems: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["owner", "priority", "description"],
                    properties: {
                      owner: { type: "string", enum: ["agent", "supervisor", "system"] },
                      priority: { type: "string", enum: ["low", "medium", "high"] },
                      description: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }),
      signal: abort.signal
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Provider request failed";
    return Response.json(
      {
        error: "Global AI transcript analysis failed.",
        detail
      },
      { status: 502 }
    );
  } finally {
    abort.clear();
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return Response.json(
      {
        error: "Global AI transcript analysis failed.",
        detail: detail || `HTTP ${response.status}`
      },
      { status: 502 }
    );
  }

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const outputText = extractResponseText(body);
  if (!outputText) {
    return Response.json(
      { error: "Global AI transcript analysis returned no output." },
      { status: 502 }
    );
  }

  let parsedAnalysis: z.infer<typeof analysisSchema>;
  try {
    parsedAnalysis = analysisSchema.parse(JSON.parse(outputText));
  } catch {
    return Response.json(
      { error: "Global AI transcript analysis returned invalid JSON." },
      { status: 502 }
    );
  }

  const outputValidation = await validateAgentOutput({
    tenantId,
    actionType: "transcript_analysis",
    resourceType: "call_transcript_ai_jobs",
    resourceId: parsedJob.jobId,
    content: parsedAnalysis,
    metadata: {
      provider: providerPlan.provider,
      model: providerPlan.model,
      callSessionId: parsedJob.callSessionId
    }
  });

  const usage = body?.usage as any;
  const inputTokens = usage?.input_tokens ?? usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? usage?.completion_tokens ?? 0;

  // Record usage for FinOps. 
  // We record tokens. The billing system will apply the zero-markup pricing logic.
  await recordModuleUsageEvent({
    tenantId,
    moduleKey: providerPlan.costCapture.moduleKey,
    usageKind: "transcript_analysis",
    actorType: "ai",
    providerMode: providerPlan.providerMode,
    quantity: inputTokens + outputTokens,
    unit: providerPlan.costCapture.unit,
    metadata: {
      model: providerPlan.model,
      provider: providerPlan.provider,
      fallbackModels: providerPlan.fallbackModels,
      timeoutMs: providerPlan.timeoutMs,
      inputTokens,
      outputTokens,
      jobId: parsedJob.jobId,
      callSessionId: parsedJob.callSessionId,
      outputValidationDecision: outputValidation.decision,
      outputValidationRiskLevel: outputValidation.riskLevel
    }
  });

  if (!outputValidation.allowed) {
    return Response.json(
      {
        error: "Global AI transcript analysis returned unsafe output.",
        reasonCodes: outputValidation.reasonCodes
      },
      { status: 502 }
    );
  }

  return Response.json({
    status: "completed",
    providerJobId: readString(body?.id) ?? parsedJob.jobId,
    provider: providerPlan.provider,
    model: providerPlan.model,
    summary: parsedAnalysis.summary,
    resolutionNote: parsedAnalysis.resolutionNote,
    qaStatus: parsedAnalysis.qaStatus,
    qaFlags: parsedAnalysis.qaFlags,
    actionItems: parsedAnalysis.actionItems,
    rawResponse: {
      id: readString(body?.id),
      provider: providerPlan.provider,
      model: readString(body?.model) ?? providerPlan.model,
      usage:
        body?.usage && typeof body.usage === "object" && !Array.isArray(body.usage)
          ? body.usage
          : null
    }
  });
}
