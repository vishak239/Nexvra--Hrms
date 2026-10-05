"use client";

/**
 * Keeps the unread counts fresh and raises alerts for new notifications and messages:
 * a desktop popup when the tab is in the background or the window is minimised (with the
 * user's permission), an in-app toast when the tab is in front. See lib/notifications.ts.
 */
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Bell } from "@/components/ui/icons";
import { useToast } from "@/components/ui/Overlay";
import { api } from "@/lib/api";
import {
  AlertLedger,
  desktopPermission,
  notificationLink,
  planAlerts,
  requestDesktopPermission,
  showDesktopAlert,
  type DesktopPermission,
} from "@/lib/notifications";
import type { NotificationUpdates } from "@/lib/types";

/** Checked every 30 s (browsers slow this down to about once a minute in background tabs). */
const POLL_MS = 30_000;

interface Counts {
  notifications: number;
  messages: number;
}

interface NotificationCenterValue extends Counts {
  permission: DesktopPermission;
  enableDesktopAlerts: () => Promise<DesktopPermission>;
  refresh: () => void;
}

const Ctx = createContext<NotificationCenterValue | null>(null);

export function useNotificationCenter() {
  return useContext(Ctx);
}

function foreground() {
  return document.visibilityState === "visible" && document.hasFocus();
}

export function NotificationCenterProvider({ userId, children }: { userId: number; children: ReactNode }) {
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [counts, setCounts] = useState<Counts>({ notifications: 0, messages: 0 });
  const [permission, setPermission] = useState<DesktopPermission>("unsupported");
  const since = useRef<string | null>(null);
  const busy = useRef(false);
  const ledger = useRef<AlertLedger | null>(null);
  const live = useRef({ pathname, toast, router });
  live.current = { pathname, toast, router };

  useEffect(() => {
    setPermission(desktopPermission());
    ledger.current = new AlertLedger(`nexvra.alerted.${userId}`);
  }, [userId]);

  const poll = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const params = since.current ? `?since=${encodeURIComponent(since.current)}` : "";
      const res = await api<NotificationUpdates>(`/api/notifications/updates/${params}`);
      since.current = res.server_time;
      setCounts({ notifications: res.unread_notifications, messages: res.unread_messages ?? 0 });
      if (!res.notifications.length || !ledger.current) return;
      const { pathname: path, toast: show, router: nav } = live.current;
      const plan = planAlerts(res.notifications, ledger.current, {
        foreground: foreground(),
        permission: desktopPermission(),
        onMessagesPage: path?.startsWith("/messages") ?? false,
      });
      for (const n of plan.toasts) show(n.title);
      for (const n of plan.popups) {
        const link = notificationLink(n) ?? "/notifications";
        showDesktopAlert(n.title, n.message, `nexvra-${n.id}`, () => nav.push(link));
      }
      if (plan.summary > 0) {
        showDesktopAlert("Nexvra HRMS", `${plan.summary} more new notification${plan.summary === 1 ? "" : "s"}.`, "nexvra-summary", () =>
          nav.push("/notifications"),
        );
      }
    } catch {
      // Offline or signed out: counts stay as they were; the next check tries again.
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [poll]);

  // Navigation (e.g. opening a conversation marks it read): refresh the badges.
  useEffect(() => {
    void poll();
  }, [pathname, poll]);

  const enableDesktopAlerts = useCallback(async () => {
    const result = await requestDesktopPermission();
    setPermission(result);
    if (result === "granted") toast("Desktop alerts are on for new notifications and messages.");
    else if (result === "denied") toast("Desktop alerts are blocked. Allow notifications for this site in the browser settings.", "error");
    return result;
  }, [toast]);

  return (
    <Ctx.Provider value={{ ...counts, permission, enableDesktopAlerts, refresh: () => void poll() }}>
      {children}
    </Ctx.Provider>
  );
}

/** Status and switch for desktop alerts (permission is the browser's; it can only be asked for). */
export function DesktopAlertsControl() {
  const center = useNotificationCenter();
  if (!center) return null;
  const { permission } = center;
  if (permission === "granted") {
    return (
      <span className="inline-flex items-center gap-2 text-body-sm text-primary-fixed" data-testid="desktop-alerts" data-permission="granted">
        <Bell className="h-4 w-4" /> Desktop alerts on
      </span>
    );
  }
  if (permission === "denied") {
    return (
      <span className="text-body-sm text-on-surface-variant" data-testid="desktop-alerts" data-permission="denied">
        Desktop alerts are blocked — allow notifications for this site in your browser settings.
      </span>
    );
  }
  if (permission === "unsupported") {
    return (
      <span className="text-body-sm text-on-surface-variant" data-testid="desktop-alerts" data-permission="unsupported">
        This browser cannot show desktop alerts.
      </span>
    );
  }
  return (
    <Button variant="secondary" icon={<Bell className="h-4 w-4" />} onClick={() => void center.enableDesktopAlerts()} data-testid="desktop-alerts" data-permission="default">
      Enable desktop alerts
    </Button>
  );
}
