export type DateRange = {
  start: Date;
  end: Date;
};

const toStartOfDayUtc = (date: Date) => {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
};

const toEndExclusiveUtc = (date: Date) => {
  const copy = toStartOfDayUtc(date);
  copy.setUTCDate(copy.getUTCDate() + 1);
  return copy;
};

const parseDateInput = (value: string, asEnd: boolean) => {
  if (value.includes("T")) {
    return new Date(value);
  }
  const date = new Date(`${value}T00:00:00Z`);
  return asEnd ? toEndExclusiveUtc(date) : toStartOfDayUtc(date);
};

export function getDateRange(searchParams: URLSearchParams) {
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  if (startParam && endParam) {
    return {
      start: parseDateInput(startParam, false),
      end: parseDateInput(endParam, true)
    };
  }

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 7);
  return { start, end };
}

export function getTodayRangeUtc() {
  const now = new Date();
  return {
    start: toStartOfDayUtc(now),
    end: toEndExclusiveUtc(now)
  };
}
