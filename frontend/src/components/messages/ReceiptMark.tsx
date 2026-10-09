import { Check, CheckCheck } from "@/components/ui/icons";
import type { GroupMember, MessageReceipt } from "@/lib/types";

/**
 * Nexvra's "seen" mark: the brand lime disc with the Nexvra "N" (Space Grotesk), sized like a
 * read tick. The official logo artwork has a baked-in black background for dark surfaces only, so
 * the mark uses the brand colour and letterform instead of shrinking that artwork.
 */
export function NexvraSeenMark({ size = 14 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.64) }}
      className="inline-flex shrink-0 items-center justify-center rounded-[50%] bg-primary-container font-display font-bold leading-none text-on-primary-fixed"
      aria-hidden="true"
    >
      N
    </span>
  );
}

function seenText(receipt: MessageReceipt, members: GroupMember[] | null) {
  if (!members) return receipt.status === "seen" ? "Seen" : receipt.status === "delivered" ? "Delivered" : "Sent";
  const names = receipt.seen_by.map((id) => members.find((m) => m.user_id === id)?.full_name).filter(Boolean);
  const base = `Seen by ${receipt.read_count} of ${receipt.recipient_count}`;
  return names.length ? `${base}: ${names.join(", ")}` : receipt.status === "delivered" ? `Delivered to everyone · ${base}` : `Sent · ${base}`;
}

/** Sent (one tick) → delivered (two ticks) → seen (Nexvra mark), on your own messages only. */
export function ReceiptMark({ receipt, members = null }: { receipt: MessageReceipt | null; members?: GroupMember[] | null }) {
  if (!receipt) return null;
  const label = seenText(receipt, members);
  const partial = members && receipt.status !== "seen" && receipt.read_count > 0;
  return (
    <span className="inline-flex items-center gap-1" title={label} data-testid="receipt" data-status={receipt.status}>
      {receipt.status === "seen" ? (
        <NexvraSeenMark />
      ) : receipt.status === "delivered" ? (
        <CheckCheck className="h-3.5 w-3.5 text-on-surface-variant" aria-hidden="true" />
      ) : (
        <Check className="h-3.5 w-3.5 text-on-surface-variant" aria-hidden="true" />
      )}
      {partial && <span className="text-[10px] text-on-surface-variant">{receipt.read_count}/{receipt.recipient_count}</span>}
      <span className="sr-only">{label}</span>
    </span>
  );
}
