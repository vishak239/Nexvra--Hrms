// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Providers, mockFetch } from "@/test/utils";
import { TaskDetailModal } from "./TaskDetailModal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const BASE_TASK = {
  id: 112,
  title: "Review quarterly report",
  description: "Please review the Q3 numbers.",
  priority: "HIGH",
  start_date: null,
  due_date: null,
  status: "PENDING",
  display_status: "PENDING",
  is_overdue: false,
  requires_response: true,
  assigned_to: { id: 9, employee_code: "EMP-009", full_name: "Assigned Person", username: "assigned" },
  assigned_by: null,
  acknowledged_at: null,
  response: "",
  responded_at: null,
  completed_at: null,
  cancelled_at: null,
  cancel_reason: "",
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-01T09:00:00Z",
  is_blocking: false,
  is_assignee: true,
  can_manage: false,
};

function mockTask(body: unknown) {
  mockFetch((url) => {
    if (url === "/api/tasks/112/") return { body };
  });
}

describe("TaskDetailModal (regression: /tasks?task=112)", () => {
  it("renders a valid task and its assignee without crashing", async () => {
    mockTask(BASE_TASK);
    render(
      <Providers>
        <TaskDetailModal taskId={112} onClose={() => undefined} onChanged={() => undefined} />
      </Providers>,
    );
    await waitFor(() => expect(screen.getByText("Review quarterly report")).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByText("Assigned Person (EMP-009 · @assigned)")).toBeTruthy(),
    );
  });

  it("shows Unassigned instead of crashing when assigned_to is null (task 112 scenario)", async () => {
    mockTask({ ...BASE_TASK, assigned_to: null });
    render(
      <Providers>
        <TaskDetailModal taskId={112} onClose={() => undefined} onChanged={() => undefined} />
      </Providers>,
    );
    await waitFor(() => expect(screen.getByText("Review quarterly report")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("Unassigned")).toBeTruthy());
    expect(screen.queryByText(/Assigned Person/)).toBeNull();
  });

  it("shows an error state when the task API fails", async () => {
    mockFetch((url) => {
      if (url === "/api/tasks/112/") return { status: 404, body: { error: { code: "not_found", message: "Not found.", fields: {} } } };
    });
    render(
      <Providers>
        <TaskDetailModal taskId={112} onClose={() => undefined} onChanged={() => undefined} />
      </Providers>,
    );
    await waitFor(() => expect(screen.getByText(/not found/i)).toBeTruthy());
  });
});
