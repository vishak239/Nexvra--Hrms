import { Badge } from "@/components/ui/Display";
import { fmtDays } from "@/lib/format";
import type { MyBalance } from "@/lib/types";

/** One leave type's balance. `available` only drops when a request is approved. */
export function BalanceCard({ balance: b }: { balance: MyBalance }) {
  return (
    <div data-testid={`balance-${b.leave_type}`} className="rounded-lg bg-surface-container p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-primary">{b.leave_type_name}</p>
        {!b.is_paid && <Badge>Unpaid</Badge>}
      </div>
      {!b.tracks_balance ? (
        <p className="mt-2 text-sm text-on-surface-variant">No balance limit</p>
      ) : b.has_allocation ? (
        <>
          <p className="mt-2 text-2xl font-semibold text-primary">
            {fmtDays(b.available)}
            <span className="ml-1 text-sm font-normal text-on-surface-variant">/ {fmtDays(b.allocated)} days</span>
          </p>
          <p className="mt-1 text-xs text-on-surface-variant" data-testid={`balance-detail-${b.leave_type}`}>
            {fmtDays(b.used)} used · {fmtDays(b.pending)} pending approval
          </p>
          {Number(b.pending) > 0 && (
            <p className="mt-1 text-xs text-outline">Pending days are deducted only if approved.</p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-on-surface-variant">Not allocated for this year</p>
      )}
    </div>
  );
}
