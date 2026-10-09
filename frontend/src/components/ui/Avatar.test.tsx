// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Avatar, photoUrl } from "./Avatar";
import { TimeField12 } from "./Field";

afterEach(cleanup);

describe("Avatar", () => {
  it("shows the photo once loaded, with initials while it loads", () => {
    const { container } = render(<Avatar name="Asha Rao" src="/api/employees/4/photo/?v=abc" />);
    const box = screen.getByTestId("avatar");
    expect(box.getAttribute("data-state")).toBe("loading");
    expect(box.textContent).toContain("AR"); // placeholder while loading
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/api/employees/4/photo/?v=abc");
    fireEvent.load(img);
    expect(box.getAttribute("data-state")).toBe("loaded");
    expect(box.textContent).toBe("");
  });

  it("falls back to clean initials when the photo cannot be loaded", () => {
    const { container } = render(<Avatar name="Asha Rao" src="/api/employees/4/photo/" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("avatar").textContent).toBe("AR");
  });

  it("shows initials when there is no photo", () => {
    const { container } = render(<Avatar name="Ravi" src={photoUrl(4, null, false)} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("avatar").getAttribute("data-state")).toBe("none");
  });

  it("builds versioned, permission-checked photo URLs", () => {
    expect(photoUrl(4, "a1b2")).toBe("/api/employees/4/photo/?v=a1b2");
    expect(photoUrl(4, null)).toBe("/api/employees/4/photo/");
    expect(photoUrl(null, "x")).toBeNull();
    expect(photoUrl(4, "x", false)).toBeNull();
  });
});

describe("TimeField12", () => {
  function Harness({ initial }: { initial: string }) {
    const [value, setValue] = useState(initial);
    return (
      <>
        <TimeField12 label="Check-in" value={value} onChange={setValue} />
        <output data-testid="value">{value}</output>
      </>
    );
  }

  it("shows a 24-hour value on a 12-hour clock and emits 24-hour values", () => {
    render(<Harness initial="18:05" />);
    const hour = screen.getByLabelText("Check-in hour") as HTMLSelectElement;
    const minute = screen.getByLabelText("Check-in minute") as HTMLSelectElement;
    const period = screen.getByLabelText("Check-in AM or PM") as HTMLSelectElement;
    expect([hour.value, minute.value, period.value]).toEqual(["6", "05", "PM"]);
    fireEvent.change(period, { target: { value: "AM" } });
    expect(screen.getByTestId("value").textContent).toBe("06:05");
    fireEvent.change(hour, { target: { value: "12" } });
    expect(screen.getByTestId("value").textContent).toBe("00:05"); // 12 AM = midnight
    fireEvent.change(period, { target: { value: "PM" } });
    expect(screen.getByTestId("value").textContent).toBe("12:05"); // 12 PM = noon
    fireEvent.change(hour, { target: { value: "" } });
    expect(screen.getByTestId("value").textContent).toBe("");
  });

  it("never offers a 13-23 hour", () => {
    render(<Harness initial="" />);
    const options = Array.from((screen.getByLabelText("Check-in hour") as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(["", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);
  });
});
