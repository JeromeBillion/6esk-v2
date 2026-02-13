export type VolumePoint = {
  day: string;
  count: number;
};

export type WhatsAppStatusSource = "all" | "webhook" | "outbox";

export type WhatsAppStatusAggregateRow = {
  day: Date;
  sent: number | string | null;
  delivered: number | string | null;
  read: number | string | null;
  failed: number | string | null;
};

export type WhatsAppStatusSeries = {
  sent: VolumePoint[];
  delivered: VolumePoint[];
  read: VolumePoint[];
  failed: VolumePoint[];
};

function toInt(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseWhatsAppStatusSource(
  value: string | null | undefined
): WhatsAppStatusSource {
  if (value === "webhook" || value === "outbox") {
    return value;
  }
  return "all";
}

export function buildWhatsAppStatusSeries(
  rows: WhatsAppStatusAggregateRow[]
): WhatsAppStatusSeries {
  const sorted = [...rows].sort((a, b) => a.day.getTime() - b.day.getTime());

  return {
    sent: sorted.map((row) => ({
      day: row.day.toISOString(),
      count: toInt(row.sent)
    })),
    delivered: sorted.map((row) => ({
      day: row.day.toISOString(),
      count: toInt(row.delivered)
    })),
    read: sorted.map((row) => ({
      day: row.day.toISOString(),
      count: toInt(row.read)
    })),
    failed: sorted.map((row) => ({
      day: row.day.toISOString(),
      count: toInt(row.failed)
    }))
  };
}
