"use client";

import { ArrowLeft, Printer } from "@/components/ui/icons";
import { useParams, useRouter } from "next/navigation";
import { PayslipView } from "@/components/payroll/PayslipView";
import { Button } from "@/components/ui/Button";
import { ErrorState, Loading } from "@/components/ui/States";
import { useResource } from "@/lib/hooks";
import type { Company, Payslip } from "@/lib/types";

export default function PayslipPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data, error, loading, reload } = useResource<Payslip>(`/api/payroll/payslips/${id}/`);
  const company = useResource<Company>("/api/company/");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex items-center justify-between">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1 text-sm text-on-surface-variant hover:text-primary">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {data && (
          <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        )}
      </div>
      {loading && !data ? (
        <Loading />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <PayslipView payslip={data} company={company.data} />
      )}
    </div>
  );
}
