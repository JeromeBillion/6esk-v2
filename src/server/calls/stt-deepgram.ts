function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseExtra(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;
  const normalized: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    const stringValue = readString(entry);
    if (stringValue) {
      normalized[key] = stringValue;
    }
  }
  return Object.keys(normalized).length ? normalized : null;
}

function formatSpeakerLabel(value: unknown) {
  const speaker = readNumber(value);
  if (speaker == null) return null;
  return `Speaker ${speaker + 1}`;
}

function buildTranscriptFromUtterances(value: unknown) {
  const utterances = asArray(value);
  const lines = utterances
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const transcript = readString(record.transcript);
      if (!transcript) return null;
      const speakerLabel = formatSpeakerLabel(record.speaker);
      return speakerLabel ? `${speakerLabel}: ${transcript}` : transcript;
    })
    .filter((entry): entry is string => Boolean(entry));

  return lines.length ? lines.join("\n") : null;
}

function buildTranscriptFromChannels(value: unknown) {
  const channels = asArray(value);
  const chunks = channels
    .map((channel) => {
      const record = asRecord(channel);
      const alternatives = asArray(record?.alternatives);
      const primary = asRecord(alternatives[0]);
      return readString(primary?.transcript);
    })
    .filter((entry): entry is string => Boolean(entry));

  return chunks.length ? chunks.join("\n") : null;
}

export function normalizeDeepgramTranscriptPayload(payload: unknown) {
  const root = asRecord(payload);
  const metadata = asRecord(root?.metadata);
  const results = asRecord(root?.results);
  if (!metadata || !results) {
    return null;
  }

  const requestId = readString(root?.request_id) ?? readString(metadata.request_id);
  if (!requestId) {
    return null;
  }

  const extra = parseExtra(metadata.extra);
  const transcriptText =
    buildTranscriptFromUtterances(results.utterances) ??
    buildTranscriptFromChannels(results.channels);

  if (!transcriptText) {
    return null;
  }

  const utteranceCount = asArray(results.utterances).length;
  const channels = asArray(results.channels);
  const primaryChannel = asRecord(channels[0]);
  const primaryAlternative = asRecord(asArray(primaryChannel?.alternatives)[0]);

  return {
    callSessionId: extra?.callSessionId ?? null,
    provider: "deepgram",
    providerCallId: extra?.providerCallId ?? null,
    transcriptText,
    transcriptUrl: null,
    payload: {
      source: "deepgram",
      providerJobId: requestId,
      modelUuid: readString(metadata.model_uuid),
      transactionKey: readString(metadata.transaction_key),
      requestId,
      extra,
      duration: readNumber(metadata.duration),
      channels: channels.length,
      utterances: utteranceCount,
      language: readString(primaryAlternative?.detected_language) ?? readString(primaryAlternative?.language)
    }
  };
}
