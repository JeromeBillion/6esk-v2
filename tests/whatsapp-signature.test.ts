import { describe, expect, it } from "vitest";
import {
  buildWhatsAppSignature,
  verifyWhatsAppSignature
} from "../src/server/whatsapp/signature";

describe("verifyWhatsAppSignature", () => {
  const body = JSON.stringify({ entry: [{ id: "abc" }] });
  const appSecret = "test_app_secret_123456";

  it("returns true when app secret is not configured", () => {
    expect(
      verifyWhatsAppSignature({
        body,
        providedSignature: null,
        appSecret: ""
      })
    ).toBe(true);
  });

  it("returns true when signature matches", () => {
    const signature = buildWhatsAppSignature(body, appSecret);
    expect(
      verifyWhatsAppSignature({
        body,
        providedSignature: signature,
        appSecret
      })
    ).toBe(true);
  });

  it("returns false when signature does not match", () => {
    expect(
      verifyWhatsAppSignature({
        body,
        providedSignature: "sha256=invalid",
        appSecret
      })
    ).toBe(false);
  });
});
