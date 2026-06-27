const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home"];

function parseIpv4(hostname: string) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts as [number, number, number, number];
}

function isBlockedIpv4(hostname: string) {
  const parts = parseIpv4(hostname);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function validatePublicHttpsUrl(value: string) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    if (value.length > 2048) {
      return { ok: false, message: "URL is too long." };
    }
    if (parsed.protocol !== "https:") {
      return { ok: false, message: "URL must use https." };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, message: "URL credentials are not allowed." };
    }
    if (
      hostname === "localhost" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.includes(":") ||
      BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix)) ||
      isBlockedIpv4(hostname)
    ) {
      return { ok: false, message: "URL must target a public host." };
    }
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, message: "URL is invalid." };
  }
}

export function isPublicHttpsUrl(value: string) {
  return validatePublicHttpsUrl(value).ok;
}
