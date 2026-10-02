import { describe, expect, it } from "vitest";
import { fmtBytes, fmtDate, fmtDays, fmtMinutes, fmtMoney, fmtPeriod, humanize, initials } from "./format";
import { visibleNav } from "./nav";
import type { Me } from "./types";

describe("format", () => {
  it("formats date-only strings as calendar dates (no timezone shift)", () => {
    expect(fmtDate("2026-01-01")).toBe("01 Jan 2026");
    expect(fmtDate(null)).toBe("—");
  });

  it("formats money with optional currency and never as float noise", () => {
    expect(fmtMoney("1234.5")).toBe("1,234.50");
    expect(fmtMoney("950.00", "INR")).toBe("INR 950.00");
    expect(fmtMoney(null)).toBe("—");
  });

  it("formats days, minutes, bytes, periods", () => {
    expect(fmtDays("12.0")).toBe("12");
    expect(fmtDays("0.5")).toBe("0.5");
    expect(fmtMinutes(510)).toBe("8h 30m");
    expect(fmtBytes(2048)).toBe("2.0 KB");
    expect(fmtPeriod(2026, 10)).toBe("October 2026");
  });

  it("humanizes enum values and builds initials", () => {
    expect(humanize("NOTICE_PERIOD")).toBe("Notice period");
    expect(initials("Demo Employee Two")).toBe("DE");
  });
});

function me(permissions: string[], employee = true): Me {
  return {
    id: 1,
    email: "x@example.test",
    first_name: "X",
    last_name: "",
    full_name: "X",
    role: { id: 1, code: "EMPLOYEE", name: "Employee", level: 10 },
    permissions,
    must_change_password: false,
    employee: employee ? { id: 1, employee_code: "E1", department: null, designation: null, has_photo: false } : null,
  };
}

const labels = (m: Me) => visibleNav(m).flatMap((s) => s.items.map((i) => i.label));

describe("visibleNav", () => {
  it("shows an employee only self-service items", () => {
    const items = labels(me(["attendance.self", "leave.apply", "payroll.view_own", "documents.view_own"]));
    expect(items).toContain("My payslips");
    expect(items).not.toContain("Employees");
    expect(items).not.toContain("Payroll");
    expect(items).not.toContain("Audit log");
  });

  it("shows admin items only with matching permissions", () => {
    expect(labels(me(["audit.view", "users.view"]))).toEqual(expect.arrayContaining(["Audit log", "Users & roles"]));
  });

  it("hides employee-only items for accounts without an employee record", () => {
    const items = labels(me(["payroll.view_own"], false));
    expect(items).not.toContain("My payslips");
    expect(items).not.toContain("My profile");
  });
});
