"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader } from "@/components/ui/Display";
import { FilterSelect, TextAreaField } from "@/components/ui/Field";
import { Check, Home, MoreTime, RotateCcw, X } from "@/components/ui/icons";
import { Modal, useToast } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, FormError, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/format";
import { tryApi, useAction, useResource } from "@/lib/hooks";
import type { OvertimeSession, Paginated, ResumeStatus, ResumeWorkRequest, WfhStatus, WorkFromHomeRequest } from "@/lib/types";
import { OvertimeTable } from "./OvertimeTable";
import { useWorkSession } from "./WorkSessionProvider";

const WFH_TONE: Record<WfhStatus, "amber" | "green" | "red" | "neutral"> = {
  PENDING: "amber",
  APPROVED: "green",
  REJECTED: "red",
  CANCELLED: "neutral",
};

type Decision = { kind: "wfh" | "overtime" | "resume"; id: number; approve: boolean; who: string; when: string };

const DECISION: Record<Decision["kind"], { path: string; what: string }> = {
  wfh: { path: "/api/attendance/wfh", what: "work from home" },
  overtime: { path: "/api/attendance/overtime", what: "overtime" },
  resume: { path: "/api/attendance/resume-requests", what: "Resume Work" },
};

const RESUME_TONE: Record<ResumeStatus, "amber" | "green" | "red" | "neutral"> = {
  PENDING: "amber",
  APPROVED: "green",
  REJECTED: "red",
  USED: "neutral",
  CANCELLED: "neutral",
  EXPIRED: "neutral",
};

const RESUME_LABEL: Record<ResumeStatus, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  USED: "Checked in again",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

