"use client";

import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/Display";
import { CheckboxField, FilterSelect, TextField } from "@/components/ui/Field";
import { ConfirmDialog, Modal, useToast } from "@/components/ui/Overlay";
import { EmptyState, ErrorState, FormError, SkeletonRows } from "@/components/ui/States";
import { TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { tryApi, useAction, useResource } from "@/lib/hooks";
import type { Holiday } from "@/lib/types";

const WEEKDAY = new Intl.DateTimeFormat("en-GB", { weekday: "long" });

export default function HolidaysPage() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can("holidays.manage");
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Holiday | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [form, setForm] = useState({ name: "", date: "", is_optional: false });
  const { run, pending, error, setError } = useAction();
  const { data, error: loadError, loading, reload } = useResource<Holiday[]>("/api/holidays/", { year });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await run(() => api("/api/holidays/", { body: form }));
    if (ok) {
      toast("Holiday added.");
      setAdding(false);
      reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Holidays"
        description="Company holiday calendar. Optional holidays don't reduce leave day counts."
        actions={
          <>
            <FilterSelect label="Year" value={year} onChange={(e) => setYear(e.target.value)}>
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </FilterSelect>
            {manage && (
              <Button
                icon={<Plus className="h-4 w-4" />}
                onClick={() => {
                  setError(undefined);
                  setForm({ name: "", date: `${year}-01-01`, is_optional: false });
                  setAdding(true);
                }}
              >
                Add holiday
              </Button>
            )}
          </>
        }
      />
      <Card>
        <CardHeader title={`${year} calendar`} description={data ? `${data.length} holiday(s)` : undefined} />
        {loadError ? (
          <ErrorState error={loadError} onRetry={reload} />
        ) : loading && !data ? (
          <SkeletonRows />
        ) : !data?.length ? (
          <EmptyState
            icon={<CalendarDays className="h-5 w-5" />}
            title="No holidays for this year"
            description={manage ? "Add the holidays HR has decided on." : "HR hasn't published holidays for this year yet."}
          />
        ) : (
          <Table>
            <THead>
              <Th>Date</Th>
              <Th>Day</Th>
              <Th>Holiday</Th>
              <Th>Type</Th>
              {manage && <Th className="text-right">Actions</Th>}
            </THead>
            <TBody>
              {data.map((h) => (
                <tr key={h.id}>
                  <Td className="font-medium text-zinc-900">{fmtDate(h.date)}</Td>
                  <Td>{WEEKDAY.format(new Date(`${h.date}T00:00:00`))}</Td>
                  <Td>{h.name}</Td>
                  <Td>{h.is_optional ? <Badge>Optional</Badge> : <Badge tone="lime">Company holiday</Badge>}</Td>
                  {manage && (
                    <Td className="text-right">
                      <button onClick={() => setDeleting(h)} className="rounded-md p-1.5 text-zinc-500 hover:bg-red-50 hover:text-red-600" aria-label={`Delete ${h.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </Td>
                  )}
                </tr>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Modal
        open={adding}
        title="Add holiday"
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form="holiday-form" loading={pending}>
              Add
            </Button>
          </>
        }
      >
        <form id="holiday-form" onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError error={error} />
          <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={error?.fields.name} required />
          <TextField label="Date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} error={error?.fields.date} required />
          <CheckboxField label="Optional holiday" checked={form.is_optional} onChange={(e) => setForm({ ...form, is_optional: e.target.checked })} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        title="Delete holiday?"
        message={deleting ? `${deleting.name} on ${fmtDate(deleting.date)} will be removed.` : ""}
        confirmLabel="Delete"
        danger
        pending={deletePending}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          setDeletePending(true);
          const r = await tryApi(() => api(`/api/holidays/${deleting.id}/`, { method: "DELETE" }));
          setDeletePending(false);
          toast(r.ok ? "Holiday deleted." : r.error.message, r.ok ? "success" : "error");
          setDeleting(null);
          reload();
        }}
      />
    </>
  );
}
