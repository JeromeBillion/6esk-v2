const { INBOUND_SHARED_SECRET, APP_URL } = process.env;

if (!INBOUND_SHARED_SECRET || !APP_URL) {
  console.error("INBOUND_SHARED_SECRET and APP_URL are required");
  process.exit(1);
}

async function main() {
  const baseUrl = APP_URL.replace(/\/+$/, "");
  const url = `${baseUrl}/api/admin/inbound/alerts`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-6esk-secret": INBOUND_SHARED_SECRET
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  const payload = await response.json();
  console.log("Inbound alert result:", payload);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
