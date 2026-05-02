const QUOTE_BLOCK_MARKERS = [
  /^>+/,
  /^On .+ wrote:$/i,
  /^-{2,}\s*Original Message\s*-{2,}$/i,
  /^-{2,}\s*Forwarded message\s*-{2,}$/i,
  /^Begin forwarded message:/i,
];

const QUOTE_HEADER_KEYS = ['from', 'sent', 'to', 'subject', 'date'];

const SIGNATURE_MARKERS = [
  /^--\s*$/,
  /^__\s*$/,
  /^Sent from (my )?/i,
  /^Get Outlook for/i,
  /^Sent via /i,
  /^This email and any attachments/i,
];

const normalizeLine = (line: string): string => line.trim();

const isQuoteHeaderBlock = (lines: string[], index: number): boolean => {
  const first = normalizeLine(lines[index] ?? '').toLowerCase();
  if (!QUOTE_HEADER_KEYS.some((key) => first.startsWith(`${key}:`))) {
    return false;
  }

  let hits = 0;
  for (let i = index; i < Math.min(lines.length, index + 6); i += 1) {
    const line = normalizeLine(lines[i] ?? '').toLowerCase();
    if (!line) continue;
    if (QUOTE_HEADER_KEYS.some((key) => line.startsWith(`${key}:`))) {
      hits += 1;
    }
  }

  return hits >= 2;
};

const findQuoteStart = (lines: string[]): number | null => {
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    const line = normalizeLine(raw);
    if (!line) continue;
    if (QUOTE_BLOCK_MARKERS.some((pattern) => pattern.test(line))) {
      return i;
    }
    if (isQuoteHeaderBlock(lines, i)) {
      return i;
    }
    if (/^>+/.test(line)) {
      return i;
    }
  }
  return null;
};

const findSignatureStart = (lines: string[]): number | null => {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = normalizeLine(lines[i] ?? '');
    if (!line) continue;
    if (SIGNATURE_MARKERS.some((pattern) => pattern.test(line))) {
      return i;
    }
  }
  return null;
};

export type StrippedText = {
  text: string;
  removed: boolean;
  quoteRatio: number;
};

export const stripQuotedText = (raw: string): StrippedText => {
  const text = raw ?? '';
  if (!text) {
    return { text: '', removed: false, quoteRatio: 0 };
  }

  const lines = text.split(/\r?\n/);
  let cutIndex = lines.length;

  const quoteStart = findQuoteStart(lines);
  if (quoteStart !== null) {
    cutIndex = Math.min(cutIndex, quoteStart);
  }

  const signatureStart = findSignatureStart(lines);
  if (signatureStart !== null && signatureStart >= Math.floor(lines.length * 0.5)) {
    cutIndex = Math.min(cutIndex, signatureStart);
  }

  const kept = lines.slice(0, cutIndex).join('\n').trim();
  const removedLines = Math.max(0, lines.length - cutIndex);
  const quoteRatio = lines.length ? removedLines / lines.length : 0;

  return { text: kept, removed: removedLines > 0, quoteRatio };
};

export const normalizeWhitespace = (text: string | null | undefined): string =>
  (text || '').replace(/\s+/g, ' ').trim();

export const cleanMessageText = (text: string | null | undefined): string => {
  if (!text) return '';
  const stripped = stripQuotedText(text);
  return normalizeWhitespace(stripped.text);
};

export const truncateSnippet = (text: string | null | undefined, maxChars?: number): string => {
  const cleaned = cleanMessageText(text);
  if (!cleaned) return '';
  const limit = typeof maxChars === 'number' && maxChars > 0 ? maxChars : 220;
  return cleaned.length > limit ? `${cleaned.slice(0, limit)}...` : cleaned;
};

export const redactPhoneNumber = (value: string): string => {
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length < 7) return value;
  const prefix = digits.slice(0, 4);
  const suffix = digits.slice(-2);
  const masked = `${prefix}${'*'.repeat(Math.max(0, digits.length - 6))}${suffix}`;
  return value.replace(digits, masked);
};
