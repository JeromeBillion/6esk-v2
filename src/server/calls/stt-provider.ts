import { getObjectBuffer } from "@/server/storage/r2";

export type CallTranscriptProvider = "managed_http" | "mock";

export type SubmitTranscriptJobArgs = {
  jobId: string;
  callSessionId: string;
  recordingR2Key: string;
  callbackUrl: string;
  callbackSecret: string | null;
  metadata?: Record<string, unknown> | null;
};

export type SubmitTranscriptJobResult =
  | {
      status: "accepted";
      providerJobId: string | null;
    }
  | {
      status: "completed";
      providerJobId: string | null;
      transcriptText: string;
    };

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function getTranscriptProvider(): CallTranscriptProvider {
  const configured = readString(process.env.CALLS_STT_PROVIDER)?.toLowerCase();
  if (configured === "mock") {
    return "mock";
  }
  return "managed_http";
}

function getTranscriptProviderTimeoutMs() {
  const parsed = Number(process.env.CALLS_STT_PROVIDER_HTTP_TIMEOUT_MS ?? "15000");
  if (!Number.isFinite(parsed) || parsed < 1000) {
    return 15000;
  }
  return Math.floor(parsed);
}

async function submitViaManagedHttp({
  jobId,
  callSessionId,
  recordingR2Key,
  callbackUrl,
  callbackSecret,
  metadata
}: SubmitTranscriptJobArgs): Promise<SubmitTranscriptJobResult> {
  const providerUrl = readString(process.env.CALLS_STT_PROVIDER_HTTP_URL);
  if (!providerUrl) {
    throw new Error("CALLS_STT_PROVIDER_HTTP_URL is not configured.");
  }
  if (!callbackSecret) {
    throw new Error("CALLS_TRANSCRIPT_SHARED_SECRET or INBOUND_SHARED_SECRET is required.");
  }

  const { buffer, contentType } = await getObjectBuffer(recordingR2Key);
  if (!buffer.length) {
    throw new Error("Recording artifact is empty or unavailable.");
  }

  const form = new FormData();
  form.set(
    "job",
    JSON.stringify({
      jobId,
      callSessionId,
      callbackUrl,
      callbackSecret,
      metadata: metadata ?? {}
    })
  );
  form.append(
    "audio",
    new Blob([buffer], { type: contentType ?? "audio/mpeg" }),
    `call-${callSessionId}.mp3`
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTranscriptProviderTimeoutMs());

  try {
    const response = await fetch(providerUrl, {
      method: "POST",
      headers: {
        ...(readString(process.env.CALLS_STT_PROVIDER_HTTP_SECRET)
          ? { "x-6esk-secret": readString(process.env.CALLS_STT_PROVIDER_HTTP_SECRET)! }
          : {})
      },
      body: form,
      signal: controller.signal
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Transcript provider rejected job (${response.status})${detail ? `: ${detail}` : "."}`
      );
    }

    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const status = readString(body?.status)?.toLowerCase();
    const providerJobId = readString(body?.providerJobId) ?? readString(body?.jobId);

    if (status === "completed") {
      const transcriptText = readString(body?.transcriptText) ?? readString(body?.text);
      if (!transcriptText) {
        throw new Error("Transcript provider returned completed without transcript text.");
      }
      return {
        status: "completed",
        providerJobId,
        transcriptText
      };
    }

    return {
      status: "accepted",
      providerJobId
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Transcript provider timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function submitViaMock({
  callSessionId,
  metadata
}: SubmitTranscriptJobArgs): SubmitTranscriptJobResult {
  const summary =
    typeof metadata?.reason === "string" && metadata.reason.trim()
      ? metadata.reason.trim()
      : "Customer support call";
  return {
    status: "completed",
    providerJobId: `mock-stt-${callSessionId}`,
    transcriptText: `[mock transcript] ${summary}`
  };
}

export async function submitTranscriptJob(
  provider: CallTranscriptProvider,
  input: SubmitTranscriptJobArgs
): Promise<SubmitTranscriptJobResult> {
  if (provider === "mock") {
    return submitViaMock(input);
  }
  return submitViaManagedHttp(input);
}
