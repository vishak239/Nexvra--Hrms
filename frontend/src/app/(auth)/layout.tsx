import type { ReactNode } from "react";
import { NexvraLogo } from "@/components/brand/NexvraLogo";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-surface-container-lowest lg:grid-cols-2">
      <div className="dark relative hidden flex-col justify-between border-r border-surface-container-high/40 bg-black p-12 lg:flex">
        <div className="flex items-center gap-1">
          <NexvraLogo height={56} />
          <div className="-ml-1.5 flex flex-col">
            <span className="font-headline-sm text-headline-sm font-semibold tracking-tight text-primary">NEXVRA</span>
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">Solutions</span>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <NexvraLogo height={320} />
        </div>
        <div className="space-y-2">
          <span className="inline-block rounded bg-surface-container-high px-2 py-0.5 font-code-mono text-code-mono font-semibold uppercase tracking-wider text-primary-fixed">
            HRMS
          </span>
          <p className="font-headline-xl text-headline-xl text-primary">Human Resource Management</p>
          <p className="max-w-md text-body-md text-on-surface-variant">
            Employees, attendance, leave, payroll and documents in one secure place.
          </p>
        </div>
      </div>
      <div className="flex flex-col">
        <div className="dark flex items-center gap-1 border-b border-surface-container-high/40 bg-black px-space-lg py-2 lg:hidden">
          <NexvraLogo height={44} />
          <span className="-ml-1 font-headline-sm text-headline-sm font-semibold tracking-tight text-primary">NEXVRA HRMS</span>
        </div>
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
