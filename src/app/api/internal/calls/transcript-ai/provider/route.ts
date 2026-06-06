import { z } from "zod";

import {
  getGlobalAiProviderConfig,
  getGlobalAiResponsesUrl
} from "@/server/ai/global-provider";

export const runtime = "nodejs";

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
  transcriptText: z.string().min(1),
  metadata: z.record(z.unknown()).optional().nullable()
});

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function getInternalSecret() {
  return (
    readString(process.env.CALLS_TRANSCRIPT_AI_PROVIDER_HTTP_SECRET) ??
    readString(process.env.CALLS_STT_PROVIDER_HTTP_SECRET)
  );
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
  const expectedSecret = getInternalSecret();
  const providedSecret = request.headers.get("x-6esk-secret");
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let parsedJob: z.infer<typeof jobSchema>;
  try {
    parsedJob = jobSchema.parse(await request.json());
  } catch {
    return Response.json({ error: "Invalid transcript AI job payload." }, { status: 400 });
  }

  let config;
  try {
    config = getGlobalAiProviderConfig();
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Global AI provider is not configured." },
      { status: 500 }
    );
  }

  const prompt = buildPrompt(parsedJob);
  const response = await fetch(getGlobalAiResponsesUrl(config), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
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
    })
  });

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

  return Response.json({
    status: "completed",
    providerJobId: readString(body?.id) ?? parsedJob.jobId,
    provider: config.provider,
    model: config.model,
    summary: parsedAnalysis.summary,
    resolutionNote: parsedAnalysis.resolutionNote,
    qaStatus: parsedAnalysis.qaStatus,
    qaFlags: parsedAnalysis.qaFlags,
    actionItems: parsedAnalysis.actionItems,
    rawResponse: {
      id: readString(body?.id),
      provider: config.provider,
      model: readString(body?.model) ?? config.model,
      usage:
        body?.usage && typeof body.usage === "object" && !Array.isArray(body.usage)
          ? body.usage
          : null
    }
  });
}
