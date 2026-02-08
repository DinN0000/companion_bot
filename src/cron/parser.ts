/**
 * Cron expression parser and scheduler utilities
 */

import cron from "node-cron";
import type {
  Schedule,
  ParsedCronExpression,
  CronField,
} from "./types.js";

// Day name mappings
const DAY_NAMES: Record<string, number> = {
  SUN: 0, SUNDAY: 0,
  MON: 1, MONDAY: 1,
  TUE: 2, TUESDAY: 2,
  WED: 3, WEDNESDAY: 3,
  THU: 4, THURSDAY: 4,
  FRI: 5, FRIDAY: 5,
  SAT: 6, SATURDAY: 6,
};

// Month name mappings
const MONTH_NAMES: Record<string, number> = {
  JAN: 1, JANUARY: 1,
  FEB: 2, FEBRUARY: 2,
  MAR: 3, MARCH: 3,
  APR: 4, APRIL: 4,
  MAY: 5,
  JUN: 6, JUNE: 6,
  JUL: 7, JULY: 7,
  AUG: 8, AUGUST: 8,
  SEP: 9, SEPTEMBER: 9,
  OCT: 10, OCTOBER: 10,
  NOV: 11, NOVEMBER: 11,
  DEC: 12, DECEMBER: 12,
};

// Korean mappings
const KOREAN_DAYS: Record<string, number> = {
  "일요일": 0, "일": 0,
  "월요일": 1, "월": 1,
  "화요일": 2, "화": 2,
  "수요일": 3, "수": 3,
  "목요일": 4, "목": 4,
  "금요일": 5, "금": 5,
  "토요일": 6, "토": 6,
};

/**
 * Validate a cron expression
 */
export function isValidCronExpression(expr: string): boolean {
  return cron.validate(expr);
}

/**
 * Parse a cron field (minute, hour, etc.)
 */
function parseCronField(
  field: string,
  min: number,
  max: number,
  nameMap?: Record<string, number>
): CronField {
  // Replace names with numbers
  let processed = field.toUpperCase();
  if (nameMap) {
    for (const [name, value] of Object.entries(nameMap)) {
      processed = processed.replace(new RegExp(name, "g"), String(value));
    }
  }

  // Wildcard
  if (processed === "*") {
    return { type: "wildcard", values: range(min, max) };
  }

  // List (e.g., "1,3,5")
  if (processed.includes(",")) {
    const values = processed.split(",").flatMap((part) => {
      const parsed = parseCronField(part.trim(), min, max);
      return parsed.values;
    });
    return { type: "list", values: [...new Set(values)].sort((a, b) => a - b) };
  }

  // Step (e.g., "*/5" or "0-30/5")
  if (processed.includes("/")) {
    const [rangeStr, stepStr] = processed.split("/");
    const step = parseInt(stepStr, 10);
    let start = min;
    let end = max;

    if (rangeStr !== "*") {
      if (rangeStr.includes("-")) {
        [start, end] = rangeStr.split("-").map((s) => parseInt(s, 10));
      } else {
        start = parseInt(rangeStr, 10);
      }
    }

    const values: number[] = [];
    for (let i = start; i <= end; i += step) {
      values.push(i);
    }
    return { type: "step", values };
  }

  // Range (e.g., "9-17")
  if (processed.includes("-")) {
    const [start, end] = processed.split("-").map((s) => parseInt(s, 10));
    return { type: "range", values: range(start, end) };
  }

  // Single value
  const value = parseInt(processed, 10);
  return { type: "value", values: [value] };
}

/**
 * Generate a range of numbers
 */
function range(start: number, end: number): number[] {
  const result: number[] = [];
  for (let i = start; i <= end; i++) {
    result.push(i);
  }
  return result;
}

/**
 * Parse a cron expression into structured format
 * Format: "minute hour dayOfMonth month dayOfWeek"
 * Example: "0 9 * * MON" = every Monday at 9:00
 */
