import type { PolicyCategory } from "@/lib/types";

/** Mirrors Policy.Category on the server (apps/organization/models.py). */
export const POLICY_CATEGORIES: { value: PolicyCategory; label: string }[] = [
  { value: "WORKING_HOURS", label: "Working hours" },
  { value: "ATTENDANCE", label: "Attendance" },
  { value: "BREAKS", label: "Breaks" },
  { value: "LEAVE", label: "Leave" },
  { value: "HOLIDAYS", label: "Holidays" },
  { value: "CONDUCT", label: "Employee conduct" },
  { value: "COMMUNICATION", label: "Communication" },
  { value: "OTHER", label: "Other" },
];
