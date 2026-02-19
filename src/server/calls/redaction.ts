type JsonLike =
  | null
  | string
  | number
  | boolean
  | JsonLike[]
  | { [key: string]: JsonLike };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function looksLikePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

function isStandalonePhone(value: string) {
  const trimmed = value.trim();
  return looksLikePhone(trimmed) && /^[+()\s.\-\d]+$/.test(trimmed);
}

function maskFromDigits(raw: string) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    return raw;
  }
  const hasPlus = raw.trim().startsWith("+");
  const prefix = digits.slice(0, 4);
  const suffix = digits.slice(-2);
  return `${hasPlus ? "+" : ""}${prefix}******${suffix}`;
}

export function redactPhoneNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  if (/^(voice|whatsapp):/i.test(trimmed)) {
    const index = trimmed.indexOf(":");
    const channel = trimmed.slice(0, index);
    const remainder = trimmed.slice(index + 1);
    return `${channel}:${redactPhoneNumber(remainder)}`;
  }

  if (/^tel:/i.test(trimmed)) {
    return `tel:${redactPhoneNumber(trimmed.slice(4))}`;
  }

  if (isStandalonePhone(trimmed)) {
    return maskFromDigits(trimmed);
  }

  return value.replace(/\+?\d[\d()\s.-]{5,}\d/g, (match) => {
    if (!looksLikePhone(match)) {
      return match;
    }
    return maskFromDigits(match);
  });
}

function shouldTreatAsPhoneKey(key: string) {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("phone") ||
    normalized === "to" ||
    normalized === "from" ||
    normalized === "caller" ||
    normalized === "callee"
  );
}

function shouldScanTextForPhones(key: string) {
  const normalized = key.toLowerCase();
  return normalized.includes("error") || normalized.includes("detail") || normalized.includes("message");
}

function redactValue(value: unknown, key: string | null): unknown {
  if (typeof value === "string") {
    if (key && (shouldTreatAsPhoneKey(key) || shouldScanTextForPhones(key))) {
      return redactPhoneNumber(value);
    }
    if (/^(voice|whatsapp):/i.test(value.trim())) {
      return redactPhoneNumber(value);
    }
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key));
  }

  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      next[childKey] = redactValue(childValue, childKey);
    }
    return next;
  }

  return value;
}

export function redactCallData<T extends JsonLike | Record<string, unknown> | unknown>(value: T): T {
  return redactValue(value, null) as T;
}
