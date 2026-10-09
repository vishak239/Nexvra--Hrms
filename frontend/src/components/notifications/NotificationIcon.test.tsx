// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NOTIFICATION_CATEGORY, notificationCategory, notificationLink } from "@/lib/notifications";
import { CATEGORY_STYLE, NotificationIcon } from "./NotificationIcon";

afterEach(cleanup);

// Every type in backend/apps/notifications/models.py (Notification.Type).
const BACKEND_TYPES = [
  "LEAVE_SUBMITTED", "LEAVE_APPROVED", "LEAVE_REJECTED", "LEAVE_CANCELLED", "PAYSLIP_PUBLISHED", "DOCUMENT_SHARED",
  "TASK_ASSIGNED", "TASK_REMINDER", "TASK_RESPONSE", "TASK_COMPLETED", "TASK_CANCELLED", "MESSAGE_RECEIVED",
  "GROUP_MESSAGE_RECEIVED", "GROUP_ADDED", "FILE_RECEIVED", "OVERTIME_STARTED", "OVERTIME_COMPLETED", "SYNC_STATUS",
  "WFH_REQUESTED", "WFH_APPROVED", "WFH_REJECTED", "OVERTIME_REQUESTED", "OVERTIME_APPROVED", "OVERTIME_REJECTED",
  "OVERTIME_AUTO_STOPPED", "ATTENDANCE_AUTO_CHECKOUT", "BREAK_AUTO_ENDED", "PASSWORD_CHANGED", "MEETING_SCHEDULED",
  "MEETING_STARTED", "MEETING_ENDED", "MEETING_CANCELLED", "RESUME_REQUESTED", "RESUME_APPROVED", "RESUME_REJECTED",
  "GENERAL",
];

describe("notification categories", () => {
  it("maps every backend notification type to a category", () => {
    for (const type of BACKEND_TYPES) expect(NOTIFICATION_CATEGORY[type], type).toBeDefined();
    expect(Object.keys(NOTIFICATION_CATEGORY).sort()).toEqual([...BACKEND_TYPES].sort());
  });

  it.each([
    ["MESSAGE_RECEIVED", "message"],
    ["GROUP_MESSAGE_RECEIVED", "group"],
    ["MEETING_STARTED", "meeting"],
    ["LEAVE_APPROVED", "leave"],
    ["ATTENDANCE_AUTO_CHECKOUT", "attendance"],
    ["WFH_REQUESTED", "wfh"],
    ["TASK_ASSIGNED", "task"],
    ["OVERTIME_REQUESTED", "overtime"],
    ["BREAK_AUTO_ENDED", "break"],
    ["DOCUMENT_SHARED", "document"],
    ["PASSWORD_CHANGED", "security"],
    ["GENERAL", "general"],
    ["SOMETHING_NEW", "general"],
  ])("%s is a %s notification", (type, category) => {
    expect(notificationCategory(type)).toBe(category);
  });

  it("gives each category its own icon", () => {
    const icons = Object.values(CATEGORY_STYLE).map((s) => s.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("renders the icon with a readable label (not colour alone)", () => {
    render(<NotificationIcon type="WFH_APPROVED" />);
    const icon = screen.getByTestId("notification-icon");
    expect(icon.getAttribute("data-category")).toBe("wfh");
    expect(icon.textContent).toBe("Work from home");
    expect(icon.querySelector("svg")).not.toBeNull();
  });

  it("keeps the navigation links", () => {
    expect(notificationLink({ type: "MEETING_STARTED", link: null, entity_id: "3" })).toBe("/meetings");
    expect(notificationLink({ type: "PASSWORD_CHANGED", link: null, entity_id: "" })).toBe("/change-password");
    expect(notificationLink({ type: "GROUP_MESSAGE_RECEIVED", link: "/messages?c=4", entity_id: "4" })).toBe("/messages?c=4");
  });
});
