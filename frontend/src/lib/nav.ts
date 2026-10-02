import {
  Bell,
  BarChart3,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  FileText,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Wallet,
  Receipt,
  type LucideIcon,
} from "lucide-react";
import type { Me } from "./types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown if the user holds ANY of these (display only; the API enforces access). Empty = everyone. */
  perms: string[];
  needsEmployee?: boolean;
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
      { href: "/attendance", label: "Attendance", icon: CalendarCheck, perms: ["attendance.self", "attendance.view_team", "attendance.view_all"] },
      { href: "/leave", label: "Leave", icon: CalendarRange, perms: ["leave.apply", "leave.view_team", "leave.view_all"] },
      { href: "/payslips", label: "My payslips", icon: Receipt, perms: ["payroll.view_own"], needsEmployee: true },
      { href: "/documents", label: "Documents", icon: FileText, perms: ["documents.view_own", "documents.view_all"] },
      { href: "/holidays", label: "Holidays", icon: CalendarDays, perms: [] },
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
        (item.perms.length === 0 || item.perms.some((p) => me.permissions.includes(p))),
    ),
  })).filter((section) => section.items.length > 0);
}
