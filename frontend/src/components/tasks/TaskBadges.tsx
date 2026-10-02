import { Badge } from "@/components/ui/Display";
import { humanize } from "@/lib/format";
import type { Task, TaskPriority } from "@/lib/types";

const STATUS_TONE = {
  PENDING: "amber",
  IN_PROGRESS: "blue",
  COMPLETED: "green",
  CANCELLED: "neutral",
  OVERDUE: "red",
} as const;

export function TaskStatusBadge({ task }: { task: Pick<Task, "display_status"> }) {
  return <Badge tone={STATUS_TONE[task.display_status]}>{humanize(task.display_status)}</Badge>;
}

const PRIORITY_TONE: Record<TaskPriority, "neutral" | "blue" | "amber" | "red"> = {
  LOW: "neutral",
  MEDIUM: "blue",
  HIGH: "amber",
  URGENT: "red",
};

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <Badge tone={PRIORITY_TONE[priority]}>{humanize(priority)}</Badge>;
}

export const PRIORITIES: TaskPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];

export function handleOf(person: { username?: string | null; full_name: string }) {
  return person.username ? `@${person.username}` : person.full_name;
}
