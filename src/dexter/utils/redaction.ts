export interface RedactionOptions {
  fullMask?: string;
  partialPrefixLength?: number;
  partialSuffixLength?: number;
}

const FULL_MASK = '[REDACTED]';

const FULLY_REDACTED_KEYS = [
  'apikey',
  'api_key',
  'access_token',
  'refresh_token',
  'authorization',
  'secret',
  'password',
  'x-6esk-signature',
  'x-hub-signature-256',
  'x-eliza-auth-token',
  'x-6esk-agent-key',
  'elevenlabs_api_key',
  'groq_api_key',
] as const;

const PARTIALLY_REDACTED_KEYS = ['email', 'phone', 'wa_id', 'customer_id'] as const;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const normalizeKey = (key: string): string => key.trim().toLowerCase();

const maskIdentifier = (value: string, options: RedactionOptions): string => {
  const prefixLength = options.partialPrefixLength ?? 3;
  const suffixLength = options.partialSuffixLength ?? 3;
  if (value.length <= prefixLength + suffixLength) {
    return `${value.slice(0, 1)}***${value.slice(-1)}`;
  }
  return `${value.slice(0, prefixLength)}...${value.slice(-suffixLength)}`;
};

const shouldFullyRedactKey = (normalizedKey: string): boolean =>
  FULLY_REDACTED_KEYS.some((entry) => normalizedKey.includes(entry));

const shouldPartiallyRedactKey = (normalizedKey: string): boolean =>
  PARTIALLY_REDACTED_KEYS.some((entry) => normalizedKey.includes(entry));

const redactValue = (
  value: unknown,
  options: RedactionOptions,
  key: string | null,
  path: string
): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry, index) => redactValue(entry, options, null, `${path}[${index}]`));
  }

  if (!isPlainObject(value)) {
    if (typeof value === 'string' && key) {
      const normalizedKey = normalizeKey(key);
      if (shouldFullyRedactKey(normalizedKey)) {
        return options.fullMask ?? FULL_MASK;
      }
      if (shouldPartiallyRedactKey(normalizedKey)) {
        return maskIdentifier(value, options);
      }
    }
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    const normalizedKey = normalizeKey(entryKey);
    if (shouldFullyRedactKey(normalizedKey)) {
      output[entryKey] = options.fullMask ?? FULL_MASK;
      continue;
    }

    if (typeof entryValue === 'string' && shouldPartiallyRedactKey(normalizedKey)) {
      output[entryKey] = maskIdentifier(entryValue, options);
      continue;
    }

    output[entryKey] = redactValue(
      entryValue,
      options,
      entryKey,
      path === '$' ? `$.${entryKey}` : `${path}.${entryKey}`
    );
  }
  return output;
};

export const redactSensitivePayload = <T>(value: T, options: RedactionOptions = {}): T =>
  redactValue(value, options, null, '$') as T;

export const redactSensitiveLogContext = <T>(
  value: T,
  options: RedactionOptions = {}
): T => redactSensitivePayload(value, options);

