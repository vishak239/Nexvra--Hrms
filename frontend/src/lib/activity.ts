/**
 * Privacy-safe activity detection for the inactivity rule.
 *
 * Only *when* the user interacted is kept - never what they typed, which keys, page contents,
 * screenshots or anything else. Signals: clicks/taps, key presses and text input (the key and the
 * text are ignored), scrolling (also inside scrollable panels), wheel / touchpad, deliberate
 * pointer movement (small jitters do not count), focusing or returning to the window. With the
 * browser's Idle Detection permission (Chrome / Edge) the whole device's plain active / idle state
 * counts too, so working in other applications is recognised.
 *
 * Why the old detector could check out people who were working:
 * - only the HRMS tab was watched, and the device-wide option was lost on every page reload and
 *   whenever the monitor restarted (e.g. starting or ending a break aborted it);
 * - the browser reported only "seconds since the last interaction" every two minutes, so activity
 *   during a network outage was never reported and the server's 30-minute rule fired anyway;
 * - every open tab ran its own copy and only saw its own events.
 *
 * Now: the tracker keeps the moments of real interaction (at most one per POINT_SPACING_MS) until
 * the server acknowledges them, so activity seen offline is reported when the connection returns;
 * open tabs share their activity; the device-wide signal is restored automatically after a reload
 * once the user has allowed it. The server still decides (it never trusts the device clock: only
 * "seconds ago" offsets are sent).
 */

const MOVE_THRESHOLD_PX = 24; // cumulative pointer travel that counts as deliberate movement
const MOVE_COOLDOWN_MS = 5_000;
/** Interaction moments kept for the server: at most one per 30 s (enough for a 30-minute rule). */
export const POINT_SPACING_MS = 30_000;
/** A day of offline activity at most. */
export const MAX_POINTS = 2_880;
/** How often other tabs are told about activity (they report it if they send the heartbeat). */
const SHARE_EVERY_MS = 5_000;
const CHANNEL = "nexvra-activity";
const SHARE_KEY = "nexvra.activity.shared";
const SYSTEM_IDLE_KEY = "nexvra.activity.system-idle";

const DOM_SIGNALS = ["pointerdown", "keydown", "input", "wheel", "scroll", "touchstart", "focus"] as const;

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

function readFlag(key: string) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean) {
  try {
    if (on) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    // storage unavailable: the preference is simply not remembered
  }
}

/** What the browser sends with a heartbeat (activity metadata only). */
export interface ActivityReport {
  idle_seconds: number;
  /** Seconds ago of each recorded interaction not yet acknowledged by the server. */
  activity: number[];
  /** How long this page has been watching. */
  observed_seconds: number;
  /** Local time the report was taken (used to acknowledge it). */
  takenAt: number;
}

export class ActivityTracker {
  /** Last real interaction seen by this page (ms), or null when none since it started watching. */
  lastActivity: number | null = null;
  /** When this page started watching (ms). */
  watchingSince: number;
  systemIdleEnabled = false;
  private points: number[] = [];
  private listeners = new Set<Listener>();
  private moved = 0;
  private lastMove: { x: number; y: number } | null = null;
  private lastMoveCounted = 0;
  private lastShared = 0;
  private abort: AbortController | null = null;
  private idleAbort: AbortController | null = null;
  private channel: BroadcastChannel | null = null;

  constructor(private readonly now: () => number = Date.now) {
    this.watchingSince = now();
  }

  /** Seconds since the last interaction (or since this page started watching). */
  idleSeconds() {
    return Math.max(0, Math.floor((this.now() - (this.lastActivity ?? this.watchingSince)) / 1000));
  }

  get watching() {
    return this.abort !== null;
  }

  /** Records an interaction now. `share` = tell the other open tabs. */
  mark = (share = true) => {
    const t = this.now();
    this.record(t);
    if (share && t - this.lastShared >= SHARE_EVERY_MS) {
      this.lastShared = t;
      this.share(t);
    }
  };

  private record(t: number) {
    if (this.lastActivity === null || t > this.lastActivity) this.lastActivity = t;
    const last = this.points[this.points.length - 1];
    if (last === undefined || t - last >= POINT_SPACING_MS) {
      this.points.push(t);
      if (this.points.length > MAX_POINTS) this.points.splice(0, this.points.length - MAX_POINTS);
    }
    this.listeners.forEach((l) => l(t));
  }

