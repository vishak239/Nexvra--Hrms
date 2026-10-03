import { Lock } from "@/components/ui/icons";
import { Badge } from "@/components/ui/Display";
import type { LeaveRequest } from "@/lib/types";

/**
 * Approved leave is locked: the applicant cannot cancel it. The server enforces this
 * (POST .../cancel/ returns 409); the UI only mirrors the server's `can_cancel` flag.
 */
export function canCancelLeave(r: Pick<LeaveRequest, "can_cancel">) {
  return r.can_cancel === true;
}

export function LockedBadge({ request }: { request: Pick<LeaveRequest, "is_locked"> }) {
  if (!request.is_locked) return null;
  return (
    <span title="Approved leave is locked and cannot be cancelled. Contact HR if plans change.">
      <Badge tone="dark">
        <Lock className="mr-1 h-3 w-3" aria-hidden="true" /> Locked
      </Badge>
    </span>
  );
}
