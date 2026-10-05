// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Notification as AppNotification, NotificationUpdates } from "@/lib/types";
import { Providers, mockFetch } from "@/test/utils";
import { DesktopAlertsControl, NotificationCenterProvider, useNotificationCenter } from "./NotificationCenter";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push, replace: vi.fn() }),
}));

class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
  static shown: string[] = [];
  onclick: (() => void) | null = null;
  constructor(title: string) {
    FakeNotification.shown.push(title);
  }
  close() {}
}

const note = (id: number, title: string, type = "GENERAL"): AppNotification => ({
  id,
  type,
  title,
  message: "",
  entity_type: "",
  entity_id: "",
  link: null,
  is_read: false,
  read_at: null,
  created_at: `2026-10-05T10:00:0${id}Z`,
});

function Counts() {
  const c = useNotificationCenter();
  return <p data-testid="counts">{`${c?.notifications}/${c?.messages}`}</p>;
}

let replies: NotificationUpdates[] = [];
function serve() {
  return mockFetch((url) => {
    if (url.startsWith("/api/notifications/updates/")) {
      const next = replies.shift() ?? { server_time: "2026-10-05T10:01:00Z", notifications: [], unread_notifications: 0, unread_messages: 0 };
      return { body: next };
    }
  });
}

beforeEach(() => {
  window.localStorage.clear();
  FakeNotification.shown = [];
  FakeNotification.permission = "granted";
  vi.stubGlobal("Notification", FakeNotification);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("notification center", () => {
  it("keeps the header counts fresh and alerts each new item once while in the background", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false); // window minimised / another app in front
    replies = [
      { server_time: "2026-10-05T10:00:00Z", notifications: [], unread_notifications: 2, unread_messages: 1 },
      { server_time: "2026-10-05T10:00:30Z", notifications: [note(1, "New message from Bob", "MESSAGE_RECEIVED")], unread_notifications: 3, unread_messages: 2 },
      { server_time: "2026-10-05T10:01:00Z", notifications: [note(1, "New message from Bob", "MESSAGE_RECEIVED")], unread_notifications: 3, unread_messages: 2 },
    ];
    const { calls } = serve();
    render(
      <Providers>
        <NotificationCenterProvider userId={7}>
          <Counts />
        </NotificationCenterProvider>
      </Providers>,
    );
    await waitFor(() => expect((screen.getByTestId("counts"))?.textContent).toContain("2/1"));
    expect(FakeNotification.shown).toEqual([]); // nothing old pops up on load
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(FakeNotification.shown).toEqual(["New message from Bob"]));
    expect((screen.getByTestId("counts"))?.textContent).toContain("3/2");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(calls.filter((c) => c.url.startsWith("/api/notifications/updates/")).length).toBeGreaterThanOrEqual(3));
    expect(FakeNotification.shown).toHaveLength(1); // the same item never alerts twice
    const polls = calls.filter((c) => c.url.startsWith("/api/notifications/updates/"));
    expect(polls[0].url).not.toContain("since=");
    expect(polls[1].url).toContain("since=2026-10-05T10%3A00%3A00Z");
  });

  it("asks for permission from a click and reflects the browser's answer", async () => {
    FakeNotification.permission = "default";
    serve();
    render(
      <Providers>
        <NotificationCenterProvider userId={7}>
          <DesktopAlertsControl />
        </NotificationCenterProvider>
      </Providers>,
    );
    const button = await screen.findByRole("button", { name: "Enable desktop alerts" });
    FakeNotification.requestPermission.mockImplementationOnce(async () => {
      FakeNotification.permission = "denied";
      return "denied";
    });
    await act(async () => {
      button.click();
    });
    await waitFor(() => expect(screen.getByTestId("desktop-alerts").getAttribute("data-permission")).toBe("denied"));
  });

  it("explains when the browser cannot show desktop alerts", async () => {
    vi.stubGlobal("Notification", undefined);
    serve();
    render(
      <Providers>
        <NotificationCenterProvider userId={7}>
          <DesktopAlertsControl />
        </NotificationCenterProvider>
      </Providers>,
    );
    expect((await screen.findByTestId("desktop-alerts")).getAttribute("data-permission")).toBe("unsupported");
  });
});
