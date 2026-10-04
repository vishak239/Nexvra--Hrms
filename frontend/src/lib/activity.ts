/**
 * Privacy-safe activity detection for the inactivity rule.
 *
 * Only *when* the user last interacted is kept - never what they typed, which keys, page
 * contents, screenshots or anything else. Signals: clicks/taps, key presses (the key itself is
 * ignored), scrolling, wheel, deliberate pointer movement (small jitters do not count) and
 * returning to the tab. Optionally, the browser's Idle Detection API (Chrome / Edge, with the
 * user's permission) also counts activity in other applications on the device, still as a
 * plain active/idle state.
 *
 * Browsers pause or throttle background tabs and nothing runs while the browser is closed, so
 * this is never the only source of truth: the server keeps the last reported time and applies
 * the 30-minute rule itself.
 */

const MOVE_THRESHOLD_PX = 24; // cumulative pointer travel that counts as deliberate movement
const MOVE_COOLDOWN_MS = 5_000;

type Listener = (lastActivity: number) => void;

interface IdleDetectorLike {
  userState: "active" | "idle" | null;
  addEventListener(type: "change", cb: () => void): void;
  start(options: { threshold: number; signal?: AbortSignal }): Promise<void>;
}
type IdleDetectorCtor = {
  new (): IdleDetectorLike;
  requestPermission(): Promise<"granted" | "denied">;
};

function idleDetectorCtor(): IdleDetectorCtor | null {
  const ctor = (globalThis as unknown as { IdleDetector?: IdleDetectorCtor }).IdleDetector;
  return typeof ctor === "function" ? ctor : null;
}

export class ActivityTracker {
  lastActivity: number;
  systemIdleEnabled = false;
  private listeners = new Set<Listener>();
  private moved = 0;
  private lastMove: { x: number; y: number } | null = null;
  private lastMoveCounted = 0;
  private abort: AbortController | null = null;
  private idleAbort: AbortController | null = null;

  constructor(private readonly now: () => number = Date.now) {
    this.lastActivity = now();
  }

  /** Seconds since the last meaningful interaction. */
  idleSeconds() {
    return Math.max(0, Math.floor((this.now() - this.lastActivity) / 1000));
  }

  mark = () => {
    this.lastActivity = this.now();
    this.listeners.forEach((l) => l(this.lastActivity));
  };

  onActivity(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private onPointerMove = (e: PointerEvent) => {
    if (this.lastMove) this.moved += Math.hypot(e.clientX - this.lastMove.x, e.clientY - this.lastMove.y);
    this.lastMove = { x: e.clientX, y: e.clientY };
    const t = this.now();
    if (this.moved >= MOVE_THRESHOLD_PX && t - this.lastMoveCounted >= MOVE_COOLDOWN_MS) {
      this.moved = 0;
      this.lastMoveCounted = t;
      this.mark();
    }
  };

  private onVisibility = () => {
    if (document.visibilityState === "visible") this.mark();
  };

  start(target: Window = window) {
    if (this.abort) return;
    this.abort = new AbortController();
    const opts = { passive: true, capture: true, signal: this.abort.signal } as AddEventListenerOptions;
    for (const type of ["pointerdown", "keydown", "wheel", "scroll", "touchstart"]) {
      target.addEventListener(type, this.mark, opts);
    }
    target.addEventListener("pointermove", this.onPointerMove as EventListener, opts);
    target.document.addEventListener("visibilitychange", this.onVisibility, { signal: this.abort.signal });
  }

  stop() {
    this.abort?.abort();
    this.abort = null;
    this.idleAbort?.abort();
    this.idleAbort = null;
  }

  static systemIdleSupported() {
    return idleDetectorCtor() !== null;
  }

  /** Must be called from a user gesture (browser rule). Returns true when enabled. */
  async enableSystemIdleDetection(): Promise<boolean> {
    const Ctor = idleDetectorCtor();
    if (!Ctor) return false;
    try {
      if ((await Ctor.requestPermission()) !== "granted") return false;
      const detector = new Ctor();
      this.idleAbort?.abort();
      this.idleAbort = new AbortController();
      detector.addEventListener("change", () => {
        if (detector.userState === "active") this.mark();
      });
      await detector.start({ threshold: 60_000, signal: this.idleAbort.signal });
      // While the device reports "active", keep counting it once a minute.
      const timer = window.setInterval(() => detector.userState === "active" && this.mark(), 60_000);
      this.idleAbort.signal.addEventListener("abort", () => window.clearInterval(timer));
      this.systemIdleEnabled = true;
      return true;
    } catch {
      return false;
    }
  }
}
