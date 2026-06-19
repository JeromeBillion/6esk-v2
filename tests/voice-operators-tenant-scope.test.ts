import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const mocks = vi.hoisted(() => ({
  dbQuery: vi.fn(),
  dbConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn()
}));

vi.mock("@/server/db", () => ({
  db: {
    query: mocks.dbQuery,
    connect: mocks.dbConnect
  }
}));

import {
  getVoiceOperatorPresence,
  listAvailableVoiceDeskOperators,
  listVoiceOperatorRoster,
  markVoiceOperatorQueueOutcome,
  reserveNextVoiceDeskOperatorForCall,
  upsertVoiceOperatorPresence
} from "@/server/calls/operators";

describe("voice operator presence tenant scope", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }
    mocks.dbQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    mocks.dbConnect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.clientRelease
    });
  });

  it("rejects tenantless presence reads before database access", async () => {
    await expect(getVoiceOperatorPresence(USER_ID, "")).rejects.toThrow(
      "Get voice operator presence requires tenantId."
    );

    expect(mocks.dbQuery).not.toHaveBeenCalled();
  });

  it("reads a user's presence only inside the supplied tenant", async () => {
    await getVoiceOperatorPresence(USER_ID, TENANT_ID);

    expect(mocks.dbQuery).toHaveBeenCalledWith(expect.stringContaining("AND tenant_id = $2"), [
      USER_ID,
      TENANT_ID
    ]);
  });

  it("upserts presence with tenant_id and tenant-checked conflict update", async () => {
    mocks.dbQuery.mockResolvedValueOnce({
      rows: [
        {
          status: "online",
          active_call_session_id: null,
          metadata: {},
          last_seen_at: new Date("2026-02-19T10:00:00.000Z"),
          registered_at: new Date("2026-02-19T10:00:00.000Z")
        }
      ],
      rowCount: 1
    });

    await upsertVoiceOperatorPresence({
      tenantId: TENANT_ID,
      userId: USER_ID,
      status: "online",
      registered: true
    });

    const [sql, values] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(sql).toContain("INSERT INTO voice_operator_presence");
    expect(sql).toContain("tenant_id");
    expect(sql).toContain("WHERE voice_operator_presence.tenant_id = EXCLUDED.tenant_id");
    expect(values[0]).toBe(TENANT_ID);
    expect(values[1]).toBe(USER_ID);
  });

  it("filters available operators and roster by tenant", async () => {
    await listAvailableVoiceDeskOperators(TENANT_ID, 3);
    await listVoiceOperatorRoster(TENANT_ID, 3);

    const [availableSql, availableValues] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(availableSql).toContain("presence.tenant_id = $1");
    expect(availableSql).toContain("u.tenant_id = presence.tenant_id");
    expect(availableValues[0]).toBe(TENANT_ID);

    const [rosterSql, rosterValues] = mocks.dbQuery.mock.calls[1] ?? [];
    expect(rosterSql).toContain("presence.tenant_id = $1");
    expect(rosterSql).toContain("u.tenant_id = presence.tenant_id");
    expect(rosterValues[0]).toBe(TENANT_ID);
  });

  it("reserves operators and marks queue outcomes only inside the tenant", async () => {
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [
          {
            user_id: USER_ID,
            email: "agent@example.com",
            display_name: "Agent",
            status: "online",
            active_call_session_id: null,
            ringing_call_session_id: null
          }
        ],
        rowCount: 1
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await reserveNextVoiceDeskOperatorForCall({
      tenantId: TENANT_ID,
      callSessionId: "33333333-3333-4333-8333-333333333333"
    });

    const [, selectSql, updateSql] = mocks.clientQuery.mock.calls.map(([sql]) => String(sql));
    expect(selectSql).toContain("presence.tenant_id = $1");
    expect(mocks.clientQuery.mock.calls[1]?.[1]?.[0]).toBe(TENANT_ID);
    expect(updateSql).toContain("AND tenant_id = $3");
    expect(mocks.clientQuery.mock.calls[2]?.[1]?.[2]).toBe(TENANT_ID);

    await markVoiceOperatorQueueOutcome({
      tenantId: TENANT_ID,
      userId: USER_ID,
      callSessionId: "33333333-3333-4333-8333-333333333333",
      outcome: "missed"
    });

    const [outcomeSql, outcomeValues] = mocks.dbQuery.mock.calls[0] ?? [];
    expect(outcomeSql).toContain("AND tenant_id = $5");
    expect(outcomeValues[4]).toBe(TENANT_ID);
  });
});
