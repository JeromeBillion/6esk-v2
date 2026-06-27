import { describe, expect, it } from "vitest";
import { validatePublicHttpsUrl } from "@/server/security/outbound-url";

describe("public outbound URL policy", () => {
  it("accepts public https URLs", () => {
    expect(validatePublicHttpsUrl("https://api.example.com/v1")).toMatchObject({ ok: true });
  });

  it.each([
    "http://api.example.com",
    "https://localhost:3000",
    "https://127.0.0.1",
    "https://10.0.0.5",
    "https://172.16.0.10",
    "https://192.168.1.10",
    "https://169.254.169.254/latest/meta-data",
    "https://service.local",
    "https://user:pass@example.com"
  ])("rejects unsafe URL %s", (value) => {
    expect(validatePublicHttpsUrl(value)).toMatchObject({ ok: false });
  });
});
