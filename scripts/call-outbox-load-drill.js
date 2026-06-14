const {
  APP_URL,
  CALLS_OUTBOX_SECRET,
  CALLS_OUTBOX_TENANT_ID,
  JOBS_RUNNER_TENANT_ID,
  INBOUND_SHARED_SECRET,
  INBOUND_TENANT_ID
} = process.env;

const secret = CALLS_OUTBOX_SECRET || INBOUND_SHARED_SECRET || "";
const tenantId = CALLS_OUTBOX_TENANT_ID || JOBS_RUNNER_TENANT_ID || INBOUND_TENANT_ID || "";
const loops = Math.max(1, Math.min(Number(process.env.CALLS_OUTBOX_DRILL_LOOPS || "20"), 500));
const limit = Math.max(1, Math.min(Number(process.env.CALLS_OUTBOX_DRILL_LIMIT || "25"), 100));

if (!APP_URL || !secret || !tenantId) {
  console.error("APP_URL, CALLS_OUTBOX_SECRET (or INBOUND_SHARED_SECRET), and CALLS_OUTBOX_TENANT_ID (or JOBS_RUNNER_TENANT_ID/INBOUND_TENANT_ID) are required");
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
        "x-6esk-secret": secret,
        "x-6esk-tenant-id": tenantId
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
      "x-6esk-secret": secret,
      "x-6esk-tenant-id": tenantId
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