export function parseCronExpression(expr: string): ParsedCronExpression {
  const normalized = expr.trim().replace(/\s+/g, " ");
  
  if (!isValidCronExpression(normalized)) {
    throw new Error(`Invalid cron expression: ${expr}`);
  }

  const parts = normalized.split(" ");
  if (parts.length !== 5) {
    throw new Error(`Cron expression must have 5 fields: ${expr}`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return {
    minute: parseCronField(minute, 0, 59),
    hour: parseCronField(hour, 0, 23),
    dayOfMonth: parseCronField(dayOfMonth, 1, 31),
    month: parseCronField(month, 1, 12, MONTH_NAMES),
    dayOfWeek: parseCronField(dayOfWeek, 0, 6, DAY_NAMES),
    original: normalized,
  };
}

/**
 * Calculate the next run time for a cron expression
 */
export function getNextCronRun(
  expression: string,
  fromDate: Date = new Date(),
  timezone?: string
): Date {
  const parsed = parseCronExpression(expression);
  const from = new Date(fromDate);
  
  // Start from the next minute
  from.setSeconds(0);
  from.setMilliseconds(0);
  from.setMinutes(from.getMinutes() + 1);

  // Search for the next matching time (max 2 years ahead)
  const maxIterations = 365 * 24 * 60 * 2; // 2 years in minutes
  
  for (let i = 0; i < maxIterations; i++) {
    const candidate = new Date(from.getTime() + i * 60000);
    
    const minute = candidate.getMinutes();
    const hour = candidate.getHours();
    const dayOfMonth = candidate.getDate();
    const month = candidate.getMonth() + 1;
    const dayOfWeek = candidate.getDay();

    if (
      parsed.minute.values.includes(minute) &&
      parsed.hour.values.includes(hour) &&
      parsed.month.values.includes(month) &&
      (parsed.dayOfMonth.values.includes(dayOfMonth) ||
        parsed.dayOfWeek.values.includes(dayOfWeek))
    ) {
      return candidate;
    }
  }

  throw new Error(`Could not find next run time for: ${expression}`);
}

/**
 * Get the next run time for any schedule type
 */
export function getNextRun(schedule: Schedule, now: Date = new Date()): number {
  switch (schedule.kind) {
    case "at":
      return schedule.atMs;

    case "every": {
      const startMs = schedule.startMs ?? now.getTime();
      const elapsed = now.getTime() - startMs;
      const intervals = Math.floor(elapsed / schedule.everyMs);
      return startMs + (intervals + 1) * schedule.everyMs;
    }

    case "cron":
      return getNextCronRun(schedule.expression, now, schedule.timezone).getTime();

    default:
      throw new Error(`Unknown schedule kind: ${(schedule as Schedule).kind}`);
  }
}

/**
 * Check if a schedule is due (should run now)
 */
export function isDue(schedule: Schedule, now: Date = new Date()): boolean {
  const nextRun = getNextRun(schedule, new Date(now.getTime() - 60000));
  const diff = Math.abs(now.getTime() - nextRun);
  return diff < 60000; // Within 1 minute tolerance
}

// ============================================================
// Korean natural language parsing (선택적 기능)
// ============================================================

interface KoreanParseResult {
  expression: string;
  description: string;
}

/**
 * Parse Korean time expressions to cron format
 * Examples:
 *   "매일 9시" → "0 9 * * *"
 *   "매주 월요일 9시" → "0 9 * * 1"
 *   "매월 1일 오전 10시" → "0 10 1 * *"
 *   "평일 9시" → "0 9 * * 1-5"
 *   "주말 10시 30분" → "30 10 * * 0,6"
 */
export function parseKorean(text: string): KoreanParseResult | null {
  const normalized = text.trim();
  
  // Extract time (시, 분)
  let hour = 0;
  let minute = 0;

  // 오전/오후 처리
  const isPM = normalized.includes("오후") || normalized.includes("저녁") || normalized.includes("밤");
  const isAM = normalized.includes("오전") || normalized.includes("아침");

  // 시간 추출: "9시", "9시 30분", "09:30"
  const timeMatch = normalized.match(/(\d{1,2})시(?:\s*(\d{1,2})분)?/);
  const colonMatch = normalized.match(/(\d{1,2}):(\d{2})/);

  if (timeMatch) {
    hour = parseInt(timeMatch[1], 10);
    minute = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
  } else if (colonMatch) {
    hour = parseInt(colonMatch[1], 10);
    minute = parseInt(colonMatch[2], 10);
  } else {
    return null; // No time found
  }

  // 오후 처리 (1-11시 → 13-23시)
  if (isPM && hour >= 1 && hour <= 11) {
    hour += 12;
  }
  // 오전 12시 → 0시
  if (isAM && hour === 12) {
    hour = 0;
  }

  // Determine schedule pattern
  let dayOfMonth = "*";
  let dayOfWeek = "*";
  let description = "";

  // 매일
  if (normalized.includes("매일") || normalized.includes("날마다")) {
    description = `매일 ${hour}시${minute ? ` ${minute}분` : ""}`;
  }
  // 평일
  else if (normalized.includes("평일")) {
    dayOfWeek = "1-5";
    description = `평일 ${hour}시${minute ? ` ${minute}분` : ""}`;
  }
  // 주말
  else if (normalized.includes("주말")) {
    dayOfWeek = "0,6";
    description = `주말 ${hour}시${minute ? ` ${minute}분` : ""}`;
  }
  // 매주 + 요일
  else if (normalized.includes("매주")) {
    for (const [korDay, dayNum] of Object.entries(KOREAN_DAYS)) {
      if (normalized.includes(korDay)) {
        dayOfWeek = String(dayNum);
        description = `매주 ${korDay} ${hour}시${minute ? ` ${minute}분` : ""}`;
        break;
      }
    }
    if (dayOfWeek === "*") {
      return null; // 요일 없음
    }
  }
  // 매월 + 일
  else if (normalized.includes("매월") || normalized.includes("매달")) {
    const dayMatch = normalized.match(/(\d{1,2})일/);
    if (dayMatch) {
      dayOfMonth = dayMatch[1];
      description = `매월 ${dayOfMonth}일 ${hour}시${minute ? ` ${minute}분` : ""}`;
    } else {
      dayOfMonth = "1"; // 기본값: 1일
      description = `매월 1일 ${hour}시${minute ? ` ${minute}분` : ""}`;
    }
  }
  // 특정 요일만 (매주 없이)
  else {
    for (const [korDay, dayNum] of Object.entries(KOREAN_DAYS)) {
      if (normalized.includes(korDay)) {
        dayOfWeek = String(dayNum);
        description = `${korDay} ${hour}시${minute ? ` ${minute}분` : ""}`;
        break;
      }
    }
    if (dayOfWeek === "*" && dayOfMonth === "*") {
      // 시간만 있으면 매일로 간주
      description = `매일 ${hour}시${minute ? ` ${minute}분` : ""}`;
    }
  }

  const expression = `${minute} ${hour} ${dayOfMonth} * ${dayOfWeek}`;

  // Validate generated expression
  if (!isValidCronExpression(expression)) {
    return null;
  }

  return { expression, description };
}

/**
 * Format a cron expression to human-readable Korean
 */
export function formatKorean(expression: string): string {
  try {
    const parsed = parseCronExpression(expression);
    const parts: string[] = [];

    // Day of week
    if (parsed.dayOfWeek.type !== "wildcard") {
      const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
      if (parsed.dayOfWeek.values.length === 5 && 
          parsed.dayOfWeek.values.every((v: number, i: number) => v === i + 1)) {
        parts.push("평일");
      } else if (parsed.dayOfWeek.values.length === 2 &&
                 parsed.dayOfWeek.values.includes(0) &&
                 parsed.dayOfWeek.values.includes(6)) {
        parts.push("주말");
      } else {
        const days = parsed.dayOfWeek.values.map((d: number) => dayNames[d] + "요일");
        parts.push(`매주 ${days.join(", ")}`);
      }
    } else if (parsed.dayOfMonth.type !== "wildcard") {
      parts.push(`매월 ${parsed.dayOfMonth.values.join(", ")}일`);
    } else {
      parts.push("매일");
    }

    // Time
    const hour = parsed.hour.values[0];
    const minute = parsed.minute.values[0];
    const ampm = hour < 12 ? "오전" : "오후";
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    
    if (minute === 0) {
      parts.push(`${ampm} ${displayHour}시`);
    } else {
      parts.push(`${ampm} ${displayHour}시 ${minute}분`);
    }

    return parts.join(" ");
  } catch {
    return expression;
  }
}
