"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Display";
import { Tabs, useToast } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { tryApi, useResource } from "@/lib/hooks";
import type { Notification, Paginated } from "@/lib/types";

/** Where a notification should take the user. */
function linkFor(n: Notification) {
  if (n.type.startsWith("LEAVE_SUBMITTED")) return "/leave?tab=approvals";
  if (n.type.startsWith("LEAVE_")) return "/leave";
  if (n.type === "PAYSLIP_PUBLISHED" && n.entity_id) return `/payslips/${n.entity_id}`;
  if (n.type === "DOCUMENT_SHARED") return "/documents";
  return null;
}

export default function NotificationsPage() {
  const toast = useToast();
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
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <Button
            variant="secondary"
            icon={<CheckCheck className="h-4 w-4" />}
            onClick={async () => {
              const r = await tryApi(() => api<{ updated: number }>("/api/notifications/mark-all-read/", { method: "POST" }));
              toast(r.ok ? "All notifications marked as read." : r.error.message, r.ok ? "success" : "error");
              reload();
            }}
          >
            Mark all as read
          </Button>
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
            <ul className="divide-y divide-zinc-100">
              {data.results.map((n) => {
                const href = linkFor(n);
                const body = (
                  <div className="flex items-start gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? "bg-transparent" : "bg-nexvra-lime ring-2 ring-[#cdf58a]"}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${n.is_read ? "text-zinc-700" : "font-semibold text-zinc-900"}`}>{n.title}</p>
                      {n.message && <p className="mt-0.5 text-sm text-zinc-500">{n.message}</p>}
                      <p className="mt-1 text-xs text-zinc-400">{fmtDateTime(n.created_at)}</p>
                    </div>
                    {!n.is_read && <span className="sr-only">Unread</span>}
                  </div>
                );
                return (
                  <li key={n.id} className="px-5 py-4 hover:bg-zinc-50">
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
            <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
