"use client";

import { Bell, KeyRound, LogOut, Menu, MessageSquare, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { NexvraLogo } from "@/components/brand/NexvraLogo";
import { ConnectionIndicator, OfflineBanner } from "@/components/connection/ConnectionIndicator";
import { Avatar } from "@/components/ui/Display";
import { ErrorState, Loading, NoAccess } from "@/components/ui/States";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ConnectionProvider } from "@/lib/connection";
import { visibleNav } from "@/lib/nav";
import type { Me } from "@/lib/types";

function Sidebar({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col bg-black text-zinc-300">
      <div className="flex h-20 items-center px-4">
        <Link href="/dashboard" onClick={onNavigate} className="flex items-center gap-1" aria-label="Nexvra HRMS home">
          <NexvraLogo height={56} />
          <div className="-ml-2 leading-tight">
            <p className="text-sm font-semibold tracking-wide text-white">NEXVRA</p>
            <p className="text-[11px] font-medium tracking-[0.2em] text-nexvra-gray">HRMS</p>
          </div>
        </Link>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6 pt-2" aria-label="Main">
        {visibleNav(me).map((section) => (
          <div key={section.title}>
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{section.title}</p>
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
                      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active ? "bg-zinc-900 text-white" : "text-zinc-400 hover:bg-zinc-900/60 hover:text-white"
                      }`}
                    >
                      <span
                        className={`h-4 w-0.5 rounded-full ${active ? "bg-nexvra-lime" : "bg-transparent"}`}
                        aria-hidden="true"
                      />
                      <Icon className={`h-4 w-4 ${active ? "text-nexvra-lime" : ""}`} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-zinc-900 px-5 py-4 text-xs text-zinc-500">Nexvra Solutions</div>
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
        className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-zinc-100"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Avatar name={me.full_name || me.email} src={photo} size={32} />
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium text-zinc-900">{me.full_name || me.email}</span>
          <span className="block text-xs text-zinc-500">{me.role.name}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg">
          <div className="border-b border-zinc-100 px-3 py-2">
            <p className="truncate text-sm font-medium text-zinc-900">{me.full_name}</p>
            <p className="truncate text-xs text-zinc-500">{me.email}</p>
          </div>
          {me.employee && (
            <Link role="menuitem" href="/profile" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50">
              <UserRound className="h-4 w-4" /> My profile
            </Link>
          )}
          <Link role="menuitem" href="/change-password" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50">
            <KeyRound className="h-4 w-4" /> Change password
          </Link>
          <button
            role="menuitem"
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** Unread count, refreshed on navigation and when the window regains focus (no polling). */
function useUnreadCount(path: string) {
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ count: number }>(path)
        .then((r) => alive && setCount(r.count))
        .catch(() => undefined);
    void load();
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      window.removeEventListener("focus", load);
    };
  }, [path, pathname]);
  return count;
}

function CountLink({ href, label, count, icon }: { href: string; label: string; count: number; icon: ReactNode }) {
  return (
    <Link
      href={href}
      className="relative rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
      aria-label={count ? `${label}, ${count} unread` : label}
    >
      {icon}
      {count > 0 && (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-nexvra-lime px-1 text-[10px] font-bold text-black">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}

function NotificationBell() {
  const count = useUnreadCount("/api/notifications/unread-count/");
  return <CountLink href="/notifications" label="Notifications" count={count} icon={<Bell className="h-5 w-5" />} />;
}

function MessagesLink() {
  const count = useUnreadCount("/api/messages/unread-count/");
  return <CountLink href="/messages" label="Messages" count={count} icon={<MessageSquare className="h-5 w-5" />} />;
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
    } else if (me.must_change_password && pathname !== "/change-password") {
      router.replace("/change-password");
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
              className="absolute right-3 top-3 z-10 rounded-md p-1 text-zinc-400 hover:text-white"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
            <Sidebar me={me} onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      <div className="lg:pl-64 print:pl-0">
        <header className="no-print sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
          <button
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 sm:gap-2">
            <ConnectionIndicator />
            {me.permissions.includes("messages.use") && <MessagesLink />}
            <NotificationBell />
            <UserMenu me={me} />
          </div>
        </header>
        <OfflineBanner />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
    </ConnectionProvider>
  );
}

/** Display guard for whole pages. The API still enforces access independently. */
export function RequirePermission({ perms, children }: { perms: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(...perms)) return <NoAccess />;
  return <>{children}</>;
}
