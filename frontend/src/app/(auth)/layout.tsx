import type { ReactNode } from "react";
import { NexvraLogo } from "@/components/brand/NexvraLogo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-black p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <NexvraLogo height={64} />
          <div className="-ml-2 leading-tight">
            <p className="text-base font-semibold tracking-wide">NEXVRA</p>
            <p className="text-xs font-medium tracking-[0.25em] text-nexvra-gray">SOLUTIONS</p>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <NexvraLogo height={320} />
        </div>
        <div>
          <p className="text-2xl font-semibold tracking-tight">Human Resource Management</p>
          <p className="mt-2 max-w-md text-sm text-zinc-400">
            Employees, attendance, leave, payroll and documents in one secure place.
          </p>
        </div>
      </div>
      <div className="flex flex-col bg-white">
        <div className="flex items-center gap-2 bg-black px-6 py-3 lg:hidden">
          <NexvraLogo height={44} />
          <p className="-ml-1 text-sm font-semibold tracking-wide text-white">NEXVRA HRMS</p>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
