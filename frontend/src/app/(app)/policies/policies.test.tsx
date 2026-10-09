// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompanySettings, Me, Policy } from "@/lib/types";
import { ME, Providers, mockFetch } from "@/test/utils";
import PoliciesPage from "./page";

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

const SETTINGS: CompanySettings = {
  timezone: "", currency: "", working_days: [0, 1, 2, 3, 4], work_start_time: "09:00:00", work_end_time: "18:00:00",
  late_grace_minutes: 10, break_allowance_minutes: 60, half_day_min_hours: null, full_day_min_hours: null,
  self_attendance_enabled: true, leave_year_start_month: null, employee_document_upload_enabled: false,
  deactivate_user_on_exit: false, max_upload_size_mb: null, updated_at: "2026-10-01T00:00:00Z",
  workplace_latitude: null, workplace_longitude: null, geofence_radius_m: 20, geofence_max_accuracy_m: 100,
  inactivity_timeout_minutes: 30, overtime_requires_approval: true,
};

const POLICY: Policy = {
  id: 3, title: "Communication", category: "COMMUNICATION", category_label: "Communication",
  body: "Use the company chat for work conversations.", effective_date: "2026-11-01", is_published: true,
  updated_by_name: "Demo HR", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z",
};

const HR: Me = {
  ...ME,
  id: 2,
  email: "hr@example.test",
  full_name: "Demo HR",
  role: { id: 2, code: "HR_ADMIN", name: "HR Admin", level: 50 },
  permissions: [...ME.permissions, "policies.manage", "settings.manage"],
};

const page = (results: Policy[]) => ({ body: { count: results.length, next: null, previous: null, results } });
const body = (init?: RequestInit) => (init?.body ? JSON.parse(String(init.body)) : undefined);

describe("Policies page", () => {
  it("shows employees the published policies and the rules read from settings, without editing", async () => {
    mockFetch((url) => {
      if (url === "/api/settings/") return { body: SETTINGS };
      if (url.startsWith("/api/policies/")) return page([POLICY]);
    });
    render(<Providers><PoliciesPage /></Providers>);

    expect(await screen.findByRole("heading", { name: "Communication" })).toBeTruthy();
    expect(screen.getByText("Use the company chat for work conversations.")).toBeTruthy();
    const allowance = (await screen.findByText("Daily break allowance")).parentElement!;
    expect(within(allowance).getByText("60 min")).toBeTruthy();
    expect(screen.getByText("Mon – Fri")).toBeTruthy();
    expect(screen.getByText("9:00 AM – 6:00 PM")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New policy" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    expect(screen.queryByLabelText("Status")).toBeNull();
  });

  it("lets HR publish a new policy and shows server validation errors", async () => {
    let attempts = 0;
    const { calls } = mockFetch((url, init) => {
      if (url === "/api/settings/") return { body: SETTINGS };
      if (url === "/api/policies/" && init?.method === "POST") {
        attempts += 1;
        if (attempts === 1)
          return {
            status: 400,
            body: { error: { code: "validation_error", message: "Invalid input.", fields: { title: ["A policy with this title already exists."] } } },
          };
        return { status: 201, body: { ...POLICY, id: 9, title: "Team chat" } };
      }
      if (url.startsWith("/api/policies/")) return page([]);
    }, HR);
    render(<Providers><PoliciesPage /></Providers>);

    expect(await screen.findByText("No policies yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New policy" }));
    const dialog = await screen.findByRole("dialog", { name: "New policy" });
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: "Team chat" } });
    fireEvent.change(within(dialog).getByLabelText(/^Category/), { target: { value: "COMMUNICATION" } });
    fireEvent.change(within(dialog).getByLabelText(/^Policy text/), { target: { value: "Reply within one working day." } });
    fireEvent.click(within(dialog).getByLabelText("Published"));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("A policy with this title already exists.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await screen.findByText("Policy published.");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New policy" })).toBeNull());

    const posts = calls.filter((c) => c.url === "/api/policies/" && c.init?.method === "POST");
    expect(posts).toHaveLength(2);
    expect(body(posts[1].init)).toEqual({
      title: "Team chat",
      category: "COMMUNICATION",
      body: "Reply within one working day.",
      effective_date: null,
      is_published: true,
    });
  });
});
