export type AttachmentPolicyInput = {
  filename?: string | null;
  contentType?: string | null;
  contentBase64?: string | null;
};

export type AttachmentPolicyResult =
  | {
      ok: true;
      totalBytes: number;
    }
  | {
      ok: false;
      message: string;
    };

export const DEFAULT_ATTACHMENT_LIMITS = {
  maxCount: 10,
  maxBytesPerAttachment: 10 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
  maxFilenameLength: 255,
  maxContentTypeLength: 120
};

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function estimateBase64DecodedBytes(value: string) {
  const normalized = value.replace(/\s/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !BASE64_RE.test(normalized)) {
    return null;
  }
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return normalized.length * 0.75 - padding;
}

export function validateAttachmentList(
  attachments: AttachmentPolicyInput[] | null | undefined,
  limits = DEFAULT_ATTACHMENT_LIMITS
): AttachmentPolicyResult {
  if (!attachments?.length) {
    return { ok: true, totalBytes: 0 };
  }

  if (attachments.length > limits.maxCount) {
    return { ok: false, message: `At most ${limits.maxCount} attachments are allowed.` };
  }

  let totalBytes = 0;
  for (const attachment of attachments) {
    const filename = attachment.filename?.trim() ?? "";
    if (!filename || filename.length > limits.maxFilenameLength) {
      return { ok: false, message: "Attachment filename is missing or too long." };
    }

    const contentType = attachment.contentType?.trim() ?? "";
    if (contentType.length > limits.maxContentTypeLength) {
      return { ok: false, message: "Attachment content type is too long." };
    }

    const contentBase64 = attachment.contentBase64?.trim() ?? "";
    if (!contentBase64) {
      return { ok: false, message: "Attachment content is required." };
    }

    const decodedBytes = estimateBase64DecodedBytes(contentBase64);
    if (decodedBytes === null) {
      return { ok: false, message: "Attachment content must be valid base64." };
    }

    if (decodedBytes > limits.maxBytesPerAttachment) {
      return { ok: false, message: "Attachment exceeds the per-file size limit." };
    }

    totalBytes += decodedBytes;
    if (totalBytes > limits.maxTotalBytes) {
      return { ok: false, message: "Attachments exceed the total size limit." };
    }
  }

  return { ok: true, totalBytes };
}
