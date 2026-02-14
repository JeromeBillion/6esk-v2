import { describe, expect, test } from "vitest";
import {
  deriveMatchConfidence,
  normalizeLinkEmail,
  normalizeLinkPhone
} from "@/server/integrations/external-user-links";

describe("external user link helpers", () => {
  test("normalizes emails to lowercase", () => {
    expect(normalizeLinkEmail("  User@Example.com ")).toBe("user@example.com");
    expect(normalizeLinkEmail("")).toBeNull();
    expect(normalizeLinkEmail(undefined)).toBeNull();
  });

  test("normalizes phones to compact format", () => {
    expect(normalizeLinkPhone(" +27 71 234 5678 ")).toBe("+27712345678");
    expect(normalizeLinkPhone("(071) 234-5678")).toBe("0712345678");
    expect(normalizeLinkPhone("")).toBeNull();
  });

  test("maps confidence from known match strategies", () => {
    expect(deriveMatchConfidence("email")).toBe(1);
    expect(deriveMatchConfidence("secondary_email")).toBe(1);
    expect(deriveMatchConfidence("phone_number")).toBe(1);
    expect(deriveMatchConfidence("closed_email_primary")).toBe(0.7);
    expect(deriveMatchConfidence("unknown")).toBeNull();
  });
});
