"use client";

import { Users } from "@/components/ui/icons";
import { useState } from "react";
import { RequirePermission } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Display";
import { Modal } from "@/components/ui/Overlay";
import { FilterSelect, SearchInput } from "@/components/ui/Field";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { fmtDateTime, humanize } from "@/lib/format";
import { api } from "@/lib/api";
import { useAction, useResource } from "@/lib/hooks";
import type { Paginated, SecurityEvent } from "@/lib/types";

type RiskFilter = "ALL" | "LOW" | "MEDIUM" | "HIGH";
type ReviewFilter = "ALL" | "OPEN" | "REVIEWED" | "DISMISSED" | "ESCALATED";

function SecurityContent() {
  const [risk, setRisk] = useState<RiskFilter>("ALL");
  const [review, setReview] = useState<ReviewFilter>("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openReview, setOpenReview] = useState<SecurityEvent | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"REVIEWED" | "DISMISSED" | "ESCALATED">("REVIEWED");
  const [resolutionNote, setResolutionNote] = useState("");

  const { run, pending, error: actionError } = useAction();

  const { data, error, loading, reload } = useResource<Paginated<SecurityEvent>>("/api/security/security-events/", {
    employee: undefined,
    risk_level: risk === "ALL" ? undefined : risk,
    review_status: review === "ALL" ? undefined : review,
    date_from: from || undefined,
    date_to: to || undefined,
    search: search || undefined,
    page,
    page_size: PAGE_SIZE,
    ordering: "-created_at",
  });

  const results = data?.results ?? [];

  async function saveReview() {
    if (!openReview) return;
    await run(() =>
      api(`/api/security/security-events/${openReview.id}/review/`, {
        method: "POST",
        body: { review_status: reviewStatus, resolution_note: resolutionNote },
      }),
    );
    if (!actionError) {
      setOpenReview(null);
      await reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Security events"
        description="Reviewable suspicious-login signals (new device/IP, rapid IP change, repeated failures). Signals are evidence for review, not automatic accusations."
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-surface-container-high/40 p-4 sm:flex-row sm:items-center sm:gap-4">
          <SearchInput label="Search employee, IP or signal" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          <FilterSelect label="Risk" aria-label="Risk level" value={risk} onChange={(e) => { setRisk(e.target.value as RiskFilter); setPage(1); }}>
            <option value="ALL">All</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </FilterSelect>
          <FilterSelect label="Review status" aria-label="Review status" value={review} onChange={(e) => { setReview(e.target.value as ReviewFilter); setPage(1); }}>
            <option value="ALL">All</option>
            <option value="OPEN">Open</option>
            <option value="REVIEWED">Reviewed</option>
            <option value="DISMISSED">Dismissed</option>
            <option value="ESCALATED">Escalated</option>
          </FilterSelect>
          <input type="date" aria-label="From" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="h-10 rounded-lg border border-surface-container-high px-2 text-sm" />
          <input type="date" aria-label="To" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="h-10 rounded-lg border border-surface-container-high px-2 text-sm" />
        </div>

        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <SkeletonRows />
        ) : !results.length ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title="No security events match" />        ) : (
          <>
            <Table>
              <THead>
                <tr>
                  <Th>When</Th>
                  <Th>Employee</Th>
                  <Th>Signal</Th>
                  <Th>Risk</Th>
                  <Th>IP address</Th>
                  <Th>Review</Th>
                  <Th></Th>
                </tr>
              </THead>
              <TBody>
                {results.map((event) => (
                  <tr key={event.id}>
                    <Td>{fmtDateTime(event.created_at)}</Td>
                    <Td>{event.employee?.full_name ?? event.actor_email ?? "—"}</Td>
                    <Td className="font-medium text-primary">{humanize(event.kind)}</Td>
                    <Td>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        event.risk_level === "HIGH"
                          ? "border-error bg-error-container/20 text-error"
                          : "border-surface-container-high bg-surface-container-low text-on-surface-variant"
                      }`}>{humanize(event.risk_level)}</span>
                    </Td>
                    <Td className="font-code-mono text-code-mono text-on-surface-variant">{event.ip_address ?? "—"}</Td>
                    <Td>{humanize(event.review_status)}</Td>
                    <Td>
                      <Button
                        size="sm"
                        onClick={() => { setOpenReview(event); setReviewStatus("REVIEWED"); setResolutionNote(""); }}
                        disabled={event.review_status !== "OPEN"}
                      >
                        {event.review_status === "OPEN" ? "Review" : "Reviewed"}
                      </Button>
                    </Td>
                  </tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal
        open={openReview !== null}
        onClose={() => setOpenReview(null)}
        title="Review security event"
        description={`${openReview?.employee?.full_name ?? openReview?.actor_email} — ${humanize(openReview?.kind ?? "")}`}
      >
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1.5 block font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">Outcome</label>
            <select
              value={reviewStatus}
              onChange={(e) => setReviewStatus(e.target.value as "REVIEWED" | "DISMISSED" | "ESCALATED")}
              className="block w-full rounded border bg-surface-container-lowest px-3 text-body-md text-on-surface focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container h-10"
            >
              <option value="REVIEWED">Reviewed</option>
              <option value="DISMISSED">Dismissed</option>
              <option value="ESCALATED">Escalated</option>
            </select>
          </div>
          <div>
            <label className="mb-1.5 block font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">Resolution note</label>
            <textarea
              value={resolutionNote}
              onChange={(e) => setResolutionNote(e.target.value)}
              rows={3}
              className="block w-full rounded border bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface focus:border-primary-container focus:outline-none focus:ring-1 focus:ring-primary-container"
            />
          </div>
          {actionError && <p className="text-body-sm text-error">{actionError.message}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-surface-container-high/40 px-6 py-4">
          <Button type="button" onClick={() => setOpenReview(null)}>Cancel</Button>
          <Button type="button" onClick={saveReview} disabled={pending} loading={pending}>
            Save review
          </Button>
        </div>
      </Modal>
    </>
  );
}

export default function SecurityPage() {
  return <RequirePermission perms={["audit.view"]}><SecurityContent /></RequirePermission>;
}
