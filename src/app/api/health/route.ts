import { db } from "@/server/db";
import { getDexterRuntimeStatus } from "@/server/dexter-runtime";
import { logger } from "@/server/logger";

export async function GET() {
  try {
    await db.query("SELECT 1");
    const dexterRuntime = getDexterRuntimeStatus();
    const dexterHealth = dexterRuntime.enabled
      ? dexterRuntime.state === "active"
        ? "ok"
        : "degraded"
      : "disabled";

    return Response.json({
      status: dexterHealth === "degraded" ? "degraded" : "ok",
      service: "6esk",
      checks: {
        database: { status: "ok" },
        dexterRuntime: {
          status: dexterHealth,
          enabled: dexterRuntime.enabled,
          state: dexterRuntime.state,
          configuredAgentCount: dexterRuntime.configuredAgentCount,
          activeAgentCount: dexterRuntime.activeAgentCount,
          internalDispatcherReady: dexterRuntime.internalDispatcherReady
        }
      }
    });
  } catch (error) {
    logger.error("Health check failed", {
      error,
      route: "GET /api/health",
      check: "database"
    });
    return Response.json({ status: "degraded", service: "6esk" }, { status: 503 });
  }
}
