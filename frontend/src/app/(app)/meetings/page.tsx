"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, PageHeader, StatusBadge } from "@/components/ui/Display";
import { SearchInput, SelectField, TextAreaField, TextField } from "@/components/ui/Field";
import { Groups, Pencil, Play, Plus, Square, X } from "@/components/ui/icons";
import { ConfirmDialog, Modal, Tabs, useToast } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, FormError, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { useAction, useResource } from "@/lib/hooks";
import type { Employee, EmployeeRef, Meeting, MeetingKind, Paginated } from "@/lib/types";
import { fmtDuration } from "@/lib/worksession";

type Tab = "upcoming" | "history";

const KIND_LABEL: Record<MeetingKind, string> = {
  OVERALL: "Overall meeting",
  SELECTED: "Selected employees",
};

function duration(m: Meeting) {
  if (!m.started_at || !m.ended_at) return "—";
  return fmtDuration((Date.parse(m.ended_at) - Date.parse(m.started_at)) / 1000);
}

function who(m: Meeting) {
  return m.kind === "OVERALL" ? "Everyone" : `${m.participant_count} ${m.participant_count === 1 ? "person" : "people"}`;
}

/** "2026-10-05T10:30" for <input type="datetime-local"> in the user's time zone. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

function ParticipantPicker({ selected, onChange }: { selected: EmployeeRef[]; onChange: (people: EmployeeRef[]) => void }) {
  const [search, setSearch] = useState("");
  const people = useResource<Paginated<Employee>>("/api/employees/", { search, page_size: 50, employment_status: "ACTIVE" });
  const chosen = new Set(selected.map((p) => p.id));
  return (
    <div className="space-y-2">
      <p className="font-label-sm text-label-sm uppercase text-on-surface-variant">Participants</p>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Selected participants">
          {selected.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2.5 py-1 text-body-sm text-on-surface">
              {p.full_name}
              <button type="button" aria-label={`Remove ${p.full_name}`} className="text-on-surface-variant hover:text-on-surface" onClick={() => onChange(selected.filter((s) => s.id !== p.id))}>
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <SearchInput label="Find employees" value={search} onChange={(e) => setSearch(e.target.value)} />
      <ul className="max-h-56 divide-y divide-surface-container-high/40 overflow-y-auto rounded-lg border border-surface-container-high" aria-label="Employees">
        {people.loading && !people.data ? (
          <li className="px-3 py-2 text-body-sm text-on-surface-variant">Loading…</li>
        ) : !people.data?.results.length ? (
          <li className="px-3 py-2 text-body-sm text-on-surface-variant">No employees found.</li>
        ) : (
          people.data.results.map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-body-md hover:bg-surface-container">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary-container"
                  checked={chosen.has(p.id)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...selected, { id: p.id, employee_code: p.employee_code, full_name: p.full_name }] : selected.filter((s) => s.id !== p.id))
                  }
                />
                <span className="min-w-0 flex-1 truncate text-on-surface">{p.full_name}</span>
                <span className="text-body-sm text-on-surface-variant">{p.employee_code}</span>
              </label>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function MeetingModal({ open, meeting, onClose, onSaved }: { open: boolean; meeting: Meeting | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { run, pending, error, setError } = useAction();
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [kind, setKind] = useState<MeetingKind>("OVERALL");
  const [people, setPeople] = useState<EmployeeRef[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setTitle(meeting?.title ?? "");
    setAgenda(meeting?.agenda ?? "");
    setKind(meeting?.kind ?? "OVERALL");
    setPeople(meeting?.participants ?? []);
    setStart(toLocalInput(meeting?.scheduled_start ?? null));
    setEnd(toLocalInput(meeting?.scheduled_end ?? null));
  }, [open, meeting, setError]);

  const running = meeting?.status === "ACTIVE";
  const valid = title.trim().length >= 3 && (kind === "OVERALL" || people.length > 0);
  const f = error?.fields ?? {};

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || pending) return;
    const body: Record<string, unknown> = { title, agenda, scheduled_end: fromLocalInput(end) };
    if (!running) body.scheduled_start = fromLocalInput(start);
    if (!meeting) body.kind = kind;
    if (kind === "SELECTED") body.participant_ids = people.map((p) => p.id);
    const ok = await run(() =>
      meeting ? api(`/api/attendance/meetings/${meeting.id}/`, { method: "PATCH", body }) : api("/api/attendance/meetings/", { body }),
    );
    if (ok) {
      toast(meeting ? "Meeting updated." : "Meeting scheduled.");
      onSaved();
    }
  }

  return (
    <Modal
      open={open}
      title={meeting ? "Edit meeting" : "New meeting"}
      description="While a meeting runs, the working time of everyone it includes is paused and recorded as meeting time. Nobody is checked out for inactivity and nobody needs to check in again afterwards."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="meeting-form" loading={pending} disabled={!valid}>
            {meeting ? "Save changes" : "Schedule meeting"}
          </Button>
        </>
      }
    >
      <form id="meeting-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError error={error && !Object.keys(f).length ? error : undefined} />
        <TextField label="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} error={f.title} maxLength={200} required />
        <TextAreaField label="Description / agenda" hint="Optional." value={agenda} onChange={(e) => setAgenda(e.target.value)} error={f.agenda} maxLength={5000} />
        <SelectField label="Meeting type" value={kind} onChange={(e) => setKind(e.target.value as MeetingKind)} disabled={!!meeting} error={f.kind}>
          <option value="OVERALL">Overall meeting — everyone</option>
          <option value="SELECTED">Selected employee meeting — only the participants</option>
        </SelectField>
        {kind === "SELECTED" && (
          <>
            <ParticipantPicker selected={people} onChange={setPeople} />
            {f.participant_ids && <p className="text-body-sm text-error">{f.participant_ids.join(" ")}</p>}
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Planned start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} disabled={running} hint="Optional. You start it with Start." error={f.scheduled_start} />
          <TextField label="Planned end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} hint="Optional. A running meeting ends by itself then." error={f.scheduled_end} />
        </div>
      </form>
    </Modal>
  );
}

function ActiveMeeting({ meeting, manage, onEnd }: { meeting: Meeting; manage: boolean; onEnd: () => void }) {
  return (
    <Card className="mb-space-lg">
      <div className="flex flex-wrap items-start justify-between gap-4 p-space-lg" data-testid="active-meeting">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="amber">Active</Badge>
            <Badge tone="neutral">{KIND_LABEL[meeting.kind]}</Badge>
          </div>
          <h2 className="font-headline-sm text-headline-sm text-primary">{meeting.title}</h2>
          <p className="text-body-md text-on-surface-variant">
            Started {fmtDateTime(meeting.started_at)}
            {meeting.started_by_name ? ` by ${meeting.started_by_name}` : ""} · {who(meeting)} · working time paused
            {meeting.scheduled_end ? ` · ends ${fmtDateTime(meeting.scheduled_end)}` : ""}
          </p>
          {meeting.agenda && <p className="whitespace-pre-wrap text-body-md text-on-surface">{meeting.agenda}</p>}
          {meeting.kind === "SELECTED" && (
            <p className="text-body-sm text-on-surface-variant">{meeting.participants.map((p) => p.full_name).join(", ")}</p>
          )}
        </div>
        {manage && (
          <Button variant="primary" icon={<Square className="h-4 w-4" />} onClick={onEnd}>
            End meeting
          </Button>
        )}
      </div>
    </Card>
  );
}

export default function MeetingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can("meetings.manage");
  const [tab, setTab] = useState<Tab>("upcoming");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Meeting | "new" | null>(null);
  const [confirm, setConfirm] = useState<{ action: "start" | "end" | "cancel"; meeting: Meeting } | null>(null);
  const action = useAction();

  const active = useResource<Paginated<Meeting>>("/api/attendance/meetings/", { status: "ACTIVE", page_size: 10 });
  const list = useResource<Paginated<Meeting>>("/api/attendance/meetings/", {
    status: tab === "upcoming" ? "SCHEDULED" : undefined,
    history: tab === "history" ? true : undefined,
    page,
    page_size: PAGE_SIZE,
    ordering: tab === "upcoming" ? "scheduled_start" : "-created_at",
  });
  const rows = list.data?.results ?? [];

  const reload = () => {
    active.reload();
    list.reload();
  };

  async function perform() {
    if (!confirm) return;
    const { action: verb, meeting } = confirm;
    const ok = await action.run(() => api(`/api/attendance/meetings/${meeting.id}/${verb}/`, { method: "POST" }));
    if (ok) {
      toast(verb === "start" ? "Meeting started — working time paused." : verb === "end" ? "Meeting ended — working time continues." : "Meeting cancelled.");
      setConfirm(null);
      reload();
    }
  }

  const confirmText = confirm && {
    start: {
      title: "Start this meeting?",
      message: `${confirm.meeting.kind === "OVERALL" ? "Everyone's" : "The participants'"} working time pauses now and is recorded as meeting time. Breaks in progress end now.`,
      label: "Start meeting",
    },
    end: { title: "End this meeting?", message: "Working time continues automatically for everyone it included.", label: "End meeting" },
    cancel: { title: "Cancel this meeting?", message: "It will not start. The people it included are told.", label: "Cancel meeting" },
  }[confirm.action];

  return (
    <>
      <PageHeader
        title="Meetings"
        description={manage ? "Schedule and run meetings. Working time is paused for everyone a running meeting includes." : "Company meetings that include you. Your working time is paused while they run."}
        actions={
          manage && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
              New meeting
            </Button>
          )
        }
      />

      {(active.data?.results ?? []).map((m) => (
        <ActiveMeeting key={m.id} meeting={m} manage={manage} onEnd={() => setConfirm({ action: "end", meeting: m })} />
      ))}

      <Tabs
        tabs={[
          { value: "upcoming", label: "Scheduled" },
          { value: "history", label: "History" },
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v);
          setPage(1);
        }}
      />
      <Card>
        <CardHeader title={tab === "upcoming" ? "Scheduled meetings" : "Meeting history"} />
        {list.error ? (
          <ErrorState error={list.error} onRetry={list.reload} />
        ) : list.loading && !list.data ? (
          <SkeletonRows />
        ) : !rows.length ? (
          <EmptyState icon={<Groups className="h-5 w-5" />} title={tab === "upcoming" ? "No scheduled meetings" : "No past meetings"} />
        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>Meeting</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th>{tab === "upcoming" ? "Planned" : "Started"}</Th>
                  {tab === "history" && <Th>Duration</Th>}
                  <Th>Includes</Th>
                  {manage && tab === "upcoming" && <Th className="text-right">Actions</Th>}
                </tr>
              </THead>
              <TBody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <Td>
                      <p className="font-medium text-primary">{m.title}</p>
                      {m.created_by_name && <p className="text-body-sm text-on-surface-variant">by {m.created_by_name}</p>}
                    </Td>
                    <Td>{KIND_LABEL[m.kind]}</Td>
                    <Td>
                      <StatusBadge status={m.status} />
                    </Td>
                    <Td>{fmtDateTime(tab === "upcoming" ? m.scheduled_start : m.started_at)}</Td>
                    {tab === "history" && <Td>{duration(m)}</Td>}
                    <Td>{who(m)}</Td>
                    {manage && tab === "upcoming" && (
                      <Td className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" icon={<Play className="h-4 w-4" />} onClick={() => setConfirm({ action: "start", meeting: m })}>
                            Start
                          </Button>
                          <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(m)} aria-label={`Edit ${m.title}`}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm({ action: "cancel", meeting: m })}>
                            Cancel
                          </Button>
                        </div>
                      </Td>
                    )}
                  </tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} count={list.data?.count ?? 0} onPage={setPage} />
          </>
        )}
      </Card>

      <MeetingModal
        open={editing !== null}
        meeting={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirmText?.title ?? ""}
        message={
          <>
            {confirmText?.message}
            {action.error && <p className="mt-2 text-error">{action.error.message}</p>}
          </>
        }
        confirmLabel={confirmText?.label}
        danger={confirm?.action === "cancel"}
        pending={action.pending}
        onConfirm={() => void perform()}
        onClose={() => {
          setConfirm(null);
          action.setError(undefined);
        }}
      />
    </>
  );
}
