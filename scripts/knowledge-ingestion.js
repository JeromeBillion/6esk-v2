const { APP_URL, KNOWLEDGE_INGESTION_SECRET, CRON_SECRET } = process.env;

const secret = KNOWLEDGE_INGESTION_SECRET || CRON_SECRET || "";

if (!APP_URL || !secret) {
  console.error("APP_URL and KNOWLEDGE_INGESTION_SECRET (or CRON_SECRET) are required");
  process.exit(1);
}

async function main() {
  const baseUrl = APP_URL.replace(/\/+$/, "");
  const url = `${baseUrl}/api/admin/ai/knowledge/ingestion?limit=25`;
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
  console.log("Knowledge ingestion result:", payload);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
