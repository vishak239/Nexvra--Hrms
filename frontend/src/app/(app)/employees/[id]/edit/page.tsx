"use client";

import { useParams } from "next/navigation";
import { EmployeeForm } from "@/components/employees/EmployeeForm";
import { RequirePermission } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Display";
import { ErrorState, Loading } from "@/components/ui/States";
import { useResource } from "@/lib/hooks";
import type { Employee } from "@/lib/types";

function Edit() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading, reload } = useResource<Employee>(`/api/employees/${id}/`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={`Edit ${data.full_name}`} description={data.employee_code} />
      <EmployeeForm employee={data} />
    </div>
  );
}

export default function EditEmployeePage() {
  return (
    <RequirePermission perms={["employees.manage"]}>
      <Edit />
    </RequirePermission>
  );
}
