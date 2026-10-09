import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDaysISO,
  fmtClockTime,
  fmtDate,
  fmtDateTime,
  fmtTime,
  isoToIstTime,
  istDateKey,
  istParts,
  istToISO,
  todayISO,
  twelveHour,
} from "./format";

afterEach(() => vi.useRealTimers());

describe("12-hour clock in India Standard Time", () => {
  it.each([
    ["2026-10-06T03:30:00Z", "9:00 AM"], // 03:30 UTC = 09:00 IST
    ["2026-10-06T07:30:00Z", "1:00 PM"],
    ["2026-10-06T08:30:00Z", "2:00 PM"],
    ["2026-10-06T12:30:00Z", "6:00 PM"],
    ["2026-10-06T06:30:00Z", "12:00 PM"], // noon
    ["2026-10-05T18:30:00Z", "12:00 AM"], // midnight IST (still the 5th in UTC)
    ["2026-10-05T18:35:00Z", "12:05 AM"],
    ["2026-10-06T18:29:00Z", "11:59 PM"],
    ["2026-10-06T14:30:00+05:30", "2:30 PM"], // API values carry the IST offset
  ])("%s -> %s", (iso, expected) => {
    expect(fmtTime(iso)).toBe(expected);
  });

  it("never shows a 24-hour time", () => {
    for (let h = 0; h < 24; h++) {
      const text = fmtTime(`2026-10-06T${String(h).padStart(2, "0")}:15:00+05:30`);
      expect(text).toMatch(/^(1[0-2]|[1-9]):15 (AM|PM)$/);
    }
  });

  it("formats dates and date-times in India whatever the browser's timezone", () => {
    expect(fmtDate("2026-10-05T19:00:00Z")).toBe("06 Oct 2026"); // already the 6th in India
    expect(fmtDateTime("2026-10-05T19:00:00Z")).toBe("06 Oct 2026, 12:30 AM");
    expect(fmtDate("2026-01-01")).toBe("01 Jan 2026"); // a date-only value is that Indian calendar day
  });

  it("formats wall-clock settings times", () => {
    expect(fmtClockTime("09:00:00")).toBe("9:00 AM");
    expect(fmtClockTime("18:30")).toBe("6:30 PM");
    expect(fmtClockTime("00:00")).toBe("12:00 AM");
    expect(fmtClockTime(null)).toBeNull();
    expect(twelveHour(12, 0)).toBe("12:00 PM");
  });
});

describe("India calendar day", () => {
  it("today rolls over at Indian midnight, not UTC midnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T18:29:00Z")); // 11:59 PM IST on the 6th
    expect(todayISO()).toBe("2026-10-06");
    vi.setSystemTime(new Date("2026-10-06T18:31:00Z")); // 12:01 AM IST on the 7th (UTC still the 6th)
    expect(todayISO()).toBe("2026-10-07");
    expect(istParts().hour).toBe(0);
  });

  it("converts form values to and from India time", () => {
    const iso = istToISO("2026-10-06", "18:00");
    expect(iso).toBe("2026-10-06T12:30:00.000Z");
    expect(isoToIstTime(iso)).toBe("18:00");
    expect(istDateKey("2026-10-06T19:00:00Z")).toBe("2026-10-07");
    expect(istToISO("2026-10-06", "")).toBeNull();
  });

  it("adds calendar days across month and year ends", () => {
    expect(addDaysISO("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysISO("2026-03-01", -1)).toBe("2026-02-28");
  });
});
