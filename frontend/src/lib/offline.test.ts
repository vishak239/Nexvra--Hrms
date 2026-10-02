import { describe, expect, it, vi } from "vitest";
import { OfflineQueue, flushQueue, newEventId, retryDelay, type KeyValueStore, type SendBatch } from "./offline";
import type { SyncResult, WorkSessionState } from "./types";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const STATE = { date: "2026-10-02", server_time: "2026-10-02T12:00:00Z" } as WorkSessionState;

describe("OfflineQueue", () => {
  it("persists events per user and survives a new instance (browser reopened)", () => {
    const store = memoryStore();
    const q = new OfflineQueue(store, 7);
    q.enqueue("BREAK_START", "2026-10-02T12:00:00Z", "a");
    expect(new OfflineQueue(store, 7).list().map((e) => e.id)).toEqual(["a"]);
    expect(new OfflineQueue(store, 8).list()).toEqual([]); // another user's queue is separate
  });

  it("never queues the same event id twice", () => {
    const q = new OfflineQueue(memoryStore(), 1);
    q.enqueue("BREAK_START", "2026-10-02T12:00:00Z", "same");
    q.enqueue("BREAK_START", "2026-10-02T12:00:00Z", "same");
    expect(q.list()).toHaveLength(1);
  });

  it("falls back to memory when storage is unavailable", () => {
    const q = new OfflineQueue(null, 1);
    q.enqueue("BREAK_END", "2026-10-02T12:00:00Z", "x");
    expect(q.persistent).toBe(false);
    expect(q.list()).toHaveLength(1);
  });

  it("ignores corrupted storage", () => {
    const store = memoryStore();
    const q = new OfflineQueue(store, 1);
    store.setItem(q.key, "{not json");
    expect(q.list()).toEqual([]);
  });

  it("caches the last server state for offline display", () => {
    const q = new OfflineQueue(memoryStore(), 1);
    q.saveSnapshot(STATE, "2026-10-02T12:00:00Z");
    expect(q.loadSnapshot()).toEqual({ state: STATE, savedAt: "2026-10-02T12:00:00Z" });
  });

  it("generates RFC 4122 v4 ids", () => {
    expect(newEventId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("flushQueue (synchronisation)", () => {
  it("sends events oldest first and removes every event the server answered", async () => {
    const q = new OfflineQueue(memoryStore(), 1);
    q.enqueue("BREAK_END", "2026-10-02T12:20:00Z", "end");
    q.enqueue("BREAK_START", "2026-10-02T12:00:00Z", "start");
    const results: SyncResult[] = [
      { id: "start", type: "BREAK_START", status: "APPLIED", duplicate: false, error: "" },
      { id: "end", type: "BREAK_END", status: "CONFLICT", duplicate: false, error: "You are not on a break." },
    ];
    const send = vi.fn<SendBatch>(async () => ({ results, state: STATE }));
    const outcome = await flushQueue(q, send);
    expect(send.mock.calls[0][0].map((e) => e.id)).toEqual(["start", "end"]);
    expect(outcome).toMatchObject({ ok: true, sent: 2, applied: 1 });
    expect(outcome.failed.map((f) => f.id)).toEqual(["end"]); // reported, not retried forever
    expect(q.list()).toEqual([]);
    expect(q.loadSnapshot()?.state).toEqual(STATE);
  });

  it("keeps events queued when the network fails (retry later, no loss)", async () => {
    const q = new OfflineQueue(memoryStore(), 1);
    q.enqueue("OVERTIME_START", "2026-10-02T18:00:00Z", "ot");
    const outcome = await flushQueue(q, async () => {
      throw new Error("Could not reach the server.");
    });
    expect(outcome.ok).toBe(false);
    expect(q.list()).toMatchObject([{ id: "ot", attempts: 1, lastError: "Could not reach the server." }]);
  });

  it("does nothing for an empty queue", async () => {
    const send = vi.fn();
    expect(await flushQueue(new OfflineQueue(memoryStore(), 1), send)).toMatchObject({ ok: true, sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("backs off between retries", () => {
    expect([0, 1, 2, 3, 4, 9].map(retryDelay)).toEqual([5000, 15000, 30000, 60000, 120000, 120000]);
  });
});
