export interface Env {
  SIXESK_EMAIL_INGEST_URL: string;
  SIXESK_EMAIL_INGEST_SECRET: string;
  MAIL_DOMAIN?: string;
}

async function readRawEmail(message: ForwardableEmailMessage) {
  const raw = await new Response(message.raw).arrayBuffer();
  const bytes = new Uint8Array(raw);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const mailDomain = (env.MAIL_DOMAIN ?? "").trim().toLowerCase();
    if (mailDomain && !message.to.toLowerCase().endsWith(`@${mailDomain}`)) {
      message.setReject("Mailbox not handled by this worker.");
      return;
    }

    const payload = {
      raw: await readRawEmail(message),
      metadata: {
        source: "cloudflare_email_worker",
        envelopeFrom: message.from,
        envelopeTo: message.to,
        headers: Object.fromEntries(message.headers)
      }
    };

    const response = await fetch(env.SIXESK_EMAIL_INGEST_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-6esk-secret": env.SIXESK_EMAIL_INGEST_SECRET
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const details = await response.text();
      message.setReject(`6esk email ingest failed: ${details || response.statusText}`);
    }
  }
};
