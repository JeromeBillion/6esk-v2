import { getSessionUser } from "@/server/auth/session";
import { getWorkspaceModuleUsageSummary } from "@/server/module-metering";

function clampWindowDays(value: string | null) {
  const parsed = Number(value ?? "30");
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(90, Math.max(1, Math.trunc(parsed)));
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role_name !== "lead_admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const days = clampWindowDays(url.searchParams.get("days"));
  const summary = await getWorkspaceModuleUsageSummary({ windowDays: days });

  return Response.json({ summary });
}
