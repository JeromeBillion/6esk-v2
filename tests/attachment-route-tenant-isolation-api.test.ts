import { beforeEach, describe, expect, it, vi } from "vitest";

const ATTACHMENT_ID = "11111111-1111-4111-8111-111111111111";
const MOCK_ATTACHMENT_ID = "att-1846-1";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isLeadAdmin: vi.fn(),
  dbQuery: vi.fn(),
  getObjectBuffer: vi.fn(),
  getTicketAssignment: vi.fn(),
  hasMailboxAccess: vi.fn(),
  resolveMockAttachment: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isLeadAdmin: mocks.isLeadAdmin
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery
  }
}));

vi.mock("@/server/storage/r2", () => ({
  getObjectBuffer: mocks.getObjectBuffer
}));

vi.mock("@/server/messages", () => ({
  getTicketAssignment: mocks.getTicketAssignment,
  hasMailboxAccess: mocks.hasMailboxAccess
}));

vi.mock("@/app/lib/mock-attachments", () => ({
  resolveMockAttachment: mocks.resolveMockAttachment
}));

import { GET } from "@/app/api/attachments/[attachmentId]/route";

function buildUser(tenantId: string | null = TENANT_ID) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    email: "lead@example.com",
    display_name: "Lead",
    role_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    role_name: "lead_admin",
    tenant_id: tenantId
  };
}

async function getAttachment(options: { attachmentId?: string; query?: string; cookie?: string } = {}) {
  const attachmentId = options.attachmentId ?? ATTACHMENT_ID;
  const response = await GET(new Request(`http://localhost/api/attachments/${attachmentId}${options.query ?? ""}`, {
    headers: options.cookie ? { cookie: options.cookie } : undefined
  }), {
    params: Promise.resolve({ attachmentId })
  });
  const body = response.headers.get("content-type")?.includes("application/json")
    ? await response.json()
    : null;
  return { response, body };
}

describe("GET /api/attachments/[attachmentId] tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveMockAttachment.mockReturnValue(null);
    mocks.getSessionUser.mockResolvedValue(buildUser());
    mocks.isLeadAdmin.mockReturnValue(true);
    mocks.dbQuery.mockResolvedValue({
      rows: [
        {
          id: ATTACHMENT_ID,
          filename: "sop.pdf",
          content_type: "application/pdf",
          r2_key: "tenants/tenant/attachments/sop.pdf",
          mailbox_id: "mailbox-1",
          ticket_id: null
        }
      ]
    });
    mocks.getObjectBuffer.mockResolvedValue({
      buffer: Buffer.from("pdf"),
      contentType: "application/pdf"
    });
  });

  it("rejects attachment reads when the session has no tenant scope", async () => {
    mocks.getSessionUser.mockResolvedValue(buildUser(null));

    const { response, body } = await getAttachment();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ error: "Forbidden" });
    expect(mocks.dbQuery).not.toHaveBeenCalled();
    expect(mocks.getObjectBuffer).not.toHaveBeenCalled();
  });

  it("does not serve generated mock attachments outside explicit demo mode", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    mocks.resolveMockAttachment.mockReturnValue({
      filename: "demo.txt",
      contentType: "text/plain",
      body: "demo"
    });

    const { response, body } = await getAttachment({ attachmentId: MOCK_ATTACHMENT_ID });

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.resolveMockAttachment).not.toHaveBeenCalled();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
    expect(mocks.getObjectBuffer).not.toHaveBeenCalled();
  });

  it("ignores malformed demo-mode cookies instead of bypassing auth or throwing", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    mocks.resolveMockAttachment.mockReturnValue({
      filename: "demo.txt",
      contentType: "text/plain",
      body: "demo"
    });

    const { response, body } = await getAttachment({
      attachmentId: MOCK_ATTACHMENT_ID,
      cookie: "sixesk_data_mode=%E0%A4%A"
    });

    expect(response.status).toBe(401);
    expect(body).toMatchObject({ error: "Unauthorized" });
    expect(mocks.resolveMockAttachment).not.toHaveBeenCalled();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
    expect(mocks.getObjectBuffer).not.toHaveBeenCalled();
  });

  it("serves generated mock attachments only for demo-mode requests", async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    mocks.resolveMockAttachment.mockReturnValue({
      filename: "demo.txt",
      contentType: "text/plain",
      body: "demo"
    });

    const { response } = await getAttachment({
      attachmentId: MOCK_ATTACHMENT_ID,
      query: "?demo=1"
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("demo");
    expect(mocks.resolveMockAttachment).toHaveBeenCalledWith(MOCK_ATTACHMENT_ID);
    expect(mocks.getSessionUser).not.toHaveBeenCalled();
    expect(mocks.dbQuery).not.toHaveBeenCalled();
    expect(mocks.getObjectBuffer).not.toHaveBeenCalled();
  });

  it("loads attachments under the session tenant boundary", async () => {
    const { response } = await getAttachment();

    expect(response.status).toBe(200);
    expect(mocks.dbQuery).toHaveBeenCalledWith(
      expect.stringContaining("a.tenant_id = $2"),
      [ATTACHMENT_ID, TENANT_ID]
    );
    expect(mocks.getObjectBuffer).toHaveBeenCalledWith("tenants/tenant/attachments/sop.pdf");
  });
});
