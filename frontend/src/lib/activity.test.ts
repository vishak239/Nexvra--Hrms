// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityTracker, POINT_SPACING_MS, lastSharedBeat, markSharedBeat } from "./activity";
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

describe("activity reports (offline-safe heartbeat)", () => {
  it("counts text input, wheel / touchpad and window focus as activity, never their content", () => {
    const t = tracker();
    t.start();
    for (const type of ["input", "wheel", "focus", "touchstart"]) {
      clock += 60_000;
      window.dispatchEvent(new Event(type));
      expect(t.lastActivity).toBe(clock);
    }
    t.stop();
  });

  it("keeps the moments of activity until the server acknowledges them", () => {
    const t = tracker();
    t.start();
    const start = clock;
    clock += 1_000;
    window.dispatchEvent(new Event("pointerdown"));
    clock += 5_000; // within the 30 s spacing: not a new moment, but still the last activity
    window.dispatchEvent(new Event("keydown"));
    clock += POINT_SPACING_MS;
    window.dispatchEvent(new Event("keydown"));
    clock += 10_000;
    const report = t.report();
    expect(report.activity).toEqual([45, 10]); // seconds ago, relative: the device clock is not trusted
    expect(report.idle_seconds).toBe(10);
    expect(report.observed_seconds).toBe(Math.floor((clock - start) / 1000));
    // A failed heartbeat keeps them; a successful one clears what it carried.
    expect(t.report().activity).toHaveLength(2);
    t.acknowledge(report.takenAt);
    expect(t.report().activity).toEqual([]);
    t.stop();
  });

  it("reports activity seen during a 40-minute network outage when the connection returns", () => {
    const t = tracker();
    t.start();
    for (let minute = 1; minute <= 40; minute++) {
      clock += 60_000;
      window.dispatchEvent(new Event("keydown"));
    }
    const report = t.report();
    expect(report.activity).toHaveLength(40);
    expect(Math.max(...report.activity)).toBe(39 * 60);
    expect(report.idle_seconds).toBe(0);
    t.stop();
  });

  it("starts a new observation window after a pause (e.g. a meeting)", () => {
    const t = tracker();
    t.start();
    clock += 60_000;
    window.dispatchEvent(new Event("keydown"));
    t.stop();
    clock += 60 * 60_000;
    window.dispatchEvent(new Event("keydown")); // not watching during the meeting
    t.start();
    const report = t.report();
    expect(report.activity).toEqual([]);
    expect(report.observed_seconds).toBe(0);
    expect(t.lastActivity).toBeNull();
    t.stop();
  });

  it("shares activity with the other open tabs", async () => {
    if (typeof BroadcastChannel !== "function") return; // shared through storage events instead
    const a = tracker();
    const b = new ActivityTracker(() => clock);
    a.start();
    b.start();
    clock += 60_000;
    window.dispatchEvent(new Event("keydown")); // both trackers listen to this window...
    const other = new BroadcastChannel("nexvra-activity");
    clock += 60_000;
    other.postMessage({ activity: clock }); // ...and another tab reports activity too
    await new Promise((r) => setTimeout(r, 30));
    expect(a.lastActivity).toBe(clock);
    expect(b.lastActivity).toBe(clock);
    other.close();
    a.stop();
    b.stop();
  });

  it("lets one tab send the heartbeat for all of them", () => {
    window.localStorage.clear();
    expect(lastSharedBeat()).toBe(0);
    markSharedBeat(123_456);
    expect(lastSharedBeat()).toBe(123_456);
  });

  it("restores device-wide detection after a reload only when it was allowed", async () => {
    window.localStorage.clear();
    const started: number[] = [];
    class FakeDetector {
      userState: "active" | "idle" | null = "active";
      static requestPermission = async () => "granted" as const;
      addEventListener() {}
      async start() {
        started.push(1);
      }
    }
    vi.stubGlobal("IdleDetector", FakeDetector);
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: { query: async () => ({ state: "granted" }) },
    });
    const t = tracker();
    t.start();
    expect(await t.resumeSystemIdleDetection()).toBe(false); // never turned on in this browser
    expect(await t.enableSystemIdleDetection()).toBe(true);
    t.stop();
    expect(t.systemIdleEnabled).toBe(false);
    const reloaded = new ActivityTracker(() => clock);
    reloaded.start();
    expect(await reloaded.resumeSystemIdleDetection()).toBe(true);
    expect(started).toHaveLength(2);
    reloaded.stop();
    vi.unstubAllGlobals();
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
