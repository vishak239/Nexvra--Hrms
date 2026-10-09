import {
  CalendarCheck,
  Campaign,
  ClipboardCheck,
  Clock,
  CloudOff,
  Coffee,
  FileText,
  Groups,
  Home,
  MessageSquare,
  MoreTime,
  Paperclip,
  Receipt,
  RotateCcw,
  ShieldCheck,
  UserRound,
  Videocam,
  type Icon,
} from "@/components/ui/icons";
import { notificationCategory, type NotificationCategory } from "@/lib/notifications";

interface CategoryStyle {
  icon: Icon;
  label: string;
  /** Icon colour (theme roles: readable in light and dark). The icon shape carries the meaning. */
  tone: string;
}

// Four calm colour families: communication (info), schedules (notice), work (primary-fixed),
// records and system (neutral); security stands out in the error colour.
export const CATEGORY_STYLE: Record<NotificationCategory, CategoryStyle> = {
  message: { icon: MessageSquare, label: "Direct message", tone: "text-info" },
  group: { icon: Groups, label: "Group message", tone: "text-info" },
  file: { icon: Paperclip, label: "File shared", tone: "text-info" },
  meeting: { icon: Videocam, label: "Meeting", tone: "text-notice" },
  leave: { icon: CalendarCheck, label: "Leave", tone: "text-notice" },
  wfh: { icon: Home, label: "Work from home", tone: "text-notice" },
  attendance: { icon: Clock, label: "Attendance", tone: "text-primary-fixed" },
  task: { icon: ClipboardCheck, label: "Task", tone: "text-primary-fixed" },
  overtime: { icon: MoreTime, label: "Overtime", tone: "text-primary-fixed" },
  break: { icon: Coffee, label: "Break", tone: "text-primary-fixed" },
  resume: { icon: RotateCcw, label: "Resume Work", tone: "text-primary-fixed" },
  document: { icon: FileText, label: "Document", tone: "text-on-surface-variant" },
  payslip: { icon: Receipt, label: "Payslip", tone: "text-on-surface-variant" },
  account: { icon: UserRound, label: "Profile", tone: "text-on-surface-variant" },
  security: { icon: ShieldCheck, label: "Security", tone: "text-error" },
  sync: { icon: CloudOff, label: "Offline sync", tone: "text-on-surface-variant" },
  general: { icon: Campaign, label: "Announcement", tone: "text-on-surface-variant" },
};

/** Category icon for a notification type, in a small neutral tile (list rows, panels). */
export function NotificationIcon({ type, size = "md" }: { type: string; size?: "sm" | "md" }) {
  const category = notificationCategory(type);
  const { icon: Glyph, label, tone } = CATEGORY_STYLE[category];
  const box = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const glyph = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  return (
    <span
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-lg bg-surface-container-high ${tone}`}
      data-testid="notification-icon"
      data-category={category}
      title={label}
    >
      <Glyph className={glyph} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

