import { z } from "zod";

export const runtime = "nodejs";

const jobSchema = z.object({
  jobId: z.string().uuid(),
  callSessionId: z.string().uuid(),
  callbackUrl: z.string().url(),
  callbackSecret: z.string().optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable()
});

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function appendDeepgramExtras(url: URL, values: Record<string, string | null | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    const normalized = readString(value);
    if (normalized) {
      url.searchParams.append("extra", `${key}:${normalized}`);
    }
  }
}

function withCallbackToken(callbackUrl: string, callbackToken: string) {
  const callback = new URL(callbackUrl);
  callback.searchParams.set("callback_token", callbackToken);
  return callback.toString();
}

function buildDeepgramUrl(
  callbackUrl: string,
  callbackToken: string,
  metadata: Record<string, unknown> | null
) {
  const baseUrl =
    readString(process.env.CALLS_STT_DEEPGRAM_API_URL) ?? "https://api.deepgram.com/v1/listen";
  const url = new URL(baseUrl);
  url.searchParams.set("callback", withCallbackToken(callbackUrl, callbackToken));
  url.searchParams.set("callback_method", "POST");
  url.searchParams.set("punctuate", "true");
  url.searchParams.set("smart_format", "true");
  url.searchParams.set("diarize", process.env.CALLS_STT_DEEPGRAM_DIARIZE?.trim() ?? "true");
  url.searchParams.set("utterances", process.env.CALLS_STT_DEEPGRAM_UTTERANCES?.trim() ?? "true");

  const configuredModel = readString(process.env.CALLS_STT_DEEPGRAM_MODEL);
  if (configuredModel) {
    url.searchParams.set("model", configuredModel);
  }

  const configuredLanguage = readString(process.env.CALLS_STT_DEEPGRAM_LANGUAGE);
  if (configuredLanguage) {
    url.searchParams.set("language", configuredLanguage);
  } else {
    url.searchParams.set(
      "detect_language",
      process.env.CALLS_STT_DEEPGRAM_DETECT_LANGUAGE?.trim() ?? "true"
    );
  }

  appendDeepgramExtras(url, {
    jobId: readString(metadata?.jobId),
    callSessionId: readString(metadata?.callSessionId),
    providerCallId: readString(metadata?.providerCallId),
    ticketId: readString(metadata?.ticketId),
    messageId: readString(metadata?.messageId)
  });

  return url;
}

export async function POST(request: Request) {
  const expectedSecret = readString(process.env.CALLS_STT_PROVIDER_HTTP_SECRET);
  const providedSecret = request.headers.get("x-6esk-secret");

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = readString(process.env.CALLS_STT_DEEPGRAM_API_KEY);
  const callbackToken = readString(process.env.CALLS_STT_DEEPGRAM_CALLBACK_TOKEN);
  if (!apiKey) {
    return Response.json({ error: "CALLS_STT_DEEPGRAM_API_KEY is not configured." }, { status: 500 });
  }
  if (!callbackToken) {
    return Response.json(
      { error: "CALLS_STT_DEEPGRAM_CALLBACK_TOKEN is not configured." },
      { status: 500 }
    );
  }

  const formData = await request.formData();
  const rawJob = formData.get("job");
  const audio = formData.get("audio");

  let parsedJob: z.infer<typeof jobSchema>;
  try {
    const jobPayload =
      typeof rawJob === "string" ? JSON.parse(rawJob) : JSON.parse(String(rawJob ?? ""));
    parsedJob = jobSchema.parse(jobPayload);
  } catch {
    return Response.json({ error: "Invalid transcript job payload." }, { status: 400 });
  }

  if (!(audio instanceof File)) {
    return Response.json({ error: "Audio file is required." }, { status: 400 });
  }

  const metadata = {
    ...(asRecord(parsedJob.metadata) ?? {}),
    jobId: parsedJob.jobId,
    callSessionId: parsedJob.callSessionId
  };
  const audioBuffer = Buffer.from(await audio.arrayBuffer());
  const deepgramUrl = buildDeepgramUrl(parsedJob.callbackUrl, callbackToken, metadata);

  const response = await fetch(deepgramUrl, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": audio.type || "audio/mpeg"
    },
    body: audioBuffer
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return Response.json(
      {
        error: "Deepgram transcript submission failed.",
        detail: detail || `HTTP ${response.status}`
      },
      { status: 502 }
    );
  }

  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const providerJobId =
    readString(body?.request_id) ??
    readString(asRecord(body?.metadata)?.request_id) ??
    parsedJob.jobId;

  return Response.json({
    status: "accepted",
    providerJobId
  });
}
