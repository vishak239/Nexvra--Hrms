import { Badge } from "@/components/ui/Display";
import { fmtDays } from "@/lib/format";
import type { MyBalance } from "@/lib/types";

/** One leave type's balance. `available` only drops when a request is approved. */
export function BalanceCard({ balance: b }: { balance: MyBalance }) {
  return (
    <div data-testid={`balance-${b.leave_type}`} className="rounded-lg border border-zinc-100 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-zinc-900">{b.leave_type_name}</p>
        {!b.is_paid && <Badge>Unpaid</Badge>}
      </div>
      {!b.tracks_balance ? (
        <p className="mt-2 text-sm text-zinc-500">No balance limit</p>
      ) : b.has_allocation ? (
        <>
          <p className="mt-2 text-2xl font-semibold text-zinc-900">
            {fmtDays(b.available)}
            <span className="ml-1 text-sm font-normal text-zinc-500">/ {fmtDays(b.allocated)} days</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500" data-testid={`balance-detail-${b.leave_type}`}>
            {fmtDays(b.used)} used · {fmtDays(b.pending)} pending approval
          </p>
          {Number(b.pending) > 0 && (
            <p className="mt-1 text-xs text-zinc-400">Pending days are deducted only if approved.</p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-zinc-500">Not allocated for this year</p>
      )}
    </div>
  );
}
