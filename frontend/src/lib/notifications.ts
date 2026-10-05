/**
 * Desktop (operating-system) alerts for new notifications and messages.
 *
 * Uses the browser Notifications API only: the user grants permission once (it cannot be
 * bypassed), and the alert appears even when the Nexvra tab is in the background or the window is
 * minimised. The operating system plays its default notification sound. When the tab is in front
 * and focused, an in-app toast is shown instead of a desktop popup.
 *
 * No spam: each item is alerted once (key = id + time, remembered per user across tabs and
 * reloads), at most MAX_POPUPS per check (more become one summary), alerts use a stable `tag` so
 * the OS replaces rather than stacks them, and message alerts are skipped while the Messages page
 * is in front. Alerts only ever contain the notification's title and short text (message alerts
 * never contain the message itself).
 */
import type { Notification as AppNotification } from "./types";

export type DesktopPermission = "granted" | "denied" | "default" | "unsupported";

export const MAX_POPUPS = 3;
const LEDGER_SIZE = 200;
const MESSAGE_TYPES = new Set(["MESSAGE_RECEIVED", "FILE_RECEIVED"]);

/** Where a notification takes the user (the server supplies `link` for most types). */
export function notificationLink(n: Pick<AppNotification, "type" | "link" | "entity_id">): string | null {
  if (n.type.startsWith("LEAVE_SUBMITTED")) return "/leave?tab=approvals";
  if (n.link) return n.link;
  if (n.type === "SYNC_STATUS") return "/attendance";
  if (n.type.startsWith("LEAVE_")) return "/leave";
  if (n.type === "PAYSLIP_PUBLISHED" && n.entity_id) return `/payslips/${n.entity_id}`;
  if (n.type === "DOCUMENT_SHARED") return "/documents";
  return null;
}

export function isMessageAlert(n: Pick<AppNotification, "type">) {
  return MESSAGE_TYPES.has(n.type);
}

function api(): typeof Notification | null {
  return typeof window !== "undefined" && typeof window.Notification === "function" ? window.Notification : null;
}

export function desktopPermission(): DesktopPermission {
  const N = api();
  if (!N) return "unsupported";
  return N.permission as DesktopPermission;
}

/** Ask once, from a user gesture (browsers ignore or penalise unprompted requests). */
export async function requestDesktopPermission(): Promise<DesktopPermission> {
  const N = api();
  if (!N) return "unsupported";
  if (N.permission !== "default") return N.permission as DesktopPermission;
  try {
    return (await N.requestPermission()) as DesktopPermission;
  } catch {
    return desktopPermission();
  }
}

/** A collapsed message alert is refreshed in place, so the key includes its time. */
export const alertKey = (n: Pick<AppNotification, "id" | "created_at">) => `${n.id}@${n.created_at}`;

/** Items already alerted, shared by all tabs of this browser (localStorage) and bounded in size. */
export class AlertLedger {
  private memory: string[] = [];

  constructor(private readonly storageKey: string) {}

  private read(): string[] {
    try {
      const raw = window.localStorage.getItem(this.storageKey);
      const parsed = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : this.memory;
    } catch {
      return this.memory;
    }
  }

  has(key: string) {
    return this.read().includes(key);
  }

  /** Records the key; returns false if another tab got there first. */
  claim(key: string) {
    const keys = this.read();
    if (keys.includes(key)) return false;
    const next = [...keys, key].slice(-LEDGER_SIZE);
    this.memory = next;
    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(next));
    } catch {
      // storage unavailable: this tab still remembers
    }
    return true;
  }
}

export interface AlertPlan {
  /** Shown as desktop popups (tab hidden / window not focused, permission granted). */
  popups: AppNotification[];
  /** A summary popup for the rest (count), or 0. */
  summary: number;
  /** Shown as in-app toasts (tab in front). */
  toasts: AppNotification[];
}

export function planAlerts(
  items: AppNotification[],
  ledger: AlertLedger,
  { foreground, permission, onMessagesPage }: { foreground: boolean; permission: DesktopPermission; onMessagesPage: boolean },
): AlertPlan {
  const fresh = items
    .filter((n) => !n.is_read)
    .filter((n) => !(foreground && onMessagesPage && isMessageAlert(n)))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .filter((n) => ledger.claim(alertKey(n)));
  if (foreground) return { popups: [], summary: 0, toasts: fresh.slice(-MAX_POPUPS) };
  if (permission !== "granted") return { popups: [], summary: 0, toasts: [] };
  const popups = fresh.slice(-MAX_POPUPS);
  return { popups, summary: fresh.length - popups.length, toasts: [] };
}

/** One desktop popup. Clicking it focuses the app and opens the item. */
export function showDesktopAlert(
  title: string,
  body: string,
  tag: string,
  onOpen: () => void,
): globalThis.Notification | null {
  const N = api();
  if (!N || N.permission !== "granted") return null;
  try {
    const popup = new N(title, { body, tag, silent: false, icon: "/brand/nexvra-logo.png" });
    popup.onclick = () => {
      window.focus();
      onOpen();
      popup.close();
    };
    return popup;
  } catch {
    return null; // e.g. some mobile browsers only allow alerts from a service worker
  }
}
