export function extractEmail(raw: string) {
  const trimmed = raw.trim();
  const match = trimmed.match(/<([^>]+)>/);
  if (match?.[1]) {
    return match[1].trim().toLowerCase();
  }
  return trimmed.toLowerCase();
}

export function isValidEmailAddress(value: string) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
}

export function findInvalidEmailAddresses(input?: string | string[] | null) {
  if (!input) {
    return [];
  }
  const list = Array.isArray(input) ? input : [input];
  return Array.from(
    new Set(
      list
        .flatMap((value) => value.split(/[;,\r\n]+/))
        .map((value) => ({ raw: value.trim(), normalized: extractEmail(value) }))
        .filter((entry) => entry.raw.length > 0 && !isValidEmailAddress(entry.normalized))
        .map((entry) => entry.raw)
    )
  );
}

export function normalizeAddressList(input?: string | string[] | null) {
  if (!input) {
    return [];
  }
  const list = Array.isArray(input) ? input : [input];
  return Array.from(
    new Set(
      list
        .flatMap((value) => value.split(/[;,\r\n]+/))
        .map((value) => extractEmail(value))
        .filter((value) => value.length > 0 && isValidEmailAddress(value))
    )
  );
}

export function sanitizeFilename(filename: string) {
  return filename.replace(/[\\/:*?"<>|]+/g, "_");
}
