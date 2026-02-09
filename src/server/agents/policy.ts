type WorkingHours = {
  timezone?: string;
  days?: number[];
  start?: string;
  end?: string;
};

type AgentPolicy = {
  working_hours?: WorkingHours;
  escalation?: Record<string, unknown>;
};

function parseTime(value?: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
}

function getLocalParts(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false
  });
  const parts = formatter.formatToParts(new Date());
  const partMap: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      partMap[part.type] = part.value;
    }
  }
  return partMap;
}

function weekdayToIndex(value: string) {
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return map[value] ?? null;
}

export function isWithinWorkingHours(policy: AgentPolicy | null | undefined) {
  if (!policy?.working_hours) return true;

  const working = policy.working_hours;
  const timeZone = working.timezone ?? "UTC";
  const start = parseTime(working.start);
  const end = parseTime(working.end);

  if (start === null || end === null) {
    return true;
  }

  let parts: Record<string, string>;
  try {
    parts = getLocalParts(timeZone);
  } catch (error) {
    return true;
  }

  const weekday = weekdayToIndex(parts.weekday ?? "");
  if (weekday === null) {
    return true;
  }

  if (Array.isArray(working.days) && working.days.length > 0) {
    if (!working.days.includes(weekday)) {
      return false;
    }
  }

  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (Number.isNaN(minutes)) return true;

  if (end > start) {
    return minutes >= start && minutes <= end;
  }

  return minutes >= start || minutes <= end;
}

export function isAutoSendAllowed(integration: {
  policy_mode: string;
  policy?: Record<string, unknown> | null;
}) {
  if (integration.policy_mode !== "auto_send") {
    return false;
  }
  return isWithinWorkingHours(integration.policy as AgentPolicy);
}
