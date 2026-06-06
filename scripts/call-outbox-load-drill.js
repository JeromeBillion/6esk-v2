const { APP_URL, CALLS_OUTBOX_SECRET, INBOUND_SHARED_SECRET } = process.env;

const secret = CALLS_OUTBOX_SECRET || INBOUND_SHARED_SECRET || "";
const loops = Math.max(1, Math.min(Number(process.env.CALLS_OUTBOX_DRILL_LOOPS || "20"), 500));
const limit = Math.max(1, Math.min(Number(process.env.CALLS_OUTBOX_DRILL_LIMIT || "25"), 100));

if (!APP_URL || !secret) {
  console.error("APP_URL and CALLS_OUTBOX_SECRET (or INBOUND_SHARED_SECRET) are required");
  process.exit(1);
}

async function main() {
  const baseUrl = APP_URL.replace(/\/+$/, "");
  let deliveredTotal = 0;
  let skippedTotal = 0;
  let failures = 0;

  for (let i = 0; i < loops; i += 1) {
    const response = await fetch(`${baseUrl}/api/admin/calls/outbox?limit=${limit}`, {
      method: "POST",
      headers: {
        "x-6esk-secret": secret
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      failures += 1;
      console.log(`Run ${i + 1}/${loops} failed with status ${response.status}`, payload);
      continue;
    }
    deliveredTotal += Number(payload.delivered || 0);
    skippedTotal += Number(payload.skipped || 0);
  }

  const failedResponse = await fetch(`${baseUrl}/api/admin/calls/failed?limit=50`, {
    headers: {
      "x-6esk-secret": secret
    }
  });
  const failedPayload = await failedResponse.json().catch(() => ({}));
  const failedCount = Array.isArray(failedPayload.events) ? failedPayload.events.length : null;

  console.log("Call outbox load drill complete:", {
    loops,
    limit,
    failures,
    deliveredTotal,
    skippedTotal,
    failedCount
  });

  if (failures > 0) {
    throw new Error(`Outbox drill had ${failures} failed runs`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
