"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, Card } from "@/components/ui/Display";
import { Pencil, Trash2 } from "@/components/ui/icons";
import { fmtDate } from "@/lib/format";
import type { Policy } from "@/lib/types";

const LONG = 600; // characters shown before "Read more"

export function PolicyCard({
  policy,
  onEdit,
  onDelete,
}: {
  policy: Policy;
  onEdit?: (p: Policy) => void;
  onDelete?: (p: Policy) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = policy.body.length > LONG;
  return (
    <Card className="p-space-lg">
      <article aria-labelledby={`policy-${policy.id}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{policy.category_label}</Badge>
          {!policy.is_published && <Badge tone="amber">Draft</Badge>}
          {policy.effective_date && (
            <span className="font-code-mono text-code-mono text-on-surface-variant">Effective {fmtDate(policy.effective_date)}</span>
          )}
        </div>
        <h2 id={`policy-${policy.id}`} className="mt-space-sm font-headline-md text-headline-md text-primary">
          {policy.title}
        </h2>
        <p className={`mt-space-sm whitespace-pre-line break-words text-body-md text-on-surface ${long && !expanded ? "line-clamp-6" : ""}`}>
          {policy.body}
        </p>
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="mt-1 text-label-lg font-medium text-primary-fixed hover:underline"
            aria-expanded={expanded}
          >
            {expanded ? "Show less" : "Read more"}
          </button>
        )}
        <div className="mt-space-md flex flex-wrap items-center justify-between gap-2 border-t border-surface-container-high/40 pt-space-sm">
          <p className="text-body-sm text-on-surface-variant">
            Updated {fmtDate(policy.updated_at)}
            {policy.updated_by_name ? ` by ${policy.updated_by_name}` : ""}
          </p>
          {(onEdit || onDelete) && (
            <div className="flex gap-2">
              {onEdit && (
                <Button size="sm" variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(policy)}>
                  Edit
                </Button>
              )}
              {onDelete && (
                <Button size="sm" variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => onDelete(policy)}>
                  Delete
                </Button>
              )}
            </div>
          )}
        </div>
      </article>
    </Card>
  );
}
