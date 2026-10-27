"use client";

import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, StatusBadge } from "@/components/ui/Display";
import { Modal } from "@/components/ui/Overlay";
import { ErrorState, Loading } from "@/components/ui/States";
import { useAuth } from "@/lib/auth";
import { useResource } from "@/lib/hooks";
import { fmtDate, fmtDays } from "@/lib/format";
import type { LeaveRequest } from "@/lib/types";

export function ViewLeaveModal({
  open,
  requestId,
  onClose,
  onDone,
}: {
  open: boolean;
  requestId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { me, can } = useAuth();
  const { data, error, loading, reload } = useResource<LeaveRequest>(
    open && requestId != null ? `/api/leaves/requests/${requestId}/` : null
  );

  return (
    <Modal
      open={open}
      size="lg"
      title="Leave request details"
      description="Original leave request and decision information."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Close
          </Button>
        </>
      }
    >
      {error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : loading || !data ? (
        <Loading />
      ) : (
        <Card className="space-y-4">
          <CardHeader title={data.leave_type_name} description={fmtDate(data.start_date)} />
          <div className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-xs text-on-surface-variant">Employee</p>
                <p className="font-medium text-primary">
                  {data.employee.full_name}{" "}
                  <span className="ml-1 font-code-mono text-code-mono text-outline">{data.employee.employee_code}</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-on-surface-variant">Type</p>
                <p className="font-medium">{data.leave_type_name}</p>
              </div>
              <div>
                <p className="text-xs text-on-surface-variant">Dates</p>
                <p className="font-medium">
                  {data.start_date === data.end_date
                    ? `${fmtDate(data.start_date)}${data.is_half_day ? ` (${data.half_day_period === "FIRST" ? "first" : "second"} half)` : ""}`
                    : `${fmtDate(data.start_date)} – ${fmtDate(data.end_date)}`}
                </p>
                <p className="text-xs text-on-surface-variant">{fmtDays(data.days)} day(s)</p>
              </div>
              <div>
                <p className="text-xs text-on-surface-variant">Status</p>
                <div className="flex gap-1.5">
                  <StatusBadge status={data.status} />
                  {data.is_locked && <Badge tone="dark">Locked</Badge>}
                </div>
              </div>
            </div>
            <div>
              <p className="text-xs text-on-surface-variant">Reason</p>
              <p className="whitespace-pre-line text-on-surface">{data.reason || "—"}</p>
            </div>
            {data.decided_by_name && (
              <div>
                <p className="text-xs text-on-surface-variant">Decision</p>
                <p className="font-medium">
                  {data.decided_by_name}{data.decision_note ? ` · ${data.decision_note}` : ""}
                </p>
                {data.decided_at && <p className="text-xs text-on-surface-variant">Decided {fmtDate(data.decided_at)}</p>}
              </div>
            )}
            {data.balance_deducted && (
              <div>
                <p className="text-xs text-on-surface-variant">Balance deducted</p>
                <p className="font-medium">{fmtDays(data.balance_deducted)} day(s)</p>
              </div>
            )}
            <div>
              <p className="text-xs text-on-surface-variant">Cancellable</p>
              <p className="font-medium">{data.can_cancel ? "Yes" : "No"}</p>
            </div>
            <div>
              <p className="text-xs text-on-surface-variant">Created</p>
              <p className="font-medium">{fmtDate(data.created_at)}</p>
            </div>
          </div>
          {can("leave.apply") && me?.employee && data.employee.id === me.employee.id && data.can_cancel && (
            <div className="border-t border-surface-container-high/40 pt-4 flex gap-2">
              <Button variant="danger" onClick={() => { onClose(); onDone(); }}>
                Cancel request
              </Button>
            </div>
          )}
        </Card>
      )}
    </Modal>
  );
}
