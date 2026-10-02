"use client";

import { ArrowRight, Bell, CalendarDays, ClipboardCheck, Users, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CheckInCard } from "@/components/attendance/CheckInCard";
import { Badge, Card, CardHeader, PageHeader, StatCard, StatusBadge } from "@/components/ui/Display";
import { EmptyState, ErrorState, Loading } from "@/components/ui/States";
import { useAuth } from "@/lib/auth";
import { fmtDate, fmtDays, fmtMoney, fmtPeriod, humanize } from "@/lib/format";
import { useResource } from "@/lib/hooks";
import type { Dashboard, DayStatus } from "@/lib/types";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const DAY_ORDER: DayStatus[] = ["PRESENT", "HALF_DAY", "ON_LEAVE", "ABSENT", "NOT_MARKED", "HOLIDAY", "WEEKLY_OFF"];

export default function DashboardPage() {
  const { me } = useAuth();
  const { data, error, loading, reload } = useResource<Dashboard>("/api/dashboard/");

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;

  const mine = data.me;
  const stats = [
    data.pending_approvals !== undefined && {
      label: "Pending approvals",
      value: data.pending_approvals,
      hint: <Link href="/leave?tab=approvals" className="font-medium text-zinc-700 hover:underline">Review requests →</Link>,
      icon: <ClipboardCheck className="h-5 w-5" />,
    },
    data.headcount !== undefined && {
      label: "Active employees",
      value: data.headcount,
      hint: "Company headcount",
      icon: <Users className="h-5 w-5" />,
    },
    data.team_size !== undefined && {
      label: "My team",
      value: data.team_size,
      hint: "Direct reports",
      icon: <Users className="h-5 w-5" />,
    },
    data.latest_payroll_run !== undefined && {
      label: "Latest payroll",
      value: data.latest_payroll_run ? fmtPeriod(data.latest_payroll_run.year, data.latest_payroll_run.month) : "None yet",
      hint: data.latest_payroll_run ? <StatusBadge status={data.latest_payroll_run.status} /> : "No payroll runs",
      icon: <Wallet className="h-5 w-5" />,
    },
    {
      label: "Unread notifications",
      value: data.unread_notifications,
      hint: <Link href="/notifications" className="font-medium text-zinc-700 hover:underline">Open inbox →</Link>,
      icon: <Bell className="h-5 w-5" />,
    },
  ].filter(Boolean) as { label: string; value: ReactNode; hint: ReactNode; icon: ReactNode }[];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${me?.first_name || "there"}`}
        description={`${fmtDate(data.date)} · ${me?.role.name}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.slice(0, 4).map((s) => (
          <StatCard key={s.label} {...s} />
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {mine && (
            <CheckInCard
              date={data.date}
              record={mine.attendance_today}
              enabled={mine.self_attendance_enabled}
              onChange={reload}
            />
          )}

          {data.attendance_today && (
            <Card>
              <CardHeader
                title={me?.permissions.includes("attendance.view_all") ? "Company attendance today" : "Team attendance today"}
                description={`${data.attendance_today.total} people · ${data.attendance_today.late} late`}
                actions={
                  <Link href="/attendance?tab=daily" className="text-sm font-medium text-zinc-700 hover:underline">
                    Details
                  </Link>
                }
              />
              {data.attendance_today.total === 0 ? (
                <EmptyState title="No one to show" description="There are no active people in your scope yet." />
              ) : (
                <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
                  {DAY_ORDER.filter((s) => data.attendance_today?.by_status[s]).map((s) => (
                    <div key={s} className="rounded-lg border border-zinc-100 p-3">
                      <p className="text-xs text-zinc-500">{humanize(s)}</p>
                      <p className="mt-1 text-xl font-semibold text-zinc-900">{data.attendance_today?.by_status[s]}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {mine && (
            <Card>
              <CardHeader
                title="My leave balance"
                description={`Leave year ${mine.leave_year}`}
                actions={
                  <Link href="/leave" className="text-sm font-medium text-zinc-700 hover:underline">
                    Apply for leave
                  </Link>
                }
              />
              {mine.leave_balances.length === 0 ? (
                <EmptyState
                  title="No leave balances"
                  description="HR hasn't set up leave types with allocations yet."
                />
              ) : (
                <div className="grid gap-4 p-5 sm:grid-cols-2">
                  {mine.leave_balances.map((b) => (
                    <div key={b.leave_type} className="rounded-lg border border-zinc-100 p-4">
                      <p className="text-sm font-medium text-zinc-900">{b.leave_type}</p>
                      {b.has_allocation ? (
                        <>
                          <p className="mt-2 text-2xl font-semibold text-zinc-900">
                            {fmtDays(b.available)}
                            <span className="ml-1 text-sm font-normal text-zinc-500">of {fmtDays(b.allocated)} days left</span>
                          </p>
                          <p className="mt-1 text-xs text-zinc-500">
                            {fmtDays(b.used)} used · {fmtDays(b.pending)} pending
                          </p>
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-zinc-500">Not allocated for this year.</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {mine && (
            <Card>
              <CardHeader title="Latest payslip" />
              {mine.latest_payslip ? (
                <div className="p-5">
                  <p className="text-sm text-zinc-500">
                    {fmtPeriod(mine.latest_payslip.year, mine.latest_payslip.month)}
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-900">
                    {fmtMoney(mine.latest_payslip.net_pay, mine.latest_payslip.currency)}
                  </p>
                  <p className="text-xs text-zinc-500">Net pay</p>
                  <Link
                    href={`/payslips/${mine.latest_payslip.id}`}
                    className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-zinc-900 hover:underline"
                  >
                    View payslip <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <EmptyState title="No payslips yet" description="Payslips appear here once payroll is finalized." />
              )}
            </Card>
          )}

          <Card>
            <CardHeader
              title="Upcoming holidays"
              actions={
                <Link href="/holidays" className="text-sm font-medium text-zinc-700 hover:underline">
                  Calendar
                </Link>
              }
            />
            {data.upcoming_holidays.length === 0 ? (
              <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No upcoming holidays" />
            ) : (
              <ul className="divide-y divide-zinc-100">
                {data.upcoming_holidays.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div>
                      <p className="text-sm font-medium text-zinc-900">{h.name}</p>
                      <p className="text-xs text-zinc-500">{fmtDate(h.date)}</p>
                    </div>
                    {h.is_optional && <Badge>Optional</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
