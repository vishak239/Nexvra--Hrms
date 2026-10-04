// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { ActivityTracker } from "./activity";
import { checkInVerdict, haversineM } from "./geo";

let clock = 0;
const tracker = () => {
  clock = 1_000_000;
  return new ActivityTracker(() => clock);
};

afterEach(() => {
  clock = 0;
});

describe("activity tracker (privacy-safe)", () => {
  it("counts clicks, keys, scrolling and returning to the tab - only as a time", () => {
    const t = tracker();
    t.start();
    clock += 10 * 60_000;
    expect(t.idleSeconds()).toBe(600);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "s" }));
    expect(t.idleSeconds()).toBe(0);
    // nothing about the event is kept, only the timestamp
    expect(Object.keys(t).filter((k) => /key|text|target|event/i.test(k))).toEqual([]);
    clock += 60_000;
    window.dispatchEvent(new Event("scroll"));
    expect(t.lastActivity).toBe(clock);
    t.stop();
  });

  it("ignores small pointer jitter but counts deliberate movement", () => {
    const t = tracker();
    t.start();
    const start = t.lastActivity;
    clock += 6_000;
    for (const x of [100, 102, 101, 103]) window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: 100 }));
    expect(t.lastActivity).toBe(start);
    for (const x of [120, 160, 200]) window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: 100 }));
    expect(t.lastActivity).toBe(clock);
    t.stop();
  });

  it("stops listening when stopped", () => {
    const t = tracker();
    t.start();
    t.stop();
    clock += 5 * 60_000;
    window.dispatchEvent(new Event("pointerdown"));
    expect(t.idleSeconds()).toBe(300);
  });
});

describe("geofence display rule (the server decides)", () => {
  const workplace = { configured: true, latitude: 12.9716, longitude: 77.5946, radius_m: 20, max_accuracy_m: 100 };
  const north = (m: number) => 12.9716 + (m / 6_371_008.8) * (180 / Math.PI);

  it("matches the server formula", () => {
    expect(haversineM(12.9716, 77.5946, north(37), 77.5946)).toBeCloseTo(37, 6);
  });

  it.each([
    [5, "inside"],
    [19, "inside"],
    [21, "outside"],
    [100, "outside"],
  ])("%s m from the workplace is %s", (m, kind) => {
    expect(checkInVerdict(workplace, { latitude: north(m), longitude: 77.5946, accuracy: 8, at: 0 }).kind).toBe(kind);
  });

  it("needs a reading, a precise one, and a configured workplace", () => {
    expect(checkInVerdict(workplace, null).kind).toBe("unknown");
    expect(checkInVerdict(workplace, { latitude: north(1), longitude: 77.5946, accuracy: 500, at: 0 }).kind).toBe("imprecise");
    expect(checkInVerdict({ ...workplace, configured: false, latitude: null, longitude: null }, null).kind).toBe("not-required");
  });
});
