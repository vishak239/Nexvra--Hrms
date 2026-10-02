"use client";

import { ArrowLeft, FileText, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmployeeProfile } from "@/components/employees/EmployeeProfile";
import { ButtonLink } from "@/components/ui/Button";
import { ErrorState, Loading } from "@/components/ui/States";
import { useAuth } from "@/lib/auth";
import { useResource } from "@/lib/hooks";
import type { Employee } from "@/lib/types";

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can, me } = useAuth();
  const { data, error, loading, reload } = useResource<Employee>(`/api/employees/${id}/`);

  return (
    <>
      <Link href="/employees" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="h-4 w-4" /> Employees
      </Link>
      {loading && !data ? (
        <Loading />
      ) : error || !data ? (
        <ErrorState error={error} onRetry={reload} />
      ) : (
        <EmployeeProfile
          employee={data}
          onChange={reload}
          canEditPhoto={can("employees.manage") || me?.employee?.id === data.id}
          actions={
            <>
              {can("documents.view_all") && (
                <ButtonLink href={`/documents?employee=${data.id}`} variant="secondary" icon={<FileText className="h-4 w-4" />}>
                  Documents
                </ButtonLink>
              )}
              {can("employees.manage") && (
                <ButtonLink href={`/employees/${data.id}/edit`} variant="dark" icon={<Pencil className="h-4 w-4" />}>
                  Edit
                </ButtonLink>
              )}
            </>
          }
        />
      )}
    </>
  );
}
