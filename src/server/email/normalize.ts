export function extractEmail(raw: string) {
  const trimmed = raw.trim();
  const match = trimmed.match(/<([^>]+)>/);
  if (match?.[1]) {
    return match[1].trim().toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function normalizeAddressList(input?: string | string[] | null) {
  if (!input) {
    return [];
  }
  const list = Array.isArray(input) ? input : [input];
  return list
    .map((value) => extractEmail(value))
    .filter((value) => value.length > 0);
}

export function sanitizeFilename(filename: string) {
  return filename.replace(/[\\/:*?"<>|]+/g, "_");
}
