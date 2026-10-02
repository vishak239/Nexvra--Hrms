"use client";

import { ScrollText } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { RequirePermission } from "@/components/layout/AppShell";
import { Card, PageHeader } from "@/components/ui/Display";
import { SearchInput } from "@/components/ui/Field";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { fmtDateTime, humanize } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type { AuditLog, Paginated } from "@/lib/types";

function Json({ value }: { value: Record<string, unknown> }) {
  if (!value || Object.keys(value).length === 0) return <span className="text-zinc-400">—</span>;
  return <pre className="max-w-xl whitespace-pre-wrap break-all rounded-md bg-zinc-50 p-2 font-mono text-[11px] text-zinc-700">{JSON.stringify(value, null, 2)}</pre>;
}

function AuditContent() {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, error, loading, reload } = useResource<Paginated<AuditLog>>("/api/audit-logs/", {
    search: q,
    date_from: from,
    date_to: to,
    page,
    page_size: PAGE_SIZE,
  });

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sign-ins and important HR actions. Read-only." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-zinc-100 p-4 sm:flex-row sm:items-center">
          <SearchInput label="Search actor, action or entity" value={search} onChange={(e) => setSearch(e.target.value)} />
          <input type="date" aria-label="From" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-10 rounded-lg border border-zinc-300 px-2 text-sm" />
          <input type="date" aria-label="To" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-10 rounded-lg border border-zinc-300 px-2 text-sm" />
        </div>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <SkeletonRows />
        ) : !data?.results.length ? (
          <EmptyState icon={<ScrollText className="h-5 w-5" />} title="No audit entries match" />
        ) : (
          <>
            <Table>
              <THead>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>IP address</Th>
              </THead>
              <TBody>
                {data.results.map((log) => (
                  <Fragment key={log.id}>
                    <tr className="cursor-pointer hover:bg-zinc-50" onClick={() => setOpen(open === log.id ? null : log.id)} aria-expanded={open === log.id}>
                      <Td>{fmtDateTime(log.created_at)}</Td>
                      <Td>{log.actor_email || <span className="text-zinc-400">system / anonymous</span>}</Td>
                      <Td className="font-medium text-zinc-900">{humanize(log.action)}</Td>
                      <Td className="font-mono text-xs">
                        {log.entity_type ? `${log.entity_type} #${log.entity_id}` : "—"}
                      </Td>
                      <Td className="font-mono text-xs">{log.ip_address ?? "—"}</Td>
                    </tr>
                    {open === log.id && (
                      <tr className="bg-zinc-50/50">
                        <td colSpan={5} className="px-5 py-4">
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Changes</p>
                              <Json value={log.changes} />
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Details</p>
                              <Json value={log.metadata} />
                              <p className="mt-2 truncate text-xs text-zinc-400" title={log.user_agent}>
                                {log.user_agent}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

export default function AuditPage() {
  return (
    <RequirePermission perms={["audit.view"]}>
      <AuditContent />
    </RequirePermission>
  );
}