  onActivity(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A snapshot for the heartbeat. Pending moments stay until `acknowledge` (sent again on failure). */
  report(): ActivityReport {
    const t = this.now();
    return {
      idle_seconds: this.idleSeconds(),
      activity: this.points.filter((p) => p >= this.watchingSince && p <= t).map((p) => Math.max(0, Math.floor((t - p) / 1000))),
      observed_seconds: Math.max(0, Math.floor((t - this.watchingSince) / 1000)),
      takenAt: t,
    };
  }

  /** The server has these moments (a heartbeat up to `upTo` succeeded, here or in another tab). */
  acknowledge(upTo: number) {
    this.points = this.points.filter((p) => p > upTo);
  }

  pendingCount() {
    return this.points.length;
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

  private onShared = (t: unknown) => {
    // Another tab saw activity at local time t (same device clock).
    if (typeof t === "number" && Number.isFinite(t) && t <= this.now() + 1000 && t >= this.watchingSince) this.record(t);
  };

  private share(t: number) {
    try {
      if (this.channel) this.channel.postMessage({ activity: t });
      else window.localStorage.setItem(SHARE_KEY, String(t));
    } catch {
      // sharing is best effort
    }
  }

  /** Start watching (a new observation window). Listeners are passive and capture-phase. */
  start(target: Window = window) {
    if (this.abort) return;
    this.abort = new AbortController();
    this.watchingSince = this.now();
    this.lastActivity = null;
    this.points = [];
    const signal = this.abort.signal;
    const opts = { passive: true, capture: true, signal } as AddEventListenerOptions;
    const onSignal = () => this.mark();
    for (const type of DOM_SIGNALS) target.addEventListener(type, onSignal, opts);
    target.addEventListener("pointermove", this.onPointerMove as EventListener, opts);
    target.document.addEventListener("visibilitychange", this.onVisibility, { signal });
    if (typeof BroadcastChannel === "function") {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (e: MessageEvent<{ activity?: unknown }>) => this.onShared(e.data?.activity);
      signal.addEventListener("abort", () => {
        this.channel?.close();
        this.channel = null;
      });
    } else {
      target.addEventListener("storage", (e: StorageEvent) => e.key === SHARE_KEY && this.onShared(Number(e.newValue)), { signal });
    }
  }

  /** Stop watching this page (during meetings, after check-out). */
  stop() {
    this.abort?.abort();
    this.abort = null;
    this.idleAbort?.abort();
    this.idleAbort = null;
    this.systemIdleEnabled = false;
  }

  static systemIdleSupported() {
    return idleDetectorCtor() !== null;
  }

  /** True when the user turned on device-wide activity earlier in this browser. */
  static systemIdleWanted() {
    return readFlag(SYSTEM_IDLE_KEY);
  }

  private async startDetector(Ctor: IdleDetectorCtor) {
    const detector = new Ctor();
    this.idleAbort?.abort();
    const abort = new AbortController();
    this.idleAbort = abort;
    detector.addEventListener("change", () => {
      if (detector.userState === "active") this.mark();
    });
    await detector.start({ threshold: 60_000, signal: abort.signal });
    if (detector.userState === "active") this.mark();
    // While the device reports "active", count it regularly (also in a background tab).
    const timer = window.setInterval(() => detector.userState === "active" && this.mark(), POINT_SPACING_MS);
    abort.signal.addEventListener("abort", () => window.clearInterval(timer));
    this.systemIdleEnabled = true;
  }

  /** Must be called from a user gesture (browser rule). Returns true when enabled. */
  async enableSystemIdleDetection(): Promise<boolean> {
    const Ctor = idleDetectorCtor();
    if (!Ctor) return false;
    try {
      if ((await Ctor.requestPermission()) !== "granted") return false;
      await this.startDetector(Ctor);
      writeFlag(SYSTEM_IDLE_KEY, true);
      return true;
    } catch {
      return false;
    }
  }

  /** After a reload: restart device-wide detection without prompting when it is still allowed. */
  async resumeSystemIdleDetection(): Promise<boolean> {
    const Ctor = idleDetectorCtor();
    if (!Ctor || this.systemIdleEnabled || !this.abort || !readFlag(SYSTEM_IDLE_KEY)) return this.systemIdleEnabled;
    try {
      const status = await navigator.permissions?.query({ name: "idle-detection" as PermissionName });
      if (status?.state !== "granted") {
        if (status?.state === "denied") writeFlag(SYSTEM_IDLE_KEY, false);
        return false;
      }
      await this.startDetector(Ctor);
      return true;
    } catch {
      return false;
    }
  }
}

/** One tracker per page, shared by every component (survives React re-mounts and effects). */
let shared: ActivityTracker | null = null;
export function pageTracker() {
  if (!shared) shared = new ActivityTracker();
  return shared;
}

const BEAT_KEY = "nexvra.heartbeat.at";

/** When any tab of this browser last delivered a heartbeat (ms), so the others can skip theirs. */
export function lastSharedBeat(): number {
  try {
    const value = Number(window.localStorage.getItem(BEAT_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function markSharedBeat(at: number) {
  try {
    window.localStorage.setItem(BEAT_KEY, String(at));
  } catch {
    // without storage every tab simply sends its own heartbeat
  }
}
