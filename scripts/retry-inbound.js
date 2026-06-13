const { INBOUND_SHARED_SECRET, APP_URL, INBOUND_TENANT_ID } = process.env;

if (!INBOUND_SHARED_SECRET || !APP_URL || !INBOUND_TENANT_ID) {
  console.error("INBOUND_SHARED_SECRET, APP_URL, and INBOUND_TENANT_ID are required");
  process.exit(1);
}

async function main() {
  const baseUrl = APP_URL.replace(/\/+$/, "");
  const url = `${baseUrl}/api/admin/inbound/retry?limit=25`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-6esk-secret": INBOUND_SHARED_SECRET,
      "x-6esk-tenant-id": INBOUND_TENANT_ID
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  const payload = await response.json();
  console.log("Inbound retry result:", payload);

  const alertUrl = `${baseUrl}/api/admin/inbound/alerts`;
  const alertRes = await fetch(alertUrl, {
    method: "POST",
    headers: {
      "x-6esk-secret": INBOUND_SHARED_SECRET,
      "x-6esk-tenant-id": INBOUND_TENANT_ID
    }
  });
  if (alertRes.ok) {
    const alertPayload = await alertRes.json();
    console.log("Inbound alert result:", alertPayload);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
