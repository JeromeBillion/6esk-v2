import PostalMime from "postal-mime";

function coerceAddressList(input: unknown) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const value =
        typeof (entry as { address?: unknown }).address === "string"
          ? (entry as { address: string }).address
          : typeof (entry as { name?: unknown }).name === "string"
            ? (entry as { name: string }).name
            : null;
      return value?.trim() || null;
    })
    .filter((value): value is string => Boolean(value));
}

export async function parseRawInboundEmail(raw: string, metadata?: Record<string, unknown> | null) {
  const parsed = await PostalMime.parse(raw);
  const messageIdHeader =
    typeof parsed.headers?.find((header) => header.key.toLowerCase() === "message-id")?.value === "string"
      ? String(parsed.headers.find((header) => header.key.toLowerCase() === "message-id")?.value)
      : null;
  const inReplyToHeader =
    typeof parsed.headers?.find((header) => header.key.toLowerCase() === "in-reply-to")?.value === "string"
      ? String(parsed.headers.find((header) => header.key.toLowerCase() === "in-reply-to")?.value)
      : null;
  const referencesHeader =
    typeof parsed.headers?.find((header) => header.key.toLowerCase() === "references")?.value === "string"
      ? String(parsed.headers.find((header) => header.key.toLowerCase() === "references")?.value)
      : null;

  return {
    from: parsed.from?.address ?? "",
    to: coerceAddressList(parsed.to),
    cc: coerceAddressList(parsed.cc),
    bcc: coerceAddressList(parsed.bcc),
    subject: parsed.subject ?? null,
    text: parsed.text ?? null,
    html: parsed.html ?? null,
    raw,
    messageId: messageIdHeader,
    inReplyTo: inReplyToHeader,
    references: referencesHeader
      ? referencesHeader
          .split(/\s+/)
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
    date: parsed.date ? new Date(parsed.date).toISOString() : null,
    attachments: (parsed.attachments ?? []).map((attachment) => ({
      filename: attachment.filename ?? attachment.mimeType ?? "attachment.bin",
      contentType: attachment.mimeType ?? null,
      size: typeof attachment.content === "string" ? Buffer.byteLength(attachment.content) : attachment.content?.byteLength ?? null,
      contentBase64:
        attachment.content instanceof Uint8Array
          ? Buffer.from(attachment.content).toString("base64")
          : typeof attachment.content === "string"
            ? Buffer.from(attachment.content).toString("base64")
            : null
    })),
    metadata
  };
}
