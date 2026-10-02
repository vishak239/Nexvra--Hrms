/**
 * Offline queue for work-session events (break / overtime start & end).
 *
 * Events are persisted in localStorage per user, each with a client UUID, so:
 *  - they survive a reload or the browser being closed and reopened;
 *  - re-sending them is safe: the server applies each id at most once.
 * Nothing runs while the browser is fully closed; the queue is flushed on the next visit.
 * The last server state is cached too, so the work session can be shown while offline.
 */
import type { SyncEventType, SyncResult, WorkSessionState } from "./types";
import type { QueuedEvent } from "./worksession";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** localStorage when available (it can throw in private modes or when blocked). */
export function browserStore(): KeyValueStore | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const probe = "__nexvra_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function newEventId(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface Snapshot {
  state: WorkSessionState;
  savedAt: string;
}

export class OfflineQueue {
  private memory: QueuedEvent[] = [];
  private memorySnapshot: Snapshot | null = null;

  constructor(
    private readonly store: KeyValueStore | null,
    readonly userId: number,
  ) {}

  get key() {
    return `nexvra.offline-queue.v1.${this.userId}`;
  }

  get snapshotKey() {
    return `nexvra.work-session.v1.${this.userId}`;
  }

  get persistent() {
    return this.store !== null;
  }

  list(): QueuedEvent[] {
    if (!this.store) return [...this.memory];
    try {
      const raw = this.store.getItem(this.key);
      const parsed = raw ? (JSON.parse(raw) as QueuedEvent[]) : [];
      return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.id === "string" && typeof e.type === "string") : [];
    } catch {
      return [];
    }
  }

  private save(events: QueuedEvent[]) {
    if (!this.store) {
      this.memory = [...events];
      return;
    }
    try {
      if (events.length) this.store.setItem(this.key, JSON.stringify(events));
      else this.store.removeItem(this.key);
    } catch {
      this.memory = [...events];
    }
  }

  enqueue(type: SyncEventType, occurredAt: string, id: string = newEventId()): QueuedEvent {
    const existing = this.list();
    const found = existing.find((e) => e.id === id);
    if (found) return found; // same event never queued twice
    const event: QueuedEvent = { id, type, occurredAt, attempts: 0 };
    this.save([...existing, event]);
    return event;
  }

  remove(ids: string[]) {
    const drop = new Set(ids);
    this.save(this.list().filter((e) => !drop.has(e.id)));
  }

  markAttempt(ids: string[], error: string) {
    const touched = new Set(ids);
    this.save(this.list().map((e) => (touched.has(e.id) ? { ...e, attempts: e.attempts + 1, lastError: error } : e)));
  }

  saveSnapshot(state: WorkSessionState, savedAt = new Date().toISOString()) {
    const snapshot: Snapshot = { state, savedAt };
    if (!this.store) {
      this.memorySnapshot = snapshot;
      return;
    }
    try {
      this.store.setItem(this.snapshotKey, JSON.stringify(snapshot));
    } catch {
      this.memorySnapshot = snapshot;
    }
  }

  loadSnapshot(): Snapshot | null {
    if (!this.store) return this.memorySnapshot;
    try {
      const raw = this.store.getItem(this.snapshotKey);
      return raw ? (JSON.parse(raw) as Snapshot) : this.memorySnapshot;
    } catch {
      return this.memorySnapshot;
    }
  }
}

export const MAX_BATCH = 100;

export interface FlushOutcome {
  ok: boolean;
  sent: number;
  applied: number;
  /** Events the server refused (conflict / rejected). They are removed from the queue. */
  failed: SyncResult[];
  state?: WorkSessionState;
  error?: string;
}

export type SendBatch = (
  events: { id: string; type: SyncEventType; occurred_at: string }[],
) => Promise<{ results: SyncResult[]; state: WorkSessionState }>;

/**
 * Send queued events (oldest first) and remove every event the server answered for.
 * A network/server failure keeps them queued for the next retry. The server decides
 * conflicts; a refused event is reported, never silently retried forever.
 */
export async function flushQueue(queue: OfflineQueue, send: SendBatch): Promise<FlushOutcome> {
  const batch = queue
    .list()
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
    .slice(0, MAX_BATCH);
  if (!batch.length) return { ok: true, sent: 0, applied: 0, failed: [] };
  try {
    const { results, state } = await send(batch.map((e) => ({ id: e.id, type: e.type, occurred_at: e.occurredAt })));
    const answered = results.map((r) => r.id);
    queue.remove(answered);
    queue.saveSnapshot(state);
    return {
      ok: true,
      sent: batch.length,
      applied: results.filter((r) => r.status === "APPLIED").length,
      failed: results.filter((r) => r.status !== "APPLIED"),
      state,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Synchronisation failed.";
    queue.markAttempt(
      batch.map((b) => b.id),
      message,
    );
    return { ok: false, sent: batch.length, applied: 0, failed: [], error: message };
  }
}

/** Retry delays (ms) for failed synchronisation: 5s, 15s, 30s, 60s, then every 2 minutes. */
export function retryDelay(attempt: number) {
  const steps = [5_000, 15_000, 30_000, 60_000, 120_000];
  return steps[Math.min(Math.max(attempt, 0), steps.length - 1)];
}

/** Error codes that mean "we could not reach the server" (vs. the server refusing). */
export const UNREACHABLE_CODES = new Set(["network_error", "backend_unavailable", "backend_timeout"]);
