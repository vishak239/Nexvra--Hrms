"use client";

import { Plus, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { RequirePermission } from "@/components/layout/AppShell";
import { ButtonLink } from "@/components/ui/Button";
import { Avatar, Card, PageHeader, StatusBadge } from "@/components/ui/Display";
import { FilterSelect, SearchInput } from "@/components/ui/Field";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/States";
import { PAGE_SIZE, Pagination, TBody, THead, Table, Td, Th } from "@/components/ui/Table";
import { Can } from "@/lib/auth";
import { fmtDate, humanize } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type { Department, Employee, Paginated } from "@/lib/types";

const STATUSES = ["ACTIVE", "PROBATION", "NOTICE_PERIOD", "EXITED"];

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function EmployeesList() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search);

  useEffect(() => setPage(1), [q, department, status]);

  const { data, error, loading, reload } = useResource<Paginated<Employee>>("/api/employees/", {
    search: q,
    department,
    employment_status: status,
    page,
    page_size: PAGE_SIZE,
  });
  const departments = useResource<Paginated<Department>>("/api/departments/", { page_size: 100 });

  return (
    <>
      <PageHeader
        title="Employees"
        description="People you can see based on your role."
        actions={
          <Can perm="employees.manage">
            <ButtonLink href="/employees/new" icon={<Plus className="h-4 w-4" />}>
              Add employee
            </ButtonLink>
          </Can>
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-zinc-100 p-4 sm:flex-row sm:flex-wrap">
          <SearchInput label="Search name, email or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
          <FilterSelect label="Department" value={department} onChange={(e) => setDepartment(e.target.value)}>
            <option value="">All departments</option>
            {departments.data?.results.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </FilterSelect>
        </div>

        {error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : loading && !data ? (
          <SkeletonRows />
        ) : !data || data.results.length === 0 ? (
          <EmptyState
            icon={<Users className="h-5 w-5" />}
            title="No employees found"
            description={search || department || status ? "Try clearing the filters." : "Employees you can access will appear here."}
          />
        ) : (
          <>
            <Table>
              <THead>
                <Th>Employee</Th>
                <Th>ID</Th>
                <Th>Department</Th>
                <Th>Designation</Th>
                <Th>Manager</Th>
                <Th>Status</Th>
                <Th>Joined</Th>
              </THead>
              <TBody>
                {data.results.map((e) => (
                  <tr
                    key={e.id}
                    className="cursor-pointer hover:bg-zinc-50"
                    onClick={() => router.push(`/employees/${e.id}`)}
                  >
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={e.full_name} src={e.has_photo ? `/api/employees/${e.id}/photo/` : null} size={32} />
                        <div>
                          <Link
                            href={`/employees/${e.id}`}
                            onClick={(ev) => ev.stopPropagation()}
                            className="font-medium text-zinc-900 hover:underline"
                          >
                            {e.full_name}
                          </Link>
                          <p className="text-xs text-zinc-500">{e.email}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="font-mono text-xs">{e.employee_code}</Td>
                    <Td>{e.department?.name ?? "—"}</Td>
                    <Td>{e.designation?.name ?? "—"}</Td>
                    <Td>{e.manager?.full_name ?? "—"}</Td>
                    <Td>
                      <StatusBadge status={e.employment_status} />
                    </Td>
                    <Td>{fmtDate(e.joining_date)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
            <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

export default function EmployeesPage() {
  return (
    <RequirePermission perms={["employees.view_team", "employees.view_all"]}>
      <EmployeesList />
    </RequirePermission>
  );
}
