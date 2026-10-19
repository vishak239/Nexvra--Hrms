// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Providers, mockFetch } from "@/test/utils";
import LoginPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Login password visibility toggle", () => {
  it("hides the password by default and toggles visibility while preserving the value", async () => {
    mockFetch(() => ({ body: { authenticated: true, user: { id: 1 } } }));
    render(
      <Providers>
        <LoginPage />
      </Providers>,
    );

    const input = screen.getByLabelText(/^Password/) as HTMLInputElement;
    expect(input.getAttribute("type")).toBe("password");
    // The reveal button is present by its accessible label.
    screen.getByRole("button", { name: /Show password/ });

    fireEvent.change(input, { target: { value: "Secret123" } });
    expect(input.value).toBe("Secret123");

    fireEvent.click(screen.getByRole("button", { name: /Show password/ }));
    expect(input.getAttribute("type")).toBe("text");
    expect(input.value).toBe("Secret123");
    screen.getByRole("button", { name: /Hide password/ });

    fireEvent.click(screen.getByRole("button", { name: /Hide password/ }));
    expect(input.getAttribute("type")).toBe("password");
    expect(input.value).toBe("Secret123");
  });
});
