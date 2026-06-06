import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/app/lib/api/http";
import { createTicket } from "@/app/lib/api/tickets";

const CREATE_INPUT = {
  contactMode: "email" as const,
  to: "customer@example.com",
  subject: "Login issue",
  description: "Cannot access dashboard",
  category: "account",
  tags: ["urgent"]
};

describe("tickets API client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts create payload and returns response", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "created", ticketId: "TKT-1001", messageId: "msg-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );

    const response = await createTicket(CREATE_INPUT);

    expect(response).toMatchObject({
      status: "created",
      ticketId: "TKT-1001",
      messageId: "msg-1"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tickets/create",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" }
      })
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject(CREATE_INPUT);
  });

  it("uses API detail field as error message", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: "blocked", detail: "Voice consent not granted" }), {
        status: 403,
        headers: { "content-type": "application/json" }
      })
    );

    let thrown: unknown = null;
    try {
      await createTicket(CREATE_INPUT);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ApiError);
    if (thrown instanceof ApiError) {
      expect(thrown.status).toBe(403);
      expect(thrown.message).toBe("Voice consent not granted");
      expect(thrown.payload).toMatchObject({ status: "blocked" });
    }
  });
});
