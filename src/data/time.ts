import { BEIJING_TIME_ZONE } from "./constants";
import { DataValidationError } from "./errors";

const BEIJING_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: BEIJING_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const MINUTE_IN_MILLISECONDS = 60_000;

export function assertEpochMilliseconds(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new DataValidationError(`${fieldName} 必须是毫秒时间戳整数。`);
  }

  if (Number.isNaN(new Date(value).getTime())) {
    throw new DataValidationError(`${fieldName} 不是有效时间。`);
  }
}

/**
 * Converts an epoch-millisecond instant to its Asia/Shanghai calendar date.
 * The device's local timezone is never consulted.
 */
export function toBeijingDate(epochMilliseconds: number): string {
  assertEpochMilliseconds(epochMilliseconds, "反馈时间");

  const parts = BEIJING_DATE_FORMATTER.formatToParts(
    new Date(epochMilliseconds),
  );
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new DataValidationError("无法计算北京时间日期。");
  }

  return `${year}-${month}-${day}`;
}

export function isBeijingDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function shiftBeijingDate(date: string, dayOffset: number): string {
  if (!isBeijingDate(date)) {
    throw new DataValidationError("日期必须是有效的 YYYY-MM-DD。");
  }
  if (!Number.isSafeInteger(dayOffset)) {
    throw new DataValidationError("日期偏移量必须是整数天。");
  }
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(
    Date.UTC(year, month - 1, day + dayOffset),
  );
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Rounds an instant up to the next whole minute. An instant already on a
 * minute boundary is unchanged.
 */
export function ceilEpochMillisecondsToMinute(
  epochMilliseconds: number,
): number {
  assertEpochMilliseconds(epochMilliseconds, "到期时间");
  const rounded =
    Math.ceil(epochMilliseconds / MINUTE_IN_MILLISECONDS) *
    MINUTE_IN_MILLISECONDS;
  assertEpochMilliseconds(rounded, "取整后的到期时间");
  return rounded;
}

