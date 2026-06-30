import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  isInternalStaff: vi.fn(),
  hasPrivilegedMfaSession: vi.fn(),
  listBackofficeCases: vi.fn(),
  createBackofficeCase: vi.fn(),
  getBackofficeCase: vi.fn(),
  updateBackofficeCase: vi.fn(),
  listBackofficeCaseEvents: vi.fn(),
  listBackofficeCaseLinks: vi.fn(),
  appendBackofficeCaseEvent: vi.fn(),
  linkBackofficeCaseArtifact: vi.fn(),
  getTenantBackofficeProfile: vi.fn(),
  upsertTenantBackofficeProfile: vi.fn()
}));

vi.mock("@/server/auth/session", () => ({
  getSessionUser: mocks.getSessionUser
}));

vi.mock("@/server/auth/roles", () => ({
  isInternalStaff: mocks.isInternalStaff
}));

vi.mock("@/server/auth/privileged-access", () => ({
  hasPrivilegedMfaSession: mocks.hasPrivilegedMfaSession
}));

vi.mock("@/server/backoffice/workflows", () => ({
  BackofficeWorkflowError: class BackofficeWorkflowError extends Error {
    constructor(
      message: string,
      public readonly code = "CASE_NOT_FOUND",
      public readonly status = 404
    ) {
      super(message);
      this.name = "BackofficeWorkflowError";
    }
  },
  listBackofficeCases: mocks.listBackofficeCases,
  createBackofficeCase: mocks.createBackofficeCase,
  getBackofficeCase: mocks.getBackofficeCase,
  updateBackofficeCase: mocks.updateBackofficeCase,
  listBackofficeCaseEvents: mocks.listBackofficeCaseEvents,
  listBackofficeCaseLinks: mocks.listBackofficeCaseLinks,
  appendBackofficeCaseEvent: mocks.appendBackofficeCaseEvent,
  linkBackofficeCaseArtifact: mocks.linkBackofficeCaseArtifact,
  getTenantBackofficeProfile: mocks.getTenantBackofficeProfile,
  upsertTenantBackofficeProfile: mocks.upsertTenantBackofficeProfile
}));

