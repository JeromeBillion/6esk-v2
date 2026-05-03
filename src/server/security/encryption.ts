import crypto from "crypto";

// Use SESSION_SECRET as the root encryption key, defaulting to a fallback for tests.
const SECRET_KEY = process.env.SESSION_SECRET || "fallback-secret-key-32-chars-min!";

// Ensure key is 32 bytes for aes-256-gcm
function getKey(): Buffer {
  return crypto.createHash("sha256").update(SECRET_KEY).digest();
}

/**
 * Encrypt a plaintext string into a base64-encoded ciphertext payload containing
 * the initialization vector, auth tag, and ciphertext.
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag().toString("base64");

  return `${iv.toString("base64")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a base64-encoded ciphertext payload back into the plaintext string.
 */
export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format");
  }

  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const encryptedText = Buffer.from(parts[2], "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedText, undefined, "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}
