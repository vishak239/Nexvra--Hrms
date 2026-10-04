"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { ChevronDown, Coffee, Home, Hourglass, LogIn, LogOut, MoreTime, Play, Square, Timer } from "@/components/ui/icons";
import type { Phase } from "@/lib/worksession";
import { useWorkSession, type WorkSessionValue } from "./WorkSessionProvider";

interface ActionItem {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
  busy?: boolean;
}

const PHASE_TEXT: Record<Phase, string> = {
  DISABLED: "Self check-in off",
  NOT_CHECKED_IN: "Not checked in",
  WORKING: "Working",
  ON_BREAK: "On break",
  CHECKED_OUT: "Checked out",
  OVERTIME: "Overtime running",
};

/** The actions that are possible right now, derived from the server state only. */
export function attendanceActions(ws: WorkSessionValue): ActionItem[] {
  const { state, view, busy, online } = ws;
  if (!state) return [];
  const items: ActionItem[] = [];
  const wfh = state.wfh_today;
  const verdict = ws.location.verdict;
  const ot = state.open_overtime_request;
  const wfhRequest: ActionItem = {
    key: "wfh",
    label: "Work from home",
    icon: <Home className="h-4 w-4" />,
    onClick: ws.openWfh,
    disabled: !online,
  };

  switch (view.phase) {
    case "NOT_CHECKED_IN":
      items.push({
        key: "check-in",
        label: "Check in",
        icon: <LogIn className="h-4 w-4" />,
        primary: true,
        busy: busy === "check-in",
        disabled: !online || verdict.kind === "outside",
        title: verdict.kind === "outside" ? "You are outside the workplace check-in area." : undefined,
        onClick: () => {
          ws.requestLocation();
          void ws.checkIn("OFFICE");
        },
      });
      if (wfh?.status === "APPROVED") {
        items.push({
          key: "check-in-wfh",
          label: "WFH check in",
          icon: <Home className="h-4 w-4" />,
          busy: busy === "check-in-wfh",
          disabled: !online,
          onClick: () => void ws.checkIn("WORK_FROM_HOME"),
        });
      } else if (wfh?.status === "PENDING") {
        items.push({ key: "wfh-pending", label: "WFH pending", icon: <Hourglass className="h-4 w-4" />, onClick: () => undefined, disabled: true, title: "Waiting for HR to approve your work-from-home request." });
      } else {
        items.push(wfhRequest);
      }
      break;
    case "WORKING":
      items.push({
        key: "break",
        label: "Break",
        icon: <Coffee className="h-4 w-4" />,
        busy: busy === "BREAK_START",
        disabled: state.break_remaining_seconds === 0,
        title: state.break_remaining_seconds === 0 ? "Break unavailable for the day — your allowance is used." : "Start break",
        onClick: () => void ws.sessionAction("BREAK_START"),
      });
      items.push({
        key: "check-out",
        label: "Check out",
        icon: <LogOut className="h-4 w-4" />,
        primary: true,
        busy: busy === "check-out",
        disabled: !online || view.pendingEvents > 0,
        onClick: ws.requestCheckOut,
      });
      items.push(wfhRequest);
      break;
    case "ON_BREAK":
      items.push({
        key: "end-break",
        label: "End break",
        icon: <Play className="h-4 w-4" />,
        primary: true,
        busy: busy === "BREAK_END",
        onClick: () => void ws.sessionAction("BREAK_END"),
      });
      break;
    case "CHECKED_OUT":
      if (ot?.status === "REQUESTED") {
        items.push({ key: "ot-pending", label: "Overtime pending", icon: <Hourglass className="h-4 w-4" />, onClick: () => undefined, disabled: true, title: "Waiting for HR to approve your overtime request." });
      } else if (ot?.status === "APPROVED") {
        items.push({
          key: "ot-start",
          label: "Start overtime",
          icon: <MoreTime className="h-4 w-4" />,
          primary: true,
          busy: busy === "OVERTIME_START",
          onClick: () => void ws.sessionAction("OVERTIME_START"),
        });
      } else {
        items.push({ key: "ot-request", label: "Overtime", icon: <MoreTime className="h-4 w-4" />, onClick: ws.openOvertime, disabled: !online });
      }
      items.push(wfhRequest);
      break;
    case "OVERTIME":
      items.push({
        key: "ot-stop",
        label: "Stop overtime",
        icon: <Square className="h-4 w-4" />,
        primary: true,
        busy: busy === "OVERTIME_END",
        onClick: () => void ws.sessionAction("OVERTIME_END"),
      });
      break;
    default:
      break;
  }
  return items;
}

/** Top-right attendance controls: inline on wide screens, a compact menu on smaller ones. */
export function AttendanceActions() {
  const ws = useWorkSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (!ws?.enabled || !ws.state || ws.view.phase === "DISABLED") return null;
  const items = attendanceActions(ws);
  const phase = ws.view.phase;
  const dot =
    phase === "WORKING" ? "bg-primary-container" : phase === "ON_BREAK" ? "bg-warning" : phase === "OVERTIME" ? "bg-primary-fixed" : "bg-outline";

  return (
    <div className="flex items-center" data-testid="attendance-actions" data-phase={phase}>
      <div className="hidden items-center gap-1.5 xl:flex" role="group" aria-label="Attendance actions">
        {items.map((a) => (
          <Button
            key={a.key}
            size="sm"
            variant={a.primary ? "primary" : "secondary"}
            icon={a.icon}
            loading={a.busy}
            disabled={a.disabled}
            title={a.title}
            onClick={a.onClick}
          >
            {a.label}
          </Button>
        ))}
      </div>
      <div className="relative xl:hidden" ref={ref}>
        <Button
          size="sm"
          variant="secondary"
          icon={<Timer className="h-4 w-4" />}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Attendance: ${PHASE_TEXT[phase]}`}
          onClick={() => setOpen((o) => !o)}
        >
          <span className={`h-1.5 w-1.5 rounded-[50%] ${dot}`} aria-hidden="true" />
          <span className="hidden sm:inline">Attendance</span>
          <ChevronDown className="h-4 w-4" />
        </Button>
        {open && (
          <div role="menu" className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-surface-container-high bg-surface-container p-1.5">
            <p className="px-3 py-2 font-label-sm text-label-sm uppercase text-on-surface-variant">{PHASE_TEXT[phase]}</p>
            {items.map((a) => (
              <button
                key={a.key}
                role="menuitem"
                disabled={a.disabled || a.busy}
                title={a.title}
                onClick={() => {
                  setOpen(false);
                  a.onClick();
                }}
                className={`flex w-full items-center gap-2 rounded px-3 py-2.5 text-left text-body-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  a.primary ? "font-semibold text-primary-fixed hover:bg-surface-container-high" : "text-on-surface hover:bg-surface-container-high"
                }`}
              >
                {a.icon}
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
