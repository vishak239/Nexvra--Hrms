// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlertLedger,
  MAX_POPUPS,
  alertKey,
  desktopPermission,
  notificationLink,
  planAlerts,
  requestDesktopPermission,
  showDesktopAlert,
} from "./notifications";
import type { Notification as AppNotification } from "./types";

const note = (id: number, type = "GENERAL", created = `2026-10-05T10:00:0${id % 10}Z`): AppNotification => ({
  id,
  type,
  title: `Title ${id}`,
  message: "Body",
  entity_type: "",
  entity_id: "",
  link: null,
  is_read: false,
  read_at: null,
  created_at: created,
});

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
  static shown: { title: string; options: NotificationOptions }[] = [];
  onclick: (() => void) | null = null;
  constructor(
    public title: string,
    public options: NotificationOptions,
  ) {
    FakeNotification.shown.push({ title, options });
  }
  close() {}
}

beforeEach(() => {
  window.localStorage.clear();
  FakeNotification.shown = [];
  FakeNotification.permission = "granted";
  FakeNotification.requestPermission.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("desktop alert planning", () => {
  it("uses in-app toasts while the tab is in front", () => {
    const plan = planAlerts([note(1)], new AlertLedger("t"), { foreground: true, permission: "granted", onMessagesPage: false });
    expect(plan.toasts.map((n) => n.id)).toEqual([1]);
    expect(plan.popups).toEqual([]);
  });

  it("uses desktop popups in the background or when minimised, only with permission", () => {
    const bg = { foreground: false, onMessagesPage: false };
    expect(planAlerts([note(1)], new AlertLedger("a"), { ...bg, permission: "granted" }).popups).toHaveLength(1);
    expect(planAlerts([note(1)], new AlertLedger("b"), { ...bg, permission: "denied" })).toEqual({ popups: [], summary: 0, toasts: [] });
    expect(planAlerts([note(1)], new AlertLedger("c"), { ...bg, permission: "unsupported" }).popups).toHaveLength(0);
  });

  it("never alerts the same item twice, across tabs and reloads", () => {
    const opts = { foreground: false, permission: "granted" as const, onMessagesPage: false };
    expect(planAlerts([note(1)], new AlertLedger("shared"), opts).popups).toHaveLength(1);
    expect(planAlerts([note(1)], new AlertLedger("shared"), opts).popups).toHaveLength(0); // another tab / after a reload
    // A collapsed message alert refreshed by a new message is new again.
    const refreshed = { ...note(1, "MESSAGE_RECEIVED"), created_at: "2026-10-05T10:05:00Z" };
    expect(planAlerts([refreshed], new AlertLedger("shared"), opts).popups).toHaveLength(1);
    expect(new AlertLedger("shared").has(alertKey(refreshed))).toBe(true);
  });

  it("limits a burst to a few popups plus one summary", () => {
    const many = Array.from({ length: 7 }, (_, i) => note(i + 1));
    const plan = planAlerts(many, new AlertLedger("burst"), { foreground: false, permission: "granted", onMessagesPage: false });
    expect(plan.popups).toHaveLength(MAX_POPUPS);
    expect(plan.summary).toBe(7 - MAX_POPUPS);
  });

  it("skips message alerts while the Messages page is in front, and read items", () => {
    const items = [note(1, "MESSAGE_RECEIVED"), { ...note(2), is_read: true }, note(3, "TASK_ASSIGNED")];
    const plan = planAlerts(items, new AlertLedger("m"), { foreground: true, permission: "granted", onMessagesPage: true });
    expect(plan.toasts.map((n) => n.id)).toEqual([3]);
  });
});

describe("browser Notifications API", () => {
  it("reports unsupported browsers and never throws", async () => {
    vi.stubGlobal("Notification", undefined);
    expect(desktopPermission()).toBe("unsupported");
    expect(await requestDesktopPermission()).toBe("unsupported");
    expect(showDesktopAlert("t", "b", "tag", () => undefined)).toBeNull();
  });

  it("asks only when the user has not decided yet", async () => {
    vi.stubGlobal("Notification", FakeNotification);
    FakeNotification.permission = "denied";
    expect(await requestDesktopPermission()).toBe("denied");
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    FakeNotification.permission = "default";
    expect(await requestDesktopPermission()).toBe("granted");
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it("shows a tagged popup with the default sound and opens the item on click", () => {
    vi.stubGlobal("Notification", FakeNotification);
    const open = vi.fn();
    const popup = showDesktopAlert("New message from Bob", "Open Messages to read it.", "nexvra-5", open) as unknown as FakeNotification;
    expect(FakeNotification.shown[0].options).toMatchObject({ tag: "nexvra-5", silent: false, body: "Open Messages to read it." });
    popup.onclick?.();
    expect(open).toHaveBeenCalled();
    FakeNotification.permission = "denied";
    expect(showDesktopAlert("x", "y", "z", open)).toBeNull();
  });

  it("links notifications to their page", () => {
    expect(notificationLink({ type: "LEAVE_SUBMITTED", link: null, entity_id: "" })).toBe("/leave?tab=approvals");
    expect(notificationLink({ type: "MEETING_STARTED", link: "/meetings", entity_id: "3" })).toBe("/meetings");
    expect(notificationLink({ type: "GENERAL", link: null, entity_id: "" })).toBeNull();
  });
});