import { GET as listCases, POST as createCase } from "@/app/api/backoffice/cases/route";
import { PATCH as updateCase } from "@/app/api/backoffice/cases/[caseId]/route";
import { POST as addCaseEvent } from "@/app/api/backoffice/cases/[caseId]/events/route";
import { POST as addCaseLink } from "@/app/api/backoffice/cases/[caseId]/links/route";
import { PUT as upsertProfile } from "@/app/api/backoffice/tenants/[tenantId]/profile/route";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function request(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

function caseParams() {
  return { params: Promise.resolve({ caseId: CASE_ID }) };
}

function tenantParams() {
  return { params: Promise.resolve({ tenantId: TENANT_ID }) };
}

describe("backoffice workflow APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue({ id: USER_ID, role_name: "internal_admin" });
    mocks.isInternalStaff.mockReturnValue(true);
    mocks.hasPrivilegedMfaSession.mockReturnValue(true);
    mocks.listBackofficeCases.mockResolvedValue([]);
    mocks.createBackofficeCase.mockResolvedValue({ id: CASE_ID, tenantId: TENANT_ID });
    mocks.updateBackofficeCase.mockResolvedValue({ id: CASE_ID, tenantId: TENANT_ID, status: "in_progress" });
    mocks.appendBackofficeCaseEvent.mockResolvedValue({ id: "event-1", caseId: CASE_ID, tenantId: TENANT_ID });
    mocks.linkBackofficeCaseArtifact.mockResolvedValue({ id: "link-1", caseId: CASE_ID, tenantId: TENANT_ID });
    mocks.upsertTenantBackofficeProfile.mockResolvedValue({ tenantId: TENANT_ID });
  });

  it("rejects tenant users from workflow case listing", async () => {
    mocks.isInternalStaff.mockReturnValue(false);

    const response = await listCases(new Request("http://localhost/api/backoffice/cases"));

    expect(response.status).toBe(403);
    expect(mocks.listBackofficeCases).not.toHaveBeenCalled();
  });

  it("lists workflow cases for internal staff with tenant filters", async () => {
    const response = await listCases(
      new Request(`http://localhost/api/backoffice/cases?tenantId=${TENANT_ID}&status=open&limit=10`)
    );

    expect(response.status).toBe(200);
    expect(mocks.listBackofficeCases).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      status: "open",
      caseType: undefined,
      limit: 10
    });
  });

  it("creates tenant-linked workflow cases with actor evidence", async () => {
    const response = await createCase(
      request("/api/backoffice/cases", {
        tenantId: TENANT_ID,
        caseType: "implementation",
        title: "Launch readiness",
        priority: "p1"
      })
    );

    expect(response.status).toBe(201);
    expect(mocks.createBackofficeCase).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        caseType: "implementation",
        title: "Launch readiness",
        priority: "p1",
        actorUserId: USER_ID
      })
    );
  });

  it("requires MFA before mutating workflow cases", async () => {
    mocks.hasPrivilegedMfaSession.mockReturnValue(false);

    const response = await createCase(
      request("/api/backoffice/cases", {
        tenantId: TENANT_ID,
        caseType: "implementation",
        title: "Launch readiness"
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.createBackofficeCase).not.toHaveBeenCalled();
  });

  it("rejects case updates that omit tenant scope", async () => {
    const response = await updateCase(
      request(`/api/backoffice/cases/${CASE_ID}`, {
        status: "in_progress",
        note: "Assigned to implementation owner"
      }),
      caseParams()
    );

    expect(response.status).toBe(400);
    expect(mocks.updateBackofficeCase).not.toHaveBeenCalled();
  });

  it("updates cases without accepting unscoped case mutation", async () => {
    const response = await updateCase(
      request(`/api/backoffice/cases/${CASE_ID}`, {
        tenantId: TENANT_ID,
        status: "in_progress",
        note: "Assigned to implementation owner"
      }),
      caseParams()
    );

    expect(response.status).toBe(200);
    expect(mocks.updateBackofficeCase).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        tenantId: TENANT_ID,
        status: "in_progress",
        note: "Assigned to implementation owner",
        actorUserId: USER_ID
      })
    );
  });

  it("adds workflow timeline events for internal staff", async () => {
    const response = await addCaseEvent(
      request(`/api/backoffice/cases/${CASE_ID}/events`, {
        tenantId: TENANT_ID,
        eventType: "note_added",
        note: "Customer sent signed DPA"
      }),
      caseParams()
    );

    expect(response.status).toBe(201);
    expect(mocks.appendBackofficeCaseEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        tenantId: TENANT_ID,
        eventType: "note_added",
        note: "Customer sent signed DPA",
        actorUserId: USER_ID
      })
    );
  });

  it("rejects workflow timeline events that omit tenant scope", async () => {
    const response = await addCaseEvent(
      request(`/api/backoffice/cases/${CASE_ID}/events`, {
        eventType: "note_added",
        note: "Customer sent signed DPA"
      }),
      caseParams()
    );

    expect(response.status).toBe(400);
    expect(mocks.appendBackofficeCaseEvent).not.toHaveBeenCalled();
  });

  it("links case artifacts with either URL or R2 evidence", async () => {
    const response = await addCaseLink(
      request(`/api/backoffice/cases/${CASE_ID}/links`, {
        tenantId: TENANT_ID,
        linkType: "security_evidence",
        label: "Security pack",
        url: "https://docs.6esk.example/security"
      }),
      caseParams()
    );

    expect(response.status).toBe(201);
    expect(mocks.linkBackofficeCaseArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        tenantId: TENANT_ID,
        linkType: "security_evidence",
        actorUserId: USER_ID
      })
    );
  });

  it("rejects case artifact links that omit tenant scope", async () => {
    const response = await addCaseLink(
      request(`/api/backoffice/cases/${CASE_ID}/links`, {
        linkType: "security_evidence",
        label: "Security pack",
        url: "https://docs.6esk.example/security"
      }),
      caseParams()
    );

    expect(response.status).toBe(400);
    expect(mocks.linkBackofficeCaseArtifact).not.toHaveBeenCalled();
  });

  it("rejects unsafe evidence links before artifact storage", async () => {
    const response = await addCaseLink(
      request(`/api/backoffice/cases/${CASE_ID}/links`, {
        tenantId: TENANT_ID,
        linkType: "security_evidence",
        label: "Local metadata endpoint",
        url: "http://localhost:3000/internal"
      }),
      caseParams()
    );

    expect(response.status).toBe(400);
    expect(mocks.linkBackofficeCaseArtifact).not.toHaveBeenCalled();
  });

  it("upserts tenant backoffice profiles for internal staff", async () => {
    const response = await upsertProfile(
      request(`/api/backoffice/tenants/${TENANT_ID}/profile`, {
        implementationStage: "uat",
        riskTier: "elevated",
        securityStatus: "watch"
      }),
      tenantParams()
    );

    expect(response.status).toBe(200);
    expect(mocks.upsertTenantBackofficeProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        implementationStage: "uat",
        riskTier: "elevated",
        securityStatus: "watch",
        actorUserId: USER_ID
      })
    );
  });
});
