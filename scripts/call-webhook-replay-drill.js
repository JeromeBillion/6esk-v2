const crypto = require("crypto");

const { APP_URL, CALLS_WEBHOOK_SECRET } = process.env;

if (!APP_URL || !CALLS_WEBHOOK_SECRET) {
  console.error("APP_URL and CALLS_WEBHOOK_SECRET are required");
  process.exit(1);
}

function sign(timestamp, rawBody) {
  const payload = `${timestamp}.${rawBody}`;
  const digest = crypto.createHmac("sha256", CALLS_WEBHOOK_SECRET).update(payload).digest("hex");
  return `sha256=${digest}`;
}

async function sendStatusWebhook({ timestamp }) {
  const body = JSON.stringify({
    provider: "drill",
    providerCallId: `drill-${Date.now()}`,
    status: "ringing",
    timestamp: new Date(Number(timestamp) * 1000).toISOString()
  });

  const response = await fetch(`${APP_URL.replace(/\/+$/, "")}/api/calls/status`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-6esk-timestamp": String(timestamp),
      "x-6esk-signature": sign(String(timestamp), body)
    },
    body
  });

  return {
    status: response.status,
    body: await response.text()
  };
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const stale = now - 3600;

  const fresh = await sendStatusWebhook({ timestamp: now });
  const replay = await sendStatusWebhook({ timestamp: stale });

  console.log("Fresh signed webhook status:", fresh.status);
  console.log("Replay/stale signed webhook status:", replay.status);

  if (fresh.status === 401) {
    throw new Error(`Fresh signed webhook was unauthorized: ${fresh.body}`);
  }
  if (replay.status !== 401) {
    throw new Error(`Replay/stale webhook expected 401 but got ${replay.status}: ${replay.body}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
