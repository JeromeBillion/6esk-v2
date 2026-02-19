import { describe, expect, it } from "vitest";
import { redactCallData, redactPhoneNumber } from "@/server/calls/redaction";

describe("call redaction", () => {
  it("redacts plain phone numbers", () => {
    expect(redactPhoneNumber("+15551234567")).toBe("+1555******67");
    expect(redactPhoneNumber("15551234567")).toBe("1555******67");
  });

  it("redacts voice-channel identifiers", () => {
    expect(redactPhoneNumber("voice:+15551234567")).toBe("voice:+1555******67");
    expect(redactPhoneNumber("whatsapp:+15551234567")).toBe("whatsapp:+1555******67");
  });

  it("redacts phone values by key and in error text", () => {
    const payload = redactCallData({
      toPhone: "+15551234567",
      from: "+15557654321",
      last_error: "Dial failed for +15551234567 after provider timeout",
      nested: {
        contactPhone: "+15550001111"
      }
    });

    expect(payload).toMatchObject({
      toPhone: "+1555******67",
      from: "+1555******21",
      last_error: "Dial failed for +1555******67 after provider timeout",
      nested: {
        contactPhone: "+1555******11"
      }
    });
  });
});
