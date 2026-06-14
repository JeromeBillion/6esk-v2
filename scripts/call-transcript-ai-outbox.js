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

if (!APP_URL || !secret || !tenantId) {
  console.error("APP_URL, CALLS_OUTBOX_SECRET (or INBOUND_SHARED_SECRET), and CALLS_OUTBOX_TENANT_ID (or JOBS_RUNNER_TENANT_ID/INBOUND_TENANT_ID) are required");
  process.exit(1);
}

async function main() {
  const baseUrl = APP_URL.replace(/\/+$/, "");
  const url = `${baseUrl}/api/admin/calls/transcripts/ai?limit=25`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-6esk-secret": secret,
      "x-6esk-tenant-id": tenantId
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  const payload = await response.json();
  console.log("Transcript AI outbox result:", payload);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
