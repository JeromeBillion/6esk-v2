import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  getObjectBuffer: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.query,
    connect: mocks.connect
  }
}));

vi.mock("@/server/storage/r2", () => ({
  getObjectBuffer: mocks.getObjectBuffer
}));

describe("email outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rows: [
            {
              id: "evt-1",
              payload: {
                messageRecordId: "msg-1",
                from: "jerome.choma@6ex.co.za",
                to: ["customer@example.com"],
                cc: [],
                bcc: [],
                subject: "Queued email"
              },
              attempt_count: 0
            }
          ]
        })
        .mockResolvedValueOnce(undefined),
      release: vi.fn()
    };
    mocks.connect.mockResolvedValue(client);
    mocks.query.mockImplementation((sql: string) => {
      if (sql.includes("SELECT id, r2_key_text")) {
        return Promise.resolve({
          rows: [
            {
              id: "msg-1",
              r2_key_text: "messages/msg-1/body.txt",
              r2_key_html: null,
              message_id: "<msg-1@6ex.co.za>",
              in_reply_to: null,
              reference_ids: null
            }
          ]
        });
      }
      if (sql.includes("SELECT filename, content_type, r2_key")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    mocks.getObjectBuffer.mockResolvedValue({
      buffer: Buffer.from("Hello queued world", "utf-8"),
      contentType: "text/plain"
    });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "provider-msg-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    process.env.RESEND_API_KEY = "resend-test-key";
  });

  it("delivers queued email events and marks the message sent", async () => {
    const { deliverPendingEmailOutboxEvents } = await import("@/server/email/outbox");

    const result = await deliverPendingEmailOutboxEvents({ limit: 5 });

    expect(result).toEqual({ delivered: 1, skipped: 0 });
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchMock.mock.calls[0] ?? [];
    const payload = JSON.parse(String((requestInit as RequestInit).body));
    expect(payload).toMatchObject({
      from: "jerome.choma@6ex.co.za",
      to: ["customer@example.com"],
      subject: "Queued email",
      text: "Hello queued world"
    });
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("SET external_message_id = $1"),
      ["provider-msg-1", "msg-1"]
    );
  });
});
