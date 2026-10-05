"use client";

import { Bell, KeyRound, LogOut, Menu, MessageSquare, UserRound, X } from "@/components/ui/icons";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AttendanceActions } from "@/components/attendance/AttendanceActions";
import { WorkSessionProvider } from "@/components/attendance/WorkSessionProvider";
import { NexvraLogo } from "@/components/brand/NexvraLogo";
import { ConnectionIndicator, OfflineBanner } from "@/components/connection/ConnectionIndicator";
import { NotificationCenterProvider, useNotificationCenter } from "@/components/layout/NotificationCenter";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Avatar } from "@/components/ui/Display";
import { ErrorState, Loading, NoAccess } from "@/components/ui/States";
import { useAuth } from "@/lib/auth";
import { ConnectionProvider } from "@/lib/connection";
import { navTrail, visibleNav } from "@/lib/nav";
import type { Me } from "@/lib/types";

function Sidebar({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { logout } = useAuth();
  const router = useRouter();
  const photo = me.employee?.has_photo ? `/api/employees/${me.employee.id}/photo/` : null;
  return (
    // `dark`: the sidebar stays black in both themes (the official logo has a black background).
    <div className="dark flex h-full flex-col border-r border-surface-container-high/40 bg-black text-on-surface">
      <div className="flex h-16 items-center border-b border-surface-container-high/40 px-space-md">
        <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-1" aria-label="Nexvra HRMS home">
          <NexvraLogo height={44} />
          <div className="-ml-1.5 flex flex-col">
            <span className="font-headline-sm text-headline-sm font-semibold tracking-tight text-primary">NEXVRA</span>
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">HRMS</span>
          </div>
        </Link>
      </div>
      <nav className="flex-1 space-y-space-lg overflow-y-auto px-space-xs py-space-md" aria-label="Main">
        {visibleNav(me).map((section) => (
          <div key={section.title}>
            <p className="px-space-md pb-1.5 font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant/60">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-space-sm rounded-lg border-l-2 px-space-md py-space-sm text-label-lg transition-colors ${
                        active
                          ? "border-primary-container bg-surface-container-low font-medium text-primary-fixed"
                          : "border-transparent text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-surface-container-high/40 p-space-sm">
        <div className="flex items-center justify-between gap-2 rounded-lg p-space-xs">
          <div className="flex min-w-0 items-center gap-space-sm">
            <span className="relative">
              <Avatar name={me.full_name || me.email} src={photo} size={32} />
              <span className="absolute bottom-0 right-0 h-2 w-2 rounded-[50%] bg-primary-container ring-1 ring-black" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-label-sm text-label-sm font-semibold text-primary">{me.full_name || me.email}</span>
              <span className="truncate font-code-mono text-code-mono text-primary-fixed">{me.role.name}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
            className="rounded p-1 text-on-surface-variant transition-colors hover:text-on-surface"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function UserMenu({ me }: { me: Me }) {
  const { logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const photo = me.employee?.has_photo ? `/api/employees/${me.employee.id}/photo/` : null;

  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-surface-container-low"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={me.full_name || me.email} src={photo} size={32} />
        <span className="sr-only">Account menu for {me.full_name || me.email}</span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-surface-container-high bg-surface-container p-1.5">
          <div className="border-b border-surface-container-high/60 px-3 py-2">
            <p className="truncate text-label-lg font-medium text-primary">{me.full_name}</p>
            <p className="truncate text-body-sm text-on-surface-variant">{me.email}</p>
          </div>
          {me.employee && (
            <Link role="menuitem" href="/profile" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded px-3 py-2 text-body-md text-on-surface hover:bg-surface-container-high">
              <UserRound className="h-4 w-4" /> My profile
            </Link>
          )}
          <Link role="menuitem" href="/change-password" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded px-3 py-2 text-body-md text-on-surface hover:bg-surface-container-high">
            <KeyRound className="h-4 w-4" /> Change password
          </Link>
          <button
            role="menuitem"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-body-md text-error hover:bg-error-container/30"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Stitch header crumb: "NEXVRA / <current page>". */
function HeaderTrail() {
  const trail = navTrail(usePathname() ?? "");
  return (
    <div className="hidden flex-1 items-center gap-space-sm lg:flex">
      <span className="font-headline-sm text-headline-sm font-semibold tracking-tight text-primary">NEXVRA</span>
      <span className="text-on-surface-variant/40">/</span>
      <span className="font-code-mono text-code-mono uppercase text-on-surface-variant">{trail?.label ?? "HRMS"}</span>
    </div>
  );
}

function CountLink({ href, label, count, icon }: { href: string; label: string; count: number; icon: ReactNode }) {
  return (
    <Link
      href={href}
      className="relative rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
      aria-label={count ? `${label}, ${count} unread` : label}
    >
      {icon}
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-[9999px] bg-primary-container px-1 text-[10px] font-bold text-on-primary-fixed">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

function NotificationBell() {
  const count = useNotificationCenter()?.notifications ?? 0;
  return <CountLink href="/notifications" label="Notifications" count={count} icon={<Bell className="h-6 w-6" />} />;
}

function MessagesLink() {
  const count = useNotificationCenter()?.messages ?? 0;
  return <CountLink href="/messages" label="Messages" count={count} icon={<MessageSquare className="h-6 w-6" />} />;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { me, loading, error, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (loading || error) return;
    if (!me) {
      router.replace(`/login${pathname && pathname !== "/dashboard" ? `?next=${encodeURIComponent(pathname)}` : ""}`);
    }
  }, [me, loading, error, pathname, router]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <ErrorState error={error} onRetry={() => void refresh()} />
      </div>
    );
  }
  if (loading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading />
      </div>
    );
  }

  return (
    <ConnectionProvider userId={me.id}>
    <NotificationCenterProvider userId={me.id}>
    <WorkSessionProvider>
    <div className="min-h-screen">
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar me={me} />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <div className="relative h-full w-72 max-w-[85%]">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 z-10 rounded p-1 text-on-surface-variant hover:text-on-surface"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <Sidebar me={me} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64 print:pl-0">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-surface-container-high/40 bg-surface-container-lowest/90 px-space-lg backdrop-blur-xl">
          <button
            className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-6 w-6" />
          </button>
          <HeaderTrail />
          <div className="flex items-center gap-space-sm">
            <AttendanceActions />
            <ConnectionIndicator />
            <span className="hidden rounded-lg border border-surface-container-high bg-surface-container-low px-space-sm py-1 font-label-sm text-label-sm text-primary-fixed 2xl:inline-flex">
              {me.role.name}
            </span>
            <ThemeToggle />
            {me.permissions.includes("messages.use") && <MessagesLink />}
            <NotificationBell />
            <UserMenu me={me} />
          </div>
        </header>
        <OfflineBanner />
        <main className="mx-auto w-full max-w-[1600px] px-margin py-space-xl sm:px-margin-md lg:px-margin-lg">{children}</main>
      </div>
    </div>
    </WorkSessionProvider>
    </NotificationCenterProvider>
    </ConnectionProvider>
  );
}

/** Display guard for whole pages. The API still enforces access independently. */
export function RequirePermission({ perms, children }: { perms: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(...perms)) return <NoAccess />;
  return <>{children}</>;
}
