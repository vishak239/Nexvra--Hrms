// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Providers, mockFetch } from "@/test/utils";
import { AssignTaskModal, lookupParams } from "./AssignTaskModal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FOUND = {
  looked_up_by: "employee_code",
  employee: { id: 4, employee_code: "EMP-1024", full_name: "Vishak V", username: "vishak", department: "Engineering", designation: "Engineer", is_self: false },
};

describe("lookupParams", () => {
  it("sends exactly one identifier", () => {
    expect(lookupParams("employee_code", " EMP-1024 ")).toEqual({ employee_code: "EMP-1024" });
    expect(lookupParams("username", "@vishak")).toEqual({ username: "vishak" });
  });
});

describe("AssignTaskModal", () => {
  it("finds the employee by Employee ID, confirms, and assigns", async () => {
    const onCreated = vi.fn();
    const { calls } = mockFetch((url) => {
      if (url.startsWith("/api/tasks/lookup/")) return { body: FOUND };
      if (url === "/api/tasks/") return { status: 201, body: { id: 77 } };
    });
    render(
      <Providers>
        <AssignTaskModal open onClose={() => undefined} onCreated={onCreated} />
      </Providers>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: /Employee ID/ }), { target: { value: "EMP-1024" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    const confirmation = await screen.findByTestId("assignee-confirmation");
    expect(confirmation.textContent).toContain("Vishak V");
    expect(confirmation.textContent).toContain("@vishak");
    expect(calls.find((c) => c.url.startsWith("/api/tasks/lookup/"))?.url).toBe("/api/tasks/lookup/?employee_code=EMP-1024");

    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Update employee database" } });
    fireEvent.click(screen.getByRole("button", { name: "Assign task" }));
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 77 }));
    const sent = JSON.parse(String(calls.find((c) => c.url === "/api/tasks/")?.init?.body));
    expect(sent).toMatchObject({ employee_code: "EMP-1024", title: "Update employee database", requires_response: true });
    expect(sent.username).toBeUndefined();
  });

  it("looks up by username alone and shows server validation errors", async () => {
    const { calls } = mockFetch((url) => {
      if (url.startsWith("/api/tasks/lookup/"))
        return { status: 400, body: { error: { code: "validation_error", message: "No active employee found with this username.", fields: { username: ["No active employee found with this username."] } } } };
    });
    render(
      <Providers>
        <AssignTaskModal open onClose={() => undefined} onCreated={() => undefined} />
      </Providers>,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Username" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Username/ }), { target: { value: "@ghost" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(await screen.findByText("No active employee found with this username.")).toBeTruthy();
    expect(calls.find((c) => c.url.startsWith("/api/tasks/lookup/"))?.url).toBe("/api/tasks/lookup/?username=ghost");
    expect((screen.getByRole("button", { name: "Assign task" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
