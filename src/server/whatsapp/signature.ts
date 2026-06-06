import { createHmac, timingSafeEqual } from "crypto";

function normalizeSignature(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().startsWith("sha256=") ? trimmed : `sha256=${trimmed}`;
}

export function buildWhatsAppSignature(body: string, appSecret: string) {
  const digest = createHmac("sha256", appSecret).update(body).digest("hex");
  return `sha256=${digest}`;
}

export function verifyWhatsAppSignature({
  body,
  providedSignature,
  appSecret,
  requireSignature = false
}: {
  body: string;
  providedSignature: string | null | undefined;
  appSecret: string | null | undefined;
  requireSignature?: boolean;
}) {
  if (!appSecret) {
    return !requireSignature;
  }

  const normalizedProvided = normalizeSignature(providedSignature);
  if (!normalizedProvided) {
    return false;
  }

  const expected = buildWhatsAppSignature(body, appSecret);
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(normalizedProvided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
