import { describe, expect, it } from "vitest";
import {
  SIXESK_API_VERSION,
  integrationError,
  integrationSuccess,
  validateIntegrationApiVersion
} from "@/server/api-contract";

describe("integration API contract", () => {
  it("accepts requests without explicit version header", () => {
    const request = new Request("http://localhost/api/tickets/create");
    const response = validateIntegrationApiVersion(request);
    expect(response).toBeNull();
  });

  it("rejects unsupported versions with a structured envelope", async () => {
    const request = new Request("http://localhost/api/tickets/create", {
      headers: {
        "x-6esk-api-version": "1999-01-01"
      }
    });

    const response = validateIntegrationApiVersion(request);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(400);
    expect(response?.headers.get("x-6esk-api-version")).toBe("1999-01-01");
    expect(response?.headers.get("x-6esk-request-id")).toBeTruthy();

    const body = await response?.json();
    expect(body).toMatchObject({
      ok: false,
      code: "unsupported_api_version",
      error: "x-6esk-api-version value is not supported.",
      meta: {
        apiVersion: "1999-01-01"
      }
    });
  });

  it("adds contract headers to successful responses", async () => {
    const request = new Request("http://localhost/api/tickets/create");

    const response = integrationSuccess(request, { status: "ok" });
    expect(response.headers.get("x-6esk-api-version")).toBe(SIXESK_API_VERSION);
    expect(response.headers.get("x-6esk-request-id")).toBeTruthy();

    const body = await response.json();
    expect(body).toMatchObject({ status: "ok" });
  });

  it("adds structured error metadata", async () => {
    const request = new Request("http://localhost/api/tickets/create", {
      headers: { "x-request-id": "req-123" }
    });

    const response = integrationError(request, {
      status: 401,
      code: "unauthorized",
      message: "Unauthorized"
    });

    expect(response.headers.get("x-6esk-request-id")).toBe("req-123");

    const body = await response.json();
    expect(body).toMatchObject({
      ok: false,
      code: "unauthorized",
      error: "Unauthorized",
      meta: {
        apiVersion: SIXESK_API_VERSION,
        requestId: "req-123"
      }
    });
  });
});
