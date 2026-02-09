import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const PREFIX = "enc:v1:";
const IV_BYTES = 12;

function getKey() {
  return process.env.AGENT_SECRET_KEY ?? "";
}

function deriveKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string) {
  const key = getKey();
  if (!key) {
    return value;
  }
  const derived = deriveKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", derived, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString(
    "base64"
  )}`;
}

export function decryptSecret(value: string) {
  if (!value.startsWith(PREFIX)) {
    return value;
  }

  const key = getKey();
  if (!key) {
    return value;
  }

  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) {
    return value;
  }

  try {
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const derived = deriveKey(key);
    const decipher = createDecipheriv("aes-256-gcm", derived, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (error) {
    return value;
  }
}
