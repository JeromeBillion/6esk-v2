import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  canManageTickets: vi.fn(),
  isWorkspaceModuleEnabled: vi.fn(),
  createDeskVoiceAccessToken: vi.fn(),
  getVoiceOperatorPresence: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  canManageTickets: mocks.canManageTickets
}));

vi.mock("@/server/workspace-modules", () => ({
  isWorkspaceModuleEnabled: mocks.isWorkspaceModuleEnabled
}));

vi.mock("@/server/calls/voice-client", () => ({
  createDeskVoiceAccessToken: mocks.createDeskVoiceAccessToken
}));

vi.mock("@/server/calls/operators", () => ({
  getVoiceOperatorPresence: mocks.getVoiceOperatorPresence
}));

import { GET } from "@/app/api/calls/client-token/route";

describe("GET /api/calls/client-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({
      id: "user-1",
      email: "jerome@6ex.co.za",
      display_name: "Jerome",
      role_id: "role-1",
      role_name: "lead_admin"
    });
    mocks.canManageTickets.mockReturnValue(true);
    mocks.isWorkspaceModuleEnabled.mockResolvedValue(true);
    mocks.createDeskVoiceAccessToken.mockReturnValue({
      identity: "desk_user_user-1",
      token: "jwt-token",
      expiresInSeconds: 3600
    });
    mocks.getVoiceOperatorPresence.mockResolvedValue({
      userId: "user-1",
      status: "online",
      activeCallSessionId: null,
      lastSeenAt: null,
      registeredAt: null
    });
  });

  it("returns a desk voice client token for an authenticated operator", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      identity: "desk_user_user-1",
      accessToken: "jwt-token",
      expiresInSeconds: 3600,
      presence: {
        status: "online"
      }
    });
  });
});
