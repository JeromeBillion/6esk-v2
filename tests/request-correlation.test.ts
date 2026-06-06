import { describe, expect, it } from "vitest";
import { normalizeRequestIdForMiddleware } from "@/middleware";

describe("request correlation middleware", () => {
  it("accepts bounded request ids safe for response headers and logs", () => {
    expect(normalizeRequestIdForMiddleware("req-2026_06.05:abc123")).toBe("req-2026_06.05:abc123");
  });

  it("rejects missing, short, long, or control-character request ids", () => {
    expect(normalizeRequestIdForMiddleware(null)).toBeNull();
    expect(normalizeRequestIdForMiddleware("short")).toBeNull();
    expect(normalizeRequestIdForMiddleware("x".repeat(97))).toBeNull();
    expect(normalizeRequestIdForMiddleware("req-1234\r\nx-evil: yes")).toBeNull();
  });
});
