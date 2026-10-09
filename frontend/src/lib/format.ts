/**
 * Display formatting. Every date and time is shown in India Standard Time (Asia/Kolkata), whatever
 * the browser's or the server's timezone, with a 12-hour clock: 9:00 AM, 12:00 PM (noon),
 * 12:00 AM (midnight), 6:00 PM. The API keeps timezone-aware ISO timestamps; only display and
 * "which calendar day is it" use IST here. Durations (01:02:05 timers) are not clock times.
 */

export const APP_TIME_ZONE = "Asia/Kolkata";
/** IST has no daylight saving: a fixed +05:30. */
const IST_OFFSET = "+05:30";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: APP_TIME_ZONE });
const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: APP_TIME_ZONE });
const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "2026-10-01" (date-only) means that calendar day in India, not UTC midnight. */
function parse(value: string | Date): Date {
  if (value instanceof Date) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00${IST_OFFSET}`) : new Date(value);
}

export interface IstParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

/** Calendar date and clock of an instant, in India. */
export function istParts(value: string | Date = new Date()): IstParts {
  const parts: Record<string, string> = {};
  for (const p of PARTS.formatToParts(parse(value))) parts[p.type] = p.value;
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour % 24, minute: +parts.minute };
}

const pad = (n: number) => n.toString().padStart(2, "0");

/** 13, 5 -> "1:05 PM"; 0, 0 -> "12:00 AM"; 12, 0 -> "12:00 PM". */
export function twelveHour(hour: number, minute: number) {
  return `${hour % 12 || 12}:${pad(minute)} ${hour < 12 ? "AM" : "PM"}`;
}

export const fmtDate = (v?: string | null) => (v ? DATE.format(parse(v)) : "—");
export const fmtTime = (v?: string | null) => {
  if (!v) return "—";
  const p = istParts(v);
  return twelveHour(p.hour, p.minute);
};
export const fmtDateTime = (v?: string | null) => (v ? `${DATE.format(parse(v))}, ${fmtTime(v)}` : "—");
/** A wall-clock time from settings ("09:00:00" / "18:30") -> "9:00 AM" / "6:30 PM". */
export function fmtClockTime(value?: string | null) {
  const m = value?.match(/^(\d{1,2}):(\d{2})/);
  return m ? twelveHour(Number(m[1]), Number(m[2])) : null;
}
export const fmtWeekday = (v: string) => WEEKDAY.format(parse(v));

/** Today's date in India, "YYYY-MM-DD" (for date inputs and filters). */
export function todayISO() {
  return istDateKey(new Date());
}

/** The India calendar day of an instant, "YYYY-MM-DD". */
export function istDateKey(value: string | Date) {
  const p = istParts(value);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Calendar arithmetic on "YYYY-MM-DD" (no timezone involved). */
export function addDaysISO(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** An India date + 24-hour "HH:MM" -> ISO instant for the API. */
export function istToISO(date: string, time: string) {
  return time ? new Date(`${date}T${time}:00${IST_OFFSET}`).toISOString() : null;
}

/** ISO instant -> the India clock time as 24-hour "HH:MM" (form values, never displayed raw). */
export function isoToIstTime(iso: string | null | undefined) {
  if (!iso) return "";
  const p = istParts(iso);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const fmtPeriod = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function fmtMoney(value: string | number | null | undefined, currency?: string) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  const formatted = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${formatted}` : formatted;
}

export function fmtDays(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function fmtMinutes(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export function fmtBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** "NOTICE_PERIOD" -> "Notice period" */
export function humanize(value: string | null | undefined) {
  if (!value) return "—";
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
