import crypto from "crypto";

// AES-256-GCM configuration
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16; // 16 bytes is standard for AES-GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Returns the 32-byte encryption key from the environment.
 * Validates the key exists and is the correct length.
 */
function getEncryptionKey(): Buffer {
  const hexKey = process.env.OAUTH_ENCRYPTION_KEY;
  if (!hexKey) {
    throw new Error("OAUTH_ENCRYPTION_KEY environment variable is not set.");
  }

  const key = Buffer.from(hexKey, "hex");
  if (key.length !== 32) {
    throw new Error("OAUTH_ENCRYPTION_KEY must be a 32-byte hex string (64 characters).");
  }

  return key;
}

/**
 * Encrypts a plaintext string (e.g. an OAuth token) using AES-256-GCM.
 * The authentication tag is appended to the ciphertext.
 */
export function encryptToken(plaintext: string): { ciphertext: Buffer; iv: Buffer } {
  if (!plaintext) {
    throw new Error("Cannot encrypt empty plaintext.");
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  // Get the auth tag (16 bytes) and append it to the ciphertext
  const authTag = cipher.getAuthTag();
  const ciphertextWithTag = Buffer.concat([encrypted, authTag]);

  return {
    ciphertext: ciphertextWithTag,
    iv: iv
  };
}

/**
 * Decrypts a ciphertext Buffer using AES-256-GCM.
 * The last 16 bytes of the ciphertext Buffer are assumed to be the authentication tag.
 */
export function decryptToken(ciphertextWithTag: Buffer, iv: Buffer): string {
  if (!ciphertextWithTag || ciphertextWithTag.length <= AUTH_TAG_LENGTH) {
    throw new Error("Invalid ciphertext: too short to contain auth tag.");
  }
  if (!iv || iv.length !== IV_LENGTH) {
    throw new Error("Invalid IV length.");
  }

  const key = getEncryptionKey();

  // Extract auth tag from the end
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - AUTH_TAG_LENGTH);
  const authTag = ciphertextWithTag.subarray(ciphertextWithTag.length - AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString("utf8");
}