/** Approve / reject with an optional note (shown to the employee and kept in the audit log). */
function DecisionModal({ decision, onClose, onDone }: { decision: Decision | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const { run, pending, error } = useAction();
  const [note, setNote] = useState("");
  if (!decision) return null;
  const { path, what } = DECISION[decision.kind];
  const verb = decision.approve ? "Approve" : "Reject";
  return (
    <Modal
      open
      title={`${verb} ${what}`}
      description={`${decision.who} · ${decision.when}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={decision.approve ? "primary" : "danger"}
            loading={pending}
            onClick={async () => {
              const ok = await run(() =>
                api(`${path}/${decision.id}/${decision.approve ? "approve" : "reject"}/`, { body: { note } }),
              );
              if (ok) {
                toast(decision.approve ? "Approved — the employee has been notified." : "Rejected — the employee has been notified.");
                setNote("");
                onDone();
              }
            }}
          >
            {verb}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <FormError error={error} />
        <TextAreaField label="Note" hint="Optional. The employee sees it." value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
    </Modal>
  );
}

function StatusFilter({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <FilterSelect label="Status" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All statuses</option>
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </FilterSelect>
  );
}

export function WfhRequestsPanel() {
  const { me, can } = useAuth();
  const ws = useWorkSession();
  const toast = useToast();
  const approver = can("wfh.approve");
  const [status, setStatus] = useState(approver ? "PENDING" : "");
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<Decision | null>(null);
  const { data, error, loading, reload } = useResource<Paginated<WorkFromHomeRequest>>("/api/attendance/wfh/", {
    status,
    page,
    page_size: PAGE_SIZE,
    ordering: "-date",
  });
  const today = ws?.state?.date ?? "";

  return (
    <Card>
      <CardHeader
        title="Work from home"
        description={approver ? "Requests from employees. Approval lets them check in from home on that date." : "Your requests. HR approves or rejects them."}
        actions={
          <>
            <StatusFilter value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[["PENDING", "Pending"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"], ["CANCELLED", "Cancelled"]]} />
            {ws?.enabled && (
              <Button icon={<Home className="h-4 w-4" />} onClick={ws.openWfh}>
                Request work from home
              </Button>
            )}
          </>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState icon={<Home className="h-5 w-5" />} title="No work-from-home requests" description={status ? "Nothing with this status." : undefined} />
      ) : (
        <>
          <Table>
            <THead>
              <Th>Employee</Th>
              <Th>Date</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
              <Th>Decision</Th>
              <Th className="text-right">Actions</Th>
            </THead>
            <TBody>
              {data.results.map((r) => {
                const own = r.employee.id === me?.employee?.id;
                const cancellable = own && (r.status === "PENDING" || r.status === "APPROVED") && r.date >= today;
                return (
                  <tr key={r.id}>
                    <Td>
                      <span className="font-medium text-primary">{r.employee.full_name}</span>
                      <span className="ml-2 font-code-mono text-code-mono text-outline">{r.employee.employee_code}</span>
                    </Td>
                    <Td>{fmtDate(r.date)}</Td>
                    <Td className="max-w-sm whitespace-normal">
                      <p>{r.reason}</p>
                      {r.remarks && <p className="text-body-sm text-on-surface-variant">{r.remarks}</p>}
                    </Td>
                    <Td>
                      <Badge tone={WFH_TONE[r.status]}>{r.status === "PENDING" ? "Pending" : r.status[0] + r.status.slice(1).toLowerCase()}</Badge>
                    </Td>
                    <Td className="whitespace-normal text-body-sm text-on-surface-variant">
                      {r.decided_by_name ? `${r.decided_by_name}, ${fmtDateTime(r.decided_at)}` : "—"}
                      {r.decision_note && <p>{r.decision_note}</p>}
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {approver && !own && r.status === "PENDING" && (
                          <>
                            <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => setDecision({ kind: "wfh", id: r.id, approve: true, who: r.employee.full_name, when: fmtDate(r.date) })}>
                              Approve
                            </Button>
                            <Button size="sm" variant="danger" icon={<X className="h-4 w-4" />} onClick={() => setDecision({ kind: "wfh", id: r.id, approve: false, who: r.employee.full_name, when: fmtDate(r.date) })}>
                              Reject
                            </Button>
                          </>
                        )}
                        {cancellable && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={async () => {
                              const res = await tryApi(() => api(`/api/attendance/wfh/${r.id}/cancel/`, { method: "POST" }));
                              toast(res.ok ? "Request cancelled." : res.error.message, res.ok ? "success" : "error");
                              reload();
                              void ws?.load();
                            }}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
        </>
      )}
      <DecisionModal
        decision={decision}
        onClose={() => setDecision(null)}
        onDone={() => {
          setDecision(null);
          reload();
        }}
      />
    </Card>
  );
}

export function OvertimeRequestsPanel() {
  const { me, can } = useAuth();
  const approver = can("overtime.approve");
  const [status, setStatus] = useState(approver ? "REQUESTED" : "");
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<Decision | null>(null);
  const { data, error, loading, reload } = useResource<Paginated<OvertimeSession>>("/api/attendance/overtime/", {
    status,
    page,
    page_size: PAGE_SIZE,
  });

  return (
    <Card>
      <CardHeader
        title="Overtime"
        description={approver ? "Declared overtime work. Approve it before it can start." : "Your overtime requests and sessions."}
        actions={
          <StatusFilter
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={[["REQUESTED", "Awaiting approval"], ["APPROVED", "Approved"], ["ACTIVE", "Running"], ["COMPLETED", "Completed"], ["AUTO_STOPPED", "Stopped — no activity"], ["REJECTED", "Rejected"], ["CANCELLED", "Cancelled"]]}
          />
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState icon={<MoreTime className="h-5 w-5" />} title="No overtime" description={status ? "Nothing with this status." : undefined} />
      ) : (
        <>
          <OvertimeTable
            rows={data.results}
            showEmployee
            showDeclaration
            actions={
              approver
                ? (o) =>
                    o.status === "REQUESTED" && o.employee.id !== me?.employee?.id ? (
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => setDecision({ kind: "overtime", id: o.id, approve: true, who: o.employee.full_name, when: fmtDate(o.date) })}>
                          Approve
                        </Button>
                        <Button size="sm" variant="danger" icon={<X className="h-4 w-4" />} onClick={() => setDecision({ kind: "overtime", id: o.id, approve: false, who: o.employee.full_name, when: fmtDate(o.date) })}>
                          Reject
                        </Button>
                      </div>
                    ) : null
                : undefined
            }
          />
          <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
        </>
      )}
      <DecisionModal
        decision={decision}
        onClose={() => setDecision(null)}
        onDone={() => {
          setDecision(null);
          reload();
        }}
      />
    </Card>
  );
}

/** Resume Work requests after an automatic inactivity check-out (HR / Super Admin decide). */
export function ResumeRequestsPanel() {
  const { me, can } = useAuth();
  const toast = useToast();
  const approver = can("resume.approve");
  const [status, setStatus] = useState(approver ? "PENDING" : "");
  const [page, setPage] = useState(1);
  const [decision, setDecision] = useState<Decision | null>(null);
  const { data, error, loading, reload } = useResource<Paginated<ResumeWorkRequest>>("/api/attendance/resume-requests/", {
    status,
    page,
    page_size: PAGE_SIZE,
    ordering: "-created_at",
  });

  return (
    <Card>
      <CardHeader
        title="Resume Work"
        description={
          approver
            ? "Requests to continue working after an automatic check-out for inactivity. Approval lets the employee check in again (location / work-from-home rules still apply); the gap is recorded as non-working time."
            : "Your requests after an automatic check-out for inactivity."
        }
        actions={
          <StatusFilter
            value={status}
            onChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
            options={Object.entries(RESUME_LABEL)}
          />
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading && !data ? (
        <SkeletonRows />
      ) : !data?.results.length ? (
        <EmptyState icon={<RotateCcw className="h-5 w-5" />} title="No Resume Work requests" description={status ? "Nothing with this status." : undefined} />
      ) : (
        <>
          <Table>
            <THead>
              <Th>Employee</Th>
              <Th>Checked out</Th>
              <Th>Reason</Th>
              <Th>Status</Th>
              <Th>Decision</Th>
              <Th className="text-right">Actions</Th>
            </THead>
            <TBody>
              {data.results.map((r) => {
                const own = r.employee.id === me?.employee?.id;
                const when = `${fmtDate(r.date)} ${fmtTime(r.checked_out_at)}`;
                return (
                  <tr key={r.id}>
                    <Td>
                      <span className="font-medium text-primary">{r.employee.full_name}</span>
                      <span className="ml-2 font-code-mono text-code-mono text-outline">{r.employee.employee_code}</span>
                    </Td>
                    <Td>{when}</Td>
                    <Td className="max-w-sm whitespace-normal">{r.reason}</Td>
                    <Td>
                      <Badge tone={RESUME_TONE[r.status]}>{RESUME_LABEL[r.status]}</Badge>
                    </Td>
                    <Td className="whitespace-normal text-body-sm text-on-surface-variant">
                      {r.decided_by_name ? `${r.decided_by_name}, ${fmtDateTime(r.decided_at)}` : "—"}
                      {r.decision_note && <p>{r.decision_note}</p>}
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {approver && !own && r.status === "PENDING" && (
                          <>
                            <Button size="sm" icon={<Check className="h-4 w-4" />} onClick={() => setDecision({ kind: "resume", id: r.id, approve: true, who: r.employee.full_name, when })}>
                              Approve
                            </Button>
                            <Button size="sm" variant="danger" icon={<X className="h-4 w-4" />} onClick={() => setDecision({ kind: "resume", id: r.id, approve: false, who: r.employee.full_name, when })}>
                              Reject
                            </Button>
                          </>
                        )}
                        {own && (r.status === "PENDING" || r.status === "APPROVED") && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={async () => {
                              const res = await tryApi(() => api(`/api/attendance/resume-requests/${r.id}/cancel/`, { method: "POST" }));
                              toast(res.ok ? "Request cancelled." : res.error.message, res.ok ? "success" : "error");
                              reload();
                            }}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </TBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
        </>
      )}
      <DecisionModal
        decision={decision}
        onClose={() => setDecision(null)}
        onDone={() => {
          setDecision(null);
          reload();
        }}
      />
    </Card>
  );
}
