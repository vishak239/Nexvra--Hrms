import { NexvraLogo } from "@/components/brand/NexvraLogo";
import { StatusBadge } from "@/components/ui/Display";
import { fmtMoney, fmtPeriod } from "@/lib/format";
import type { Company, Payslip, PayslipItem } from "@/lib/types";

function ItemTable({ title, items, currency, total }: { title: string; items: PayslipItem[]; currency: string; total: string }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">{title}</h3>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-surface-container-high/40">
          {items.length === 0 ? (
            <tr>
              <td className="py-2 text-outline">None</td>
            </tr>
          ) : (
            items.map((i) => (
              <tr key={i.id}>
                <td className="py-2 text-on-surface">
                  {i.name}
                  {i.source === "ADJUSTMENT" && <span className="ml-2 text-xs text-outline">(adjustment)</span>}
                </td>
                <td className="py-2 text-right tabular-nums text-primary">{fmtMoney(i.amount, currency)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="border-t border-surface-container-high">
            <td className="py-2 font-semibold text-primary">Total</td>
            <td className="py-2 text-right font-semibold tabular-nums text-primary">{fmtMoney(total, currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Printable payslip document. */
export function PayslipView({ payslip, company }: { payslip: Payslip; company?: Company }) {
  const earnings = payslip.items.filter((i) => i.kind === "EARNING");
  const deductions = payslip.items.filter((i) => i.kind === "DEDUCTION");
  return (
    <article className="overflow-hidden rounded-xl bg-surface-container-low print:border-0">
      <header className="print-keep flex flex-wrap items-center justify-between gap-4 border-b border-surface-container-high/40 bg-black px-6 py-4 text-primary print:[-webkit-print-color-adjust:exact] print:[print-color-adjust:exact]">
        <div className="flex items-center gap-1">
          <NexvraLogo height={48} />
          <div className="-ml-2">
            <p className="text-sm font-semibold">{company?.legal_name || company?.name || "Nexvra Solutions"}</p>
            {company?.address && <p className="max-w-xs whitespace-pre-line text-xs text-on-surface-variant">{company.address}</p>}
          </div>
        </div>
        <div className="text-right">
          <p className="font-code-mono text-code-mono uppercase tracking-widest text-primary-fixed">Payslip</p>
          <p className="font-headline-md text-headline-md">{fmtPeriod(payslip.year, payslip.month)}</p>
        </div>
      </header>

      <div className="grid gap-4 border-b border-surface-container-high/40 px-6 py-5 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs text-on-surface-variant">Employee</p>
          <p className="font-medium text-primary">{payslip.employee.full_name}</p>
          <p className="text-on-surface-variant">{payslip.employee.employee_code}</p>
        </div>
        <div className="sm:text-right">
          <p className="text-xs text-on-surface-variant">Department / Designation</p>
          <p className="text-primary">
            {payslip.employee.department ?? "—"} / {payslip.employee.designation ?? "—"}
          </p>
          {payslip.run_status !== "FINALIZED" && (
            <div className="mt-1">
              <StatusBadge status={payslip.run_status} />
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-8 px-6 py-6 md:grid-cols-2">
        <ItemTable title="Earnings" items={earnings} currency={payslip.currency} total={payslip.gross_earnings} />
        <ItemTable title="Deductions" items={deductions} currency={payslip.currency} total={payslip.total_deductions} />
      </div>

      <footer className="flex items-center justify-between gap-4 border-t border-surface-container-high/60 bg-surface-container px-6 py-5">
        <p className="text-sm font-medium text-on-surface-variant">Net pay</p>
        <p className="font-data-metric text-data-metric text-primary-fixed">{fmtMoney(payslip.net_pay, payslip.currency)}</p>
      </footer>
      <p className="px-6 pb-4 pt-2 text-xs text-outline">This is a system-generated payslip.</p>
    </article>
  );
}
