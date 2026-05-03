export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDexterRuntime } = await import("@/server/dexter-runtime");
    await startDexterRuntime();
  }
}
