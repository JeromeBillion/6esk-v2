export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logger } = await import("@/server/logger");

    // M-2: Fail-fast env validation — crash on boot if required vars are missing
    try {
      const { getEnv } = await import("@/server/env");
      getEnv();
    } catch (error) {
      logger.error("Environment validation failed during startup", {
        error,
        fn: "instrumentation.register"
      });
      throw error;
    }

    const { startDexterRuntime } = await import("@/server/dexter-runtime");
    await startDexterRuntime();
  }
}
