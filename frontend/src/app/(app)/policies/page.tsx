"use client";

import { useEffect, useState } from "react";
import { PolicyCard } from "@/components/policies/PolicyCard";
import { PolicyFormModal } from "@/components/policies/PolicyFormModal";
import { SystemRules } from "@/components/policies/SystemRules";
import { POLICY_CATEGORIES } from "@/components/policies/categories";
import { Button } from "@/components/ui/Button";
import { Card, PageHeader } from "@/components/ui/Display";
import { FilterSelect, SearchInput } from "@/components/ui/Field";
import { Gavel, Plus } from "@/components/ui/icons";
import { ConfirmDialog, useToast } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { Pagination } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { tryApi, useDebounced, useResource } from "@/lib/hooks";
import type { Paginated, Policy } from "@/lib/types";

const PAGE = 10;

export default function PoliciesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can("policies.manage");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Policy | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const q = useDebounced(search);

  useEffect(() => setPage(1), [q, category, status]);

  const { data, error, loading, reload } = useResource<Paginated<Policy>>("/api/policies/", {
    q,
    category,
    status: manage ? status : "",
    page,
    page_size: PAGE,
  });
  const filtered = !!(q || category || status);

  return (
    <>
      <PageHeader
        title="Policies"
        description="Company rules and guidelines. Published policies are visible to everyone at Nexvra."
        actions={
          manage && (
            <Button
              icon={<Plus className="h-4 w-4" />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              New policy
            </Button>
          )
        }
      />

      <div className="space-y-space-lg">
        <SystemRules />

        <Card className="flex flex-col gap-space-sm p-space-md sm:flex-row sm:flex-wrap sm:items-center">
          <SearchInput label="Search policies" value={search} onChange={(e) => setSearch(e.target.value)} />
          <FilterSelect label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {POLICY_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </FilterSelect>
          {manage && (
            <FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Published and drafts</option>
              <option value="published">Published</option>
              <option value="draft">Drafts</option>
            </FilterSelect>
          )}
        </Card>

        {error ? (
          <Card>
            <ErrorState error={error} onRetry={reload} />
          </Card>
        ) : loading && !data ? (
          <Card>
            <SkeletonRows />
          </Card>
        ) : !data?.results.length ? (
          <Card>
            <EmptyState
              icon={<Gavel className="h-5 w-5" />}
              title={filtered ? "No policies match" : "No policies yet"}
              description={
                filtered
                  ? "Try another search or category."
                  : manage
                    ? "Add your company's rules, such as conduct or communication guidelines. Drafts stay hidden until you publish them."
                    : "HR hasn't published any policies yet."
              }
            />
          </Card>
        ) : (
          <div className="space-y-space-md">
            {data.results.map((p) => (
              <PolicyCard
                key={p.id}
                policy={p}
                onEdit={
                  manage
                    ? (policy) => {
                        setEditing(policy);
                        setFormOpen(true);
                      }
                    : undefined
                }
                onDelete={manage ? setDeleting : undefined}
              />
            ))}
            {data.count > PAGE && (
              <Card className="overflow-hidden">
                <Pagination page={page} pageSize={PAGE} count={data.count} onPage={setPage} />
              </Card>
            )}
          </div>
        )}
      </div>

      <PolicyFormModal
        open={formOpen}
        policy={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          reload();
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Delete policy?"
        message={deleting ? `“${deleting.title}” will be removed for everyone. This can't be undone.` : ""}
        confirmLabel="Delete"
        danger
        pending={deletePending}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setDeletePending(true);
          const r = await tryApi(() => api(`/api/policies/${deleting.id}/`, { method: "DELETE" }));
          setDeletePending(false);
          toast(r.ok ? "Policy deleted." : r.error.message, r.ok ? "success" : "error");
          setDeleting(null);
          reload();
        }}
      />
    </>
  );
}
