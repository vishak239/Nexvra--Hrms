// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionProvider } from "@/lib/connection";
import { mockFetch } from "@/test/utils";
import { ConnectionIndicator, OfflineBanner } from "./ConnectionIndicator";

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { value, configurable: true });
}

function renderIndicator() {
  return render(
    <ConnectionProvider userId={3}>
      <ConnectionIndicator />
      <OfflineBanner />
    </ConnectionProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  setOnline(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConnectionIndicator", () => {
  it("is quietly ONLINE by default", () => {
    mockFetch(() => undefined);
    renderIndicator();
    expect(screen.getByTestId("connection-status").dataset.status).toBe("ONLINE");
    expect(screen.queryByText(/Offline mode/)).toBeNull();
  });

  it("shows OFFLINE mode with the number of queued actions", () => {
    setOnline(false);
    window.localStorage.setItem(
      "nexvra.offline-queue.v1.3",
      JSON.stringify([{ id: "a", type: "BREAK_START", occurredAt: "2026-10-02T10:00:00Z", attempts: 0 }]),
    );
    mockFetch(() => undefined);
    renderIndicator();
    const pill = screen.getByTestId("connection-status");
    expect(pill.dataset.status).toBe("OFFLINE");
    expect(pill.getAttribute("aria-label")).toBe("Connection: Offline mode, 1 waiting to sync");
    expect(screen.getByRole("status").textContent).toContain("1 action(s) are saved on this device");
    fireEvent.click(pill);
    expect(screen.getByRole("dialog", { name: "Connection details" }).textContent).toContain("Break start");
  });

  it("syncs when back online and reports SYNC ERROR for refused events", async () => {
    setOnline(false);
    window.localStorage.setItem(
      "nexvra.offline-queue.v1.3",
      JSON.stringify([{ id: "a", type: "BREAK_END", occurredAt: "2026-10-02T10:00:00Z", attempts: 0 }]),
    );
    mockFetch((url) => {
      if (url === "/api/health/") return { body: {} };
      if (url === "/api/attendance/sync/")
        return { body: { results: [{ id: "a", type: "BREAK_END", status: "CONFLICT", duplicate: false, error: "You are not on a break." }], state: { server_time: "2026-10-02T10:00:00Z" } } };
    });
    renderIndicator();
    setOnline(true);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(screen.getByTestId("connection-status").dataset.status).toBe("SYNC_ERROR"), { timeout: 3000 });
    fireEvent.click(screen.getByTestId("connection-status"));
    expect(screen.getByText(/You are not on a break/)).toBeTruthy();
    expect(window.localStorage.getItem("nexvra.offline-queue.v1.3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByTestId("connection-status").dataset.status).toBe("SYNCED"); // briefly, then ONLINE
  });
});
