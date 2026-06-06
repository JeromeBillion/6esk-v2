const {
  APP_URL,
  INBOUND_SHARED_SECRET,
  INBOUND_RETRY_LIMIT,
  INBOUND_JOB_INTERVAL_SECONDS,
  INBOUND_JOB_MAX_RUNS,
  INBOUND_ALERT_EVERY_RUN
} = process.env;

if (!APP_URL || !INBOUND_SHARED_SECRET) {
  console.error("APP_URL and INBOUND_SHARED_SECRET are required");
  process.exit(1);
}

const baseUrl = APP_URL.replace(/\/+$/, "");
const retryLimit = clamp(parseNumber(INBOUND_RETRY_LIMIT, 25), 1, 50);
const intervalSeconds = Math.max(parseNumber(INBOUND_JOB_INTERVAL_SECONDS, 0), 0);
const maxRunsDefault = intervalSeconds > 0 ? 0 : 1;
const maxRuns = Math.max(parseNumber(INBOUND_JOB_MAX_RUNS, maxRunsDefault), 0);
const alertEveryRun = parseBoolean(INBOUND_ALERT_EVERY_RUN, true);

let shouldStop = false;
let seenStopSignal = false;

process.on("SIGINT", () => handleSignal("SIGINT"));
process.on("SIGTERM", () => handleSignal("SIGTERM"));

function handleSignal(signalName) {
  if (seenStopSignal) {
    process.exit(1);
  }
  seenStopSignal = true;
  shouldStop = true;
  console.log(`[inbound-jobs] ${signalName} received. Stopping after current run...`);
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callMaintenanceEndpoint(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "x-6esk-secret": INBOUND_SHARED_SECRET }
  });

  const text = await response.text();
  const payload = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    const message = payload?.error || payload?.message || text || `Request failed: ${response.status}`;
    throw new Error(`${pathname} -> ${message}`);
  }

  return payload;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

async function runOnce(runNumber) {
  const startedAt = new Date().toISOString();
  console.log(`[inbound-jobs] run ${runNumber} started at ${startedAt}`);

  const retryPayload = await callMaintenanceEndpoint(`/api/admin/inbound/retry?limit=${retryLimit}`);
  console.log("[inbound-jobs] retry:", JSON.stringify(retryPayload));

  if (alertEveryRun) {
    const alertPayload = await callMaintenanceEndpoint("/api/admin/inbound/alerts");
    console.log("[inbound-jobs] alert:", JSON.stringify(alertPayload));
  }

  const finishedAt = new Date().toISOString();
  console.log(`[inbound-jobs] run ${runNumber} completed at ${finishedAt}`);
}

async function main() {
  let runNumber = 0;

  while (!shouldStop && (maxRuns === 0 || runNumber < maxRuns)) {
    runNumber += 1;
    try {
      await runOnce(runNumber);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[inbound-jobs] run ${runNumber} failed: ${message}`);
      if (intervalSeconds === 0) {
        process.exit(1);
      }
    }

    if (intervalSeconds <= 0 || shouldStop) {
      break;
    }

    if (maxRuns !== 0 && runNumber >= maxRuns) {
      break;
    }

    await sleep(intervalSeconds * 1000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
