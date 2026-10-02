"use client";

import { ListTodo, Plus } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AssignTaskModal } from "@/components/tasks/AssignTaskModal";
import { PRIORITIES, PriorityBadge, TaskStatusBadge, handleOf } from "@/components/tasks/TaskBadges";
import { TaskDetailModal } from "@/components/tasks/TaskDetailModal";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/Display";
import { FilterSelect, SearchInput } from "@/components/ui/Field";
import { Tabs } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, Loading, NoAccess, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime, humanize } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type { Paginated, Task } from "@/lib/types";

type Tab = "mine" | "team" | "all";
const STATUS_FILTERS = ["OPEN", "PENDING", "IN_PROGRESS", "OVERDUE", "COMPLETED", "CANCELLED"];

function TaskTable({ tab, onOpen, version }: { tab: Tab; onOpen: (id: number) => void; version: number }) {
  const [status, setStatus] = useState(tab === "mine" ? "OPEN" : "");
  const [priority, setPriority] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useResource<Paginated<Task>>("/api/tasks/", {
    mine: tab === "mine" ? true : tab === "team" ? false : undefined,
    status,
    priority,
    search,
    page,
    page_size: PAGE_SIZE,
    v: version,
  });
  const showAssignee = tab !== "mine";

  return (
    <Card>
      <CardHeader
        title={tab === "mine" ? "Tasks assigned to me" : tab === "team" ? "My team's tasks" : "All tasks"}
        actions={
          <>
            {showAssignee && <SearchInput label="Search tasks or people" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />}
            <FilterSelect label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              {STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {s === "OPEN" ? "Open (pending or in progress)" : humanize(s)}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Priority" value={priority} onChange={(e) => { setPriority(e.target.value); setPage(1); }}>
              <option value="">All priorities</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </FilterSelect>
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState icon={<ListTodo className="h-5 w-5" />} title="No tasks" description={tab === "mine" ? "Tasks HR assigns to you appear here." : "No tasks match these filters."} />
      ) : (
        <>
          <Table>
            <THead>
              <Th>Task</Th>
              {showAssignee && <Th>Assigned to</Th>}
              <Th>Priority</Th>
              <Th>Due</Th>
              <Th>Status</Th>
              <Th>Response</Th>
              <Th>Updated</Th>
            </THead>
            <TBody>
              {data.results.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => onOpen(t.id)}>
                  <Td className="max-w-xs whitespace-normal">
                    <button className="text-left font-medium text-zinc-900 hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(t.id); }}>
                      {t.title}
                    </button>
                    <p className="text-xs text-zinc-500">by {t.assigned_by ? handleOf(t.assigned_by) : "—"}</p>
                    {t.is_blocking && <Badge tone="amber">Response needed before checkout</Badge>}
                  </Td>
                  {showAssignee && (
                    <Td>
                      <span className="font-medium text-zinc-900">{t.assigned_to.full_name}</span>
                      <span className="ml-2 font-mono text-xs text-zinc-400">{t.assigned_to.employee_code}</span>
                    </Td>
                  )}
                  <Td>
                    <PriorityBadge priority={t.priority} />
                  </Td>
                  <Td>{fmtDate(t.due_date)}</Td>
                  <Td>
                    <TaskStatusBadge task={t} />
                  </Td>
                  <Td className="max-w-[16rem] truncate" title={t.response || undefined}>
                    {t.response ? t.response : <span className="text-zinc-400">—</span>}
                  </Td>
                  <Td>{fmtDateTime(t.updated_at)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
        </>
      )}
    </Card>
  );
}

function TasksContent() {
  const { me, can } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [assigning, setAssigning] = useState(false);
  const [version, setVersion] = useState(0);
  const manage = can("tasks.manage");
  const tabs = [
    ...(me?.employee ? [{ value: "mine" as Tab, label: "My tasks" }] : []),
    ...(can("tasks.view_team") && !can("tasks.view_all") ? [{ value: "team" as Tab, label: "Team tasks" }] : []),
    ...(can("tasks.view_all") ? [{ value: "all" as Tab, label: "All tasks" }] : []),
  ];
  const requested = params.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(tabs.find((t) => t.value === requested)?.value ?? (manage ? "all" : tabs[0]?.value) ?? "mine");
  const openTask = Number(params.get("task")) || null;

  function setTaskParam(id: number | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("task", String(id));
    else next.delete("task");
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  if (tabs.length === 0) return <NoAccess />;
  return (
    <>
      <PageHeader
        title="Tasks"
        description={manage ? "Assign work to employees and follow their responses." : "Tasks HR has assigned to you."}
        actions={
          manage && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAssigning(true)}>
              Assign task
            </Button>
          )
        }
      />
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} />}
      <TaskTable key={tab} tab={tab} onOpen={setTaskParam} version={version} />
      <AssignTaskModal
        open={assigning}
        onClose={() => setAssigning(false)}
        onCreated={(t) => {
          setAssigning(false);
          setVersion((v) => v + 1);
          setTaskParam(t.id);
        }}
      />
      <TaskDetailModal taskId={openTask} onClose={() => setTaskParam(null)} onChanged={() => setVersion((v) => v + 1)} />
    </>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<Loading />}>
      <TasksContent />
    </Suspense>
  );
}
