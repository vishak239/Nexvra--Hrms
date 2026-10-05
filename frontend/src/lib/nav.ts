import {
  Bell,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  FolderShared,
  Gavel,
  Groups,
  LayoutDashboard,
  ListTodo,
  MessageSquare,
  ScrollText,
  Settings,
  ShieldCheck,
  Timer,
  UserRound,
  Users,
  Wallet,
  Receipt,
  type Icon,
} from "@/components/ui/icons";
import type { Me } from "./types";

export interface NavItem {
  href: string;
  label: string;
  icon: Icon;
  /** Shown if the user holds ANY of these (display only; the API enforces access). Empty = everyone. */
  perms: string[];
  needsEmployee?: boolean;
  /** Shown to users with an employee record, or to anyone holding one of these permissions. */
  needsEmployeeOr?: string[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, perms: [] },
      { href: "/profile", label: "My profile", icon: UserRound, perms: [], needsEmployee: true },
      { href: "/attendance", label: "Attendance", icon: Timer, perms: ["attendance.self", "attendance.view_team", "attendance.view_all"] },
      { href: "/leave", label: "Leave", icon: CalendarCheck, perms: ["leave.apply", "leave.view_team", "leave.view_all"] },
      { href: "/tasks", label: "Tasks", icon: ListTodo, perms: [], needsEmployeeOr: ["tasks.manage", "tasks.view_all", "tasks.view_team"] },
      { href: "/messages", label: "Messages", icon: MessageSquare, perms: ["messages.use"] },
      { href: "/meetings", label: "Meetings", icon: Groups, perms: [], needsEmployeeOr: ["meetings.manage"] },
      { href: "/payslips", label: "My payslips", icon: Receipt, perms: ["payroll.view_own"], needsEmployee: true },
      { href: "/documents", label: "Documents", icon: FolderShared, perms: ["documents.view_own", "documents.view_all"] },
      { href: "/holidays", label: "Holidays", icon: CalendarDays, perms: [] },
      { href: "/policies", label: "Policies", icon: Gavel, perms: [] },
      { href: "/notifications", label: "Notifications", icon: Bell, perms: [] },
    ],
  },
  {
    title: "Management",
    items: [
      { href: "/employees", label: "Employees", icon: Users, perms: ["employees.view_team", "employees.view_all"] },
      { href: "/payroll", label: "Payroll", icon: Wallet, perms: ["payroll.view_all", "payroll.manage"] },
      { href: "/reports", label: "Reports", icon: BarChart3, perms: ["reports.view_team", "reports.view_all"] },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
        perms: ["settings.manage", "company.manage", "departments.manage", "designations.manage"],
      },
      { href: "/admin/users", label: "Users & roles", icon: ShieldCheck, perms: ["users.view", "roles.view"] },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText, perms: ["audit.view"] },
    ],
  },
];

export function visibleNav(me: Me): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) =>
        (!item.needsEmployee || me.employee !== null) &&
        (!item.needsEmployeeOr || me.employee !== null || item.needsEmployeeOr.some((p) => me.permissions.includes(p))) &&
        (item.perms.length === 0 || item.perms.some((p) => me.permissions.includes(p))),
    ),
  })).filter((section) => section.items.length > 0);
}

/** The navigation section and entry a path belongs to (longest matching href), for page breadcrumbs. */
export function navTrail(pathname: string): { section: string; label: string } | null {
  let best: { section: string; label: string; length: number } | null = null;
  for (const section of NAV) {
    for (const item of section.items) {
      if ((pathname === item.href || pathname.startsWith(`${item.href}/`)) && item.href.length > (best?.length ?? 0)) {
        best = { section: section.title, label: item.label, length: item.href.length };
      }
    }
  }
  return best && { section: best.section, label: best.label };
}
