// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Dashboard } from "@/lib/types";
import { Providers, mockFetch } from "@/test/utils";
import DashboardPage from "./page";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const DATA: Dashboard = {
  date: "2026-10-05",
  unread_notifications: 4,
  unread_messages: 2,
  upcoming_holidays: [],
  me: {
    attendance_today: null,
    self_attendance_enabled: true,
    leave_year: 2026,
    leave_balances: [],
    pending_leave_requests: 0,
    open_tasks: 3,
    blocking_tasks: 1,
    latest_payslip: null,
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("dashboard summary cards", () => {
  it("shows My Tasks, Unread Messages and Unread Notifications with distinct figure colours", async () => {
    mockFetch((url) => (url === "/api/dashboard/" ? { body: DATA } : undefined));
    render(
      <Providers>
        <DashboardPage />
      </Providers>,
    );
    const grid = await screen.findByTestId("summary-cards");
    const figure = (label: string) => {
      const cardLabel = within(grid).getByText(label);
      return cardLabel.closest("div")?.parentElement?.querySelector("[data-accent]");
    };
    expect((figure("My tasks"))?.textContent).toContain("3");
    expect((figure("Unread messages"))?.textContent).toContain("2");
    expect((figure("Unread notifications"))?.textContent).toContain("4");
    const accents = ["My tasks", "Unread messages", "Unread notifications"].map((l) => figure(l)?.getAttribute("data-accent"));
    expect(accents).toEqual(["tasks", "messages", "notifications"]);
    expect(new Set(["My tasks", "Unread messages", "Unread notifications"].map((l) => figure(l)?.className)).size).toBe(3);
  });

  it("lays the cards out in one responsive row that wraps evenly", async () => {
    mockFetch((url) => (url === "/api/dashboard/" ? { body: DATA } : undefined));
    render(
      <Providers>
        <DashboardPage />
      </Providers>,
    );
    const grid = await screen.findByTestId("summary-cards");
    // auto-fit columns: as many equal columns as fit (one row when wide), never narrower than 11.5rem
    expect(grid.className).toContain("[grid-template-columns:repeat(auto-fit,minmax(min(100%,11.5rem),1fr))]");
    expect(grid.children).toHaveLength(3);
  });
});
