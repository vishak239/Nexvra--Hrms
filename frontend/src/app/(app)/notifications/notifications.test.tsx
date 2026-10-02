// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Providers, mockFetch } from "@/test/utils";
import NotificationsPage from "./page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("task notification", () => {
  it("names the person and links to the task", async () => {
    mockFetch((url) => {
      if (url.startsWith("/api/notifications/"))
        return {
          body: {
            count: 1, next: null, previous: null,
            results: [{
              id: 1, type: "TASK_ASSIGNED", title: "@vishak, HR assigned you a new task",
              message: "Task assigned to Employee ID EMP-1024: Update employee database.", entity_type: "tasks.Task",
              entity_id: "31", link: "/tasks?task=31", is_read: false, read_at: null, created_at: "2026-10-02T10:00:00Z",
            }],
          },
        };
    });
    render(<Providers><NotificationsPage /></Providers>);
    const title = await screen.findByText("@vishak, HR assigned you a new task");
    expect(title.closest("a")?.getAttribute("href")).toBe("/tasks?task=31");
    expect(screen.getByText(/Employee ID EMP-1024/)).toBeTruthy();
    expect(screen.getAllByText("Unread").length).toBeGreaterThan(1); // tab + screen-reader marker
  });
});
