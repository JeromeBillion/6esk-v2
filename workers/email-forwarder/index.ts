export interface Env {
  INBOUND_URL: string;
  INBOUND_SHARED_SECRET?: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export default {
  async email(message: ForwardableEmailMessage, env: Env) {
    const headers = message.headers;
    const subject = headers.get("subject") ?? undefined;
    const messageId = headers.get("message-id") ?? undefined;
    const date = headers.get("date") ?? undefined;

    const rawBuffer = await new Response(message.raw).arrayBuffer();
    const rawBase64 = arrayBufferToBase64(rawBuffer);

    const payload = {
      from: message.from,
      to: Array.from(message.to),
      subject,
      messageId,
      date,
      raw: rawBase64
    };

    await fetch(env.INBOUND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(env.INBOUND_SHARED_SECRET
          ? { "x-6esk-secret": env.INBOUND_SHARED_SECRET }
          : {})
      },
      body: JSON.stringify(payload)
    });
  }
};
