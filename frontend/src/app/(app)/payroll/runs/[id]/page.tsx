"use client";

import { ArrowLeft, CheckCircle2, FileText, Lock, Plus, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RequirePermission } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader, PageHeader, StatCard, StatusBadge } from "@/components/ui/Display";
import { SelectField, TextField } from "@/components/ui/Field";
import { ConfirmDialog, Modal, useToast } from "@/components/ui/Overlay";
import { Alert, EmptyState, ErrorState, FormError, Loading, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, fmtMoney, fmtPeriod } from "@/lib/format";
import { tryApi, useAction, useResource } from "@/lib/hooks";
import type { Paginated, PayrollRun, Payslip } from "@/lib/types";

function AdjustmentsModal({ payslip, onClose, onChange }: { payslip: Payslip | null; onClose: () => void; onChange: (p: Payslip) => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", kind: "EARNING", amount: "" });
  const { run, pending, error, setError } = useAction();

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!payslip) return;
    const updated = await run(() => api<Payslip>(`/api/payroll/payslips/${payslip.id}/adjustments/`, { body: form }));
    if (updated) {
      toast("Adjustment added.");
      setForm({ name: "", kind: "EARNING", amount: "" });
      onChange(updated);
    }
  }

  async function remove(itemId: number) {
    if (!payslip) return;
    const r = await tryApi(() => api<Payslip>(`/api/payroll/payslips/${payslip.id}/adjustments/${itemId}/`, { method: "DELETE" }));
    if (r.ok) onChange(r.data);
    else toast(r.error.message, "error");
  }

  return (
    <Modal
      open={!!payslip}
      size="lg"
      title={payslip ? `Adjust payslip: ${payslip.employee.full_name}` : ""}
      description="Manual earnings or deductions for this month only. Recorded in the audit log."
      onClose={() => {
        setError(undefined);
        onClose();
      }}
    >
      {payslip && (
        <div className="space-y-5">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-100">
              {payslip.items.map((i) => (
                <tr key={i.id}>
                  <td className="py-2 text-zinc-700">
                    {i.name}
                    {i.source === "ADJUSTMENT" && <span className="ml-2 text-xs text-zinc-400">adjustment</span>}
                  </td>
                  <td className="py-2">
                    <StatusBadge status={i.kind} />
                  </td>
                  <td className="py-2 text-right tabular-nums">{fmtMoney(i.amount, payslip.currency)}</td>
                  <td className="w-10 py-2 text-right">
                    {i.source === "ADJUSTMENT" && (
                      <button onClick={() => void remove(i.id)} className="rounded-md p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove ${i.name}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-zinc-300">
                <td className="py-2 font-semibold" colSpan={2}>
                  Net pay
                </td>
                <td className="py-2 text-right font-semibold tabular-nums">{fmtMoney(payslip.net_pay, payslip.currency)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <form onSubmit={onAdd} className="space-y-3 rounded-lg border border-zinc-200 p-4" noValidate>
            <p className="text-sm font-medium text-zinc-900">Add adjustment</p>
            <FormError error={error} />
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={error?.fields.name} required />
              <SelectField label="Kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="EARNING">Earning</option>
                <option value="DEDUCTION">Deduction</option>
              </SelectField>
              <TextField label="Amount" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} error={error?.fields.amount} required />
            </div>
            <div className="flex justify-end">
              <Button type="submit" size="sm" icon={<Plus className="h-4 w-4" />} loading={pending} disabled={!form.name || !form.amount}>
                Add
              </Button>
            </div>
          </form>
        </div>
      )}
    </Modal>
  );
}

function RunDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can } = useAuth();
  const manage = can("payroll.manage");
  const [page, setPage] = useState(1);
  const [confirm, setConfirm] = useState<"finalize" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [adjusting, setAdjusting] = useState<Payslip | null>(null);
  const runRes = useResource<PayrollRun>(`/api/payroll/runs/${id}/`);
  // Payslips are fetched only once the run itself has loaded (avoids a pointless request for unknown runs).
  const slips = useResource<Paginated<Payslip>>(runRes.data ? "/api/payroll/payslips/" : null, { run: id, page, page_size: PAGE_SIZE });

  if (runRes.loading && !runRes.data) return <Loading />;
  if (runRes.error || !runRes.data) return <ErrorState error={runRes.error} onRetry={runRes.reload} />;
  const run = runRes.data;
  const draft = run.status === "DRAFT";

  async function generate() {
    setBusy(true);
    const r = await tryApi(() => api<{ created: number; missing_structure: string[] }>(`/api/payroll/runs/${id}/generate/`, { method: "POST" }));
    setBusy(false);
    if (r.ok) {
      toast(`${r.data.created} payslip(s) generated.`);
      setMissing(r.data.missing_structure);
      runRes.reload();
      slips.reload();
    } else toast(r.error.message, "error");
  }

  async function confirmAction() {
    setBusy(true);
    if (confirm === "finalize") {
      const r = await tryApi(() => api(`/api/payroll/runs/${id}/finalize/`, { method: "POST" }));
      toast(r.ok ? "Payroll finalized. Employees have been notified." : r.error.message, r.ok ? "success" : "error");
      runRes.reload();
      slips.reload();
    } else if (confirm === "delete") {
      const r = await tryApi(() => api(`/api/payroll/runs/${id}/`, { method: "DELETE" }));
      if (r.ok) {
        toast("Payroll run deleted.");
        router.replace("/payroll");
      } else toast(r.error.message, "error");
    }
    setBusy(false);
    setConfirm(null);
  }

  return (
    <>
      <Link href="/payroll" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="h-4 w-4" /> Payroll
      </Link>
      <PageHeader
        title={`Payroll · ${fmtPeriod(run.year, run.month)}`}
        description={run.finalized_at ? `Finalized ${fmtDateTime(run.finalized_at)}` : "Draft. Payslips are not visible to employees yet."}
        actions={
          manage &&
          draft && (
            <>
              <Button variant="secondary" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirm("delete")}>
                Delete run
              </Button>
              <Button variant="secondary" icon={<RefreshCw className="h-4 w-4" />} loading={busy && !confirm} onClick={generate}>
                Generate payslips
              </Button>
              <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => setConfirm("finalize")} disabled={run.payslip_count === 0}>
                Finalize
              </Button>
            </>
          )
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Status" value={<StatusBadge status={run.status} />} icon={draft ? undefined : <Lock className="h-5 w-5" />} />
        <StatCard label="Payslips" value={run.payslip_count} />
        <StatCard label="Total net pay" value={fmtMoney(run.total_net ?? "0", run.currency)} />
      </div>
      {missing && missing.length > 0 && (
        <div className="mb-6">
          <Alert tone="warning">
            Skipped (no salary structure effective for this month): {missing.join(", ")}
          </Alert>
        </div>
      )}
      <Card>
        <CardHeader title="Payslips" />
        {slips.error ? (
          <ErrorState error={slips.error} onRetry={slips.reload} />
        ) : slips.loading && !slips.data ? (
          <SkeletonRows />
        ) : !slips.data?.results.length ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="No payslips yet"
            description={draft ? "Use Generate payslips to create them from salary structures." : undefined}
          />
        ) : (
          <>
            <Table>
              <THead>
                <Th>Employee</Th>
                <Th>Department</Th>
                <Th className="text-right">Gross</Th>
                <Th className="text-right">Deductions</Th>
                <Th className="text-right">Net pay</Th>
                <Th className="text-right">Actions</Th>
              </THead>
              <TBody>
                {slips.data.results.map((p) => (
                  <tr key={p.id}>
                    <Td>
                      <span className="font-medium text-zinc-900">{p.employee.full_name}</span>
                      <span className="ml-2 font-mono text-xs text-zinc-400">{p.employee.employee_code}</span>
                    </Td>
                    <Td>{p.employee.department ?? "—"}</Td>
                    <Td className="text-right tabular-nums">{fmtMoney(p.gross_earnings, p.currency)}</Td>
                    <Td className="text-right tabular-nums">{fmtMoney(p.total_deductions, p.currency)}</Td>
                    <Td className="text-right font-medium tabular-nums text-zinc-900">{fmtMoney(p.net_pay, p.currency)}</Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-2">
                        {manage && draft && (
                          <Button size="sm" variant="secondary" onClick={() => setAdjusting(p)}>
                            Adjust
                          </Button>
                        )}
                        <Link href={`/payslips/${p.id}`} className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-100">
                          View
                        </Link>
                      </div>
                    </Td>
                  </tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} count={slips.data.count} onPage={setPage} />
          </>
        )}
      </Card>

      <AdjustmentsModal
        payslip={adjusting}
        onClose={() => {
          setAdjusting(null);
          slips.reload();
          runRes.reload();
        }}
        onChange={setAdjusting}
      />
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "finalize" ? "Finalize payroll?" : "Delete payroll run?"}
        message={
          confirm === "finalize"
            ? "Finalizing locks this run permanently and publishes the payslips to employees, who will be notified. This cannot be undone."
            : "This deletes the draft run and its payslips."
        }
        confirmLabel={confirm === "finalize" ? "Finalize and publish" : "Delete"}
        danger={confirm === "delete"}
        pending={busy}
        onClose={() => setConfirm(null)}
        onConfirm={() => void confirmAction()}
      />
    </>
  );
}

export default function PayrollRunPage() {
  return (
    <RequirePermission perms={["payroll.view_all", "payroll.manage"]}>
      <RunDetail />
    </RequirePermission>
  );
}
