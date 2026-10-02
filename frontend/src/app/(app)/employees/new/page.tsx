"use client";

import { EmployeeForm } from "@/components/employees/EmployeeForm";
import { RequirePermission } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/ui/Display";

export default function NewEmployeePage() {
  return (
    <RequirePermission perms={["employees.manage"]}>
      <div className="mx-auto max-w-4xl">
        <PageHeader title="Add employee" description="Creates the employee record and their sign-in account." />
        <EmployeeForm />
      </div>
    </RequirePermission>
  );
}
