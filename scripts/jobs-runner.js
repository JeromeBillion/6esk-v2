const {
  APP_URL,
  INBOUND_SHARED_SECRET,
  CALLS_OUTBOX_SECRET,
  JOBS_RUNNER_INTERVAL_SECONDS,
  JOBS_RUNNER_ENABLE_INBOUND,
  JOBS_RUNNER_ENABLE_WHATSAPP,
  JOBS_RUNNER_ENABLE_CALLS,
  JOBS_RUNNER_ENABLE_TRANSCRIPTS,
  JOBS_RUNNER_ENABLE_TRANSCRIPT_AI
} = process.env;

const secret = CALLS_OUTBOX_SECRET || INBOUND_SHARED_SECRET || "";

if (!APP_URL || !secret) {
  console.error("APP_URL and CALLS_OUTBOX_SECRET (or INBOUND_SHARED_SECRET) are required");
  process.exit(1);
}

const baseUrl = APP_URL.replace(/\/+$/, "");
const intervalSeconds = Math.max(parseNumber(JOBS_RUNNER_INTERVAL_SECONDS, 30), 5);

const jobSpecs = [
  {
    enabled: parseBoolean(JOBS_RUNNER_ENABLE_INBOUND, true),
    name: "inbound-retry",
    path: "/api/admin/inbound/retry?limit=25"
  },
  {
    enabled: parseBoolean(JOBS_RUNNER_ENABLE_WHATSAPP, true),
    name: "whatsapp-outbox",
    path: "/api/admin/whatsapp/outbox?limit=25"
  },
  {
    enabled: parseBoolean(JOBS_RUNNER_ENABLE_CALLS, true),
    name: "calls-outbox",
    path: "/api/admin/calls/outbox?limit=25"
  },
  {
    enabled: parseBoolean(JOBS_RUNNER_ENABLE_TRANSCRIPTS, true),
    name: "calls-transcripts",
    path: "/api/admin/calls/transcripts/outbox?limit=25"
  },
  {
    enabled: parseBoolean(JOBS_RUNNER_ENABLE_TRANSCRIPT_AI, true),
    name: "calls-transcripts-ai",
    path: "/api/admin/calls/transcripts/ai?limit=25"
  }
].filter((job) => job.enabled);

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
  console.log(`[jobs-runner] ${signalName} received. Stopping after current cycle...`);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}

async function callMaintenanceEndpoint(pathname) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "x-6esk-secret": secret
    }
  });

  const text = await response.text();
  const payload = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    const message = payload?.error || payload?.message || text || `Request failed: ${response.status}`;
    throw new Error(`${pathname} -> ${message}`);
  }

  return payload;
}

async function runJob(job) {
  const startedAt = new Date().toISOString();
  console.log(`[jobs-runner] ${job.name} started at ${startedAt}`);
  const payload = await callMaintenanceEndpoint(job.path);
  console.log(`[jobs-runner] ${job.name}: ${JSON.stringify(payload)}`);
}

async function runCycle(cycleNumber) {
  console.log(`[jobs-runner] cycle ${cycleNumber} started`);
  for (const job of jobSpecs) {
    if (shouldStop) {
      break;
    }
    try {
      await runJob(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[jobs-runner] ${job.name} failed: ${message}`);
    }
  }
  console.log(`[jobs-runner] cycle ${cycleNumber} completed`);
}

async function main() {
  let cycleNumber = 0;

  while (!shouldStop) {
    cycleNumber += 1;
    await runCycle(cycleNumber);

    if (shouldStop) {
      break;
    }

    await sleep(intervalSeconds * 1000);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
