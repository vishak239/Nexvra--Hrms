"use client";

import { Bell, CheckCheck } from "@/components/ui/icons";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DesktopAlertsControl, useNotificationCenter } from "@/components/layout/NotificationCenter";
import { NotificationIcon } from "@/components/notifications/NotificationIcon";
import { Card, PageHeader } from "@/components/ui/Display";
import { Tabs, useToast } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { addDaysISO, fmtDate, fmtTime, istDateKey, todayISO } from "@/lib/format";
import { tryApi, useResource } from "@/lib/hooks";
import { notificationLink as linkFor } from "@/lib/notifications";
import type { Notification, Paginated } from "@/lib/types";

/** Newest first, in India calendar days: "Today", "Yesterday", then the date. */
function groupByDay(items: Notification[]): [string, Notification[]][] {
  const today = todayISO();
  const yesterday = addDaysISO(today, -1);
  const groups = new Map<string, Notification[]>();
  for (const n of items) {
    const key = istDateKey(n.created_at);
    const label = key === today ? "Today" : key === yesterday ? "Yesterday" : fmtDate(key);
    groups.set(label, [...(groups.get(label) ?? []), n]);
  }
  return [...groups.entries()];
}

export default function NotificationsPage() {
  const toast = useToast();
  const center = useNotificationCenter();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useResource<Paginated<Notification>>("/api/notifications/", {
    is_read: filter === "unread" ? false : undefined,
    page,
    page_size: PAGE_SIZE,
  });

  async function markRead(n: Notification) {
    if (n.is_read) return;
    await tryApi(() => api(`/api/notifications/${n.id}/mark-read/`, { method: "POST" }));
    reload();
    center?.refresh();
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <DesktopAlertsControl />
            <Button
              variant="secondary"
              icon={<CheckCheck className="h-4 w-4" />}
              onClick={async () => {
                const r = await tryApi(() => api<{ updated: number }>("/api/notifications/mark-all-read/", { method: "POST" }));
                toast(r.ok ? "All notifications marked as read." : r.error.message, r.ok ? "success" : "error");
                reload();
                center?.refresh();
              }}
            >
              Mark all as read
            </Button>
          </div>
        }
      />
      <Tabs
        tabs={[
          { value: "all", label: "All" },
          { value: "unread", label: "Unread" },
        ]}
        value={filter}
        onChange={(v) => {
          setFilter(v);
          setPage(1);
        }}
      />
      <Card>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <SkeletonRows />
        ) : !data?.results.length ? (
          <EmptyState icon={<Bell className="h-5 w-5" />} title={filter === "unread" ? "No unread notifications" : "No notifications yet"} />
        ) : (
          <>
            {groupByDay(data.results).map(([day, items]) => (
              <section key={day} aria-label={day}>
                <h2 className="bg-surface-container-low px-5 py-2 font-label-sm text-label-sm uppercase text-on-surface-variant">{day}</h2>
                <ul className="divide-y divide-surface-container-high/40">
                  {items.map((n) => {
                    const href = linkFor(n);
                    const body = (
                      <div className="flex items-start gap-3">
                        <NotificationIcon type={n.type} />
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm ${n.is_read ? "text-on-surface" : "font-semibold text-primary"}`}>{n.title}</p>
                          {n.message && <p className="mt-0.5 text-sm text-on-surface-variant">{n.message}</p>}
                          <p className="mt-1 text-xs text-outline">{fmtTime(n.created_at)}</p>
                        </div>
                        {!n.is_read && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-container ring-2 ring-primary-container/30" aria-hidden="true" />
                        )}
                        {!n.is_read && <span className="sr-only">Unread</span>}
                      </div>
                    );
                    return (
                      <li key={n.id} className="px-5 py-4 hover:bg-surface-container" data-testid="notification-row" data-unread={!n.is_read}>
                        {href ? (
                          <Link href={href} onClick={() => void markRead(n)} className="block">
                            {body}
                          </Link>
                        ) : (
                          <button onClick={() => void markRead(n)} className="block w-full text-left">
                            {body}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
