// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { MyBalance } from "@/lib/types";
import { BalanceCard } from "./BalanceCard";
import { LockedBadge, canCancelLeave } from "./LeaveLock";

afterEach(cleanup);

describe("leave approval lock", () => {
  it("approved leave is locked and cannot be cancelled", () => {
    render(<LockedBadge request={{ is_locked: true }} />);
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(canCancelLeave({ can_cancel: false })).toBe(false);
  });

  it("pending leave shows no lock and can be cancelled", () => {
    const { container } = render(<LockedBadge request={{ is_locked: false }} />);
    expect(container.textContent).toBe("");
    expect(canCancelLeave({ can_cancel: true })).toBe(true);
  });
});

describe("leave balance display", () => {
  const base: MyBalance = {
    leave_type: 1, leave_type_name: "Annual", is_paid: true, allow_half_day: true, tracks_balance: true,
    has_allocation: true, allocated: "12.0", used: "0.0", pending: "3.0", available: "12.0", requestable: "9.0",
  };

  it("does not reduce the balance for pending days", () => {
    render(<BalanceCard balance={base} />);
    const card = screen.getByTestId("balance-1");
    expect(card.textContent).toContain("12/ 12 days");
    expect(card.textContent).toContain("0 used · 3 pending approval");
    expect(card.textContent).toContain("Pending days are deducted only if approved.");
  });

  it("shows the reduced balance after approval", () => {
    render(<BalanceCard balance={{ ...base, used: "3.0", pending: "0.0", available: "9.0", requestable: "9.0" }} />);
    const card = screen.getByTestId("balance-1");
    expect(card.textContent).toContain("9/ 12 days");
    expect(card.textContent).not.toContain("deducted only if approved");
  });

  it("handles untracked and unallocated types", () => {
    render(<BalanceCard balance={{ ...base, leave_type: 2, tracks_balance: false }} />);
    expect(screen.getByText("No balance limit")).toBeTruthy();
    render(<BalanceCard balance={{ ...base, leave_type: 3, has_allocation: false }} />);
    expect(screen.getByText("Not allocated for this year")).toBeTruthy();
  });
});
