"use client";

import { Receipt } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, PageHeader } from "@/components/ui/Display";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { useAuth } from "@/lib/auth";
import { fmtMoney, fmtPeriod } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type { Paginated, Payslip } from "@/lib/types";

export default function MyPayslipsPage() {
  const router = useRouter();
  const { me } = useAuth();
  const [page, setPage] = useState(1);
  // HR can see every payslip through the API; this page always shows the user's own, finalized ones.
  const { data, error, loading, reload } = useResource<Paginated<Payslip>>(
    me?.employee ? "/api/payroll/payslips/" : null,
    { employee: me?.employee?.id, run__status: "FINALIZED", page, page_size: PAGE_SIZE },
  );
  const rows = data?.results ?? [];

  return (
    <>
      <PageHeader title="My payslips" description="Payslips appear once payroll for the month is finalized." />
      <Card>
        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <SkeletonRows />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Receipt className="h-5 w-5" />} title="No payslips yet" />
        ) : (
          <>
            <Table>
              <THead>
                <Th>Period</Th>
                <Th className="text-right">Gross earnings</Th>
                <Th className="text-right">Deductions</Th>
                <Th className="text-right">Net pay</Th>
              </THead>
              <TBody>
                {rows.map((p) => (
                  <tr key={p.id} className="cursor-pointer hover:bg-surface-container" onClick={() => router.push(`/payslips/${p.id}`)}>
                    <Td className="font-medium text-primary">{fmtPeriod(p.year, p.month)}</Td>
                    <Td className="text-right tabular-nums">{fmtMoney(p.gross_earnings, p.currency)}</Td>
                    <Td className="text-right tabular-nums">{fmtMoney(p.total_deductions, p.currency)}</Td>
                    <Td className="text-right font-semibold tabular-nums text-primary">{fmtMoney(p.net_pay, p.currency)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
