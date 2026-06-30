import { afterEach, describe, expect, it } from "vitest";

import { POST } from "../apps/backoffice/app/api/auth/login/route";

const originalNodeEnv = process.env.NODE_ENV;
const originalRequireAccess = process.env.BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS;

function enableProductionAccess() {
  process.env.NODE_ENV = "production";
  process.env.BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS = "true";
}

describe("backoffice login Access binding", () => {
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalRequireAccess === undefined) {
      delete process.env.BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS;
    } else {
      process.env.BACKOFFICE_REQUIRE_CLOUDFLARE_ACCESS = originalRequireAccess;
    }
  });

  it("rejects login when the Access email differs from the requested account", async () => {
    enableProductionAccess();

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sixesk-work-access-email": "ops@6esk.co.za"
        },
        body: JSON.stringify({
          email: "admin@6esk.co.za",
          password: "correct-horse-battery-staple"
        })
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Cloudflare Access identity must match the 6esk Work login email."
    });
  });
});
