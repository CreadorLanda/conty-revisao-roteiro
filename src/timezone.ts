export const BRAND_TIME_ZONE = "America/Sao_Paulo";

const CIVIL_DAY = /^\d{4}-\d{2}-\d{2}$/;

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsFormatter.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatter.set(timeZone, formatter);
  }
  return formatter;
}

function zoneOffsetMs(instant: Date, timeZone: string): number {
  const field = new Map<string, number>();
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") field.set(part.type, Number(part.value));
  }
  const rawHour = field.get("hour") ?? 0;
  const wallAsUtc = Date.UTC(
    field.get("year") ?? 0,
    (field.get("month") ?? 1) - 1,
    field.get("day") ?? 1,
    rawHour === 24 ? 0 : rawHour,
    field.get("minute") ?? 0,
    field.get("second") ?? 0,
  );
  return wallAsUtc - instant.getTime();
}

export function isCivilDay(value: unknown): value is string {
  if (typeof value !== "string" || !CIVIL_DAY.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function endOfCivilDay(day: string, timeZone: string): Date {
  const [year = 0, month = 0, dayOfMonth = 0] = day.split("-").map(Number);
  const nextMidnight = Date.UTC(year, month - 1, dayOfMonth + 1, 0, 0, 0, 0);
  const offset = zoneOffsetMs(new Date(nextMidnight), timeZone);
  return new Date(nextMidnight - offset - 1);
}
