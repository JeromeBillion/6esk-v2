import { db } from "@/server/db";

const WINDOW_MS = 24 * 60 * 60 * 1000;

export type WhatsAppWindowStatus = {
  isOpen: boolean;
  lastInboundAt: string | null;
  expiresAt: string | null;
  minutesRemaining: number | null;
};

export async function getWhatsAppWindowStatus(ticketId: string) {
  const result = await db.query<{ received_at: Date | null; created_at: Date | null }>(
    `SELECT received_at, created_at
     FROM messages
     WHERE ticket_id = $1
       AND channel = 'whatsapp'
       AND direction = 'inbound'
     ORDER BY COALESCE(received_at, created_at) DESC
     LIMIT 1`,
    [ticketId]
  );

  const row = result.rows[0];
  if (!row) {
    return {
      isOpen: false,
      lastInboundAt: null,
      expiresAt: null,
      minutesRemaining: null
    } satisfies WhatsAppWindowStatus;
  }

  const lastInboundAt = row.received_at ?? row.created_at ?? null;
  if (!lastInboundAt) {
    return {
      isOpen: false,
      lastInboundAt: null,
      expiresAt: null,
      minutesRemaining: null
    } satisfies WhatsAppWindowStatus;
  }

  const lastMs = lastInboundAt.getTime();
  const expiresMs = lastMs + WINDOW_MS;
  const nowMs = Date.now();
  const isOpen = nowMs <= expiresMs;
  const remaining = isOpen ? Math.max(0, Math.ceil((expiresMs - nowMs) / 60000)) : 0;

  return {
    isOpen,
    lastInboundAt: lastInboundAt.toISOString(),
    expiresAt: new Date(expiresMs).toISOString(),
    minutesRemaining: isOpen ? remaining : 0
  } satisfies WhatsAppWindowStatus;
}
