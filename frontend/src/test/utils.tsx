import type { ReactNode } from "react";
import { vi } from "vitest";
import { ToastProvider } from "@/components/ui/Overlay";
import { AuthProvider } from "@/lib/auth";
import type { Me } from "@/lib/types";

export const ME: Me = {
  id: 7,
  email: "employee@example.test",
  username: "demo.employee",
  first_name: "Demo",
  last_name: "Employee",
  full_name: "Demo Employee",
  role: { id: 4, code: "EMPLOYEE", name: "Employee", level: 10 },
  permissions: ["attendance.self", "leave.apply", "payroll.view_own", "documents.view_own", "messages.use"],
  employee: { id: 4, employee_code: "DEMO-004", department: null, designation: null, has_photo: false },
};

export interface MockReply {
  status?: number;
  body?: unknown;
}

export type Route = (url: string, init: RequestInit | undefined) => MockReply | Promise<MockReply> | undefined;

/** Replaces global fetch. Unmatched requests fail loudly so tests never hit the network. */
export function mockFetch(route: Route, me: Me = ME) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    let reply = await route(url, init);
    if (!reply && url.startsWith("/api/auth/session/")) reply = { body: { authenticated: true, user: me } };
    if (!reply) reply = { status: 599, body: { error: { code: "unmocked", message: `No mock for ${url}`, fields: {} } } };
    const status = reply.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <ToastProvider>{children}</ToastProvider>
    </AuthProvider>
  );
}
