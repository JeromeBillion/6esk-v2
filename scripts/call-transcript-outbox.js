const { APP_URL, CALLS_OUTBOX_SECRET, INBOUND_SHARED_SECRET } = process.env;

const secret = CALLS_OUTBOX_SECRET || INBOUND_SHARED_SECRET || "";

if (!APP_URL || !secret) {
  console.error("APP_URL and CALLS_OUTBOX_SECRET (or INBOUND_SHARED_SECRET) are required");
  process.exit(1);
}

async function main() {
  const baseUrl = APP_URL.replace(/\/+$/, "");
  const url = `${baseUrl}/api/admin/calls/transcripts/outbox?limit=25`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-6esk-secret": secret
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  const payload = await response.json();
  console.log("Transcript outbox result:", payload);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
