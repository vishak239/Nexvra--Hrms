// Shapes returned by the Django API (see docs/api.md). Decimals arrive as strings.

export type RoleCode = "SUPER_ADMIN" | "HR_ADMIN" | "MANAGER" | "EMPLOYEE" | (string & {});

export interface Me {
  id: number;
  email: string;
  username: string | null;
  first_name: string;
  last_name: string;
  full_name: string;
  role: { id: number; code: RoleCode; name: string; level: number };
  permissions: string[];
  must_change_password: boolean;
  employee: {
    id: number;
    employee_code: string;
    department: string | null;
    designation: string | null;
    has_photo: boolean;
  } | null;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; fields: Record<string, string[]> };
}

export interface Ref {
  id: number;
  name: string;
}

export interface EmployeeRef {
  id: number;
  employee_code: string;
  full_name: string;
  username?: string | null;
}

export type EmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "INTERN";
export type EmploymentStatus = "ACTIVE" | "PROBATION" | "NOTICE_PERIOD" | "EXITED";

export interface Employee {
  id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string;
  username: string | null;
  department: Ref | null;
  designation: Ref | null;
  manager: EmployeeRef | null;
  employment_type: EmploymentType;
  employment_status: EmploymentStatus;
  joining_date: string;
  has_photo: boolean;
  // confidential (self / HR only)
  phone?: string;
  address?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  emergency_contact_relation?: string;
  exit_date?: string | null;
  role?: RoleCode;
  is_active?: boolean;
}

export interface Department {
  id: number;
  name: string;
  code: string;
  description: string;
  head: number | null;
  head_name: string | null;
  is_active: boolean;
  employee_count: number;
}

export interface Designation {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  employee_count: number;
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
  is_optional: boolean;
}

export interface Company {
  name: string;
  legal_name: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  updated_at: string;
}

export interface CompanySettings {
  timezone: string;
  currency: string;
  working_days: number[] | null;
  work_start_time: string | null;
  work_end_time: string | null;
  late_grace_minutes: number | null;
  break_allowance_minutes: number | null;
  workplace_latitude: string | null;
  workplace_longitude: string | null;
  geofence_radius_m: number;
  geofence_max_accuracy_m: number;
  inactivity_timeout_minutes: number | null;
  overtime_requires_approval: boolean;
  half_day_min_hours: string | null;
  full_day_min_hours: string | null;
  self_attendance_enabled: boolean;
  leave_year_start_month: number | null;
  employee_document_upload_enabled: boolean;
  deactivate_user_on_exit: boolean;
  max_upload_size_mb: number | null;
  updated_at: string;
}

export type AttendanceStatus = "PRESENT" | "HALF_DAY" | "ABSENT";
export type DayStatus = AttendanceStatus | "ON_LEAVE" | "HOLIDAY" | "WEEKLY_OFF" | "NOT_MARKED";

export interface AttendanceRecord {
  id: number;
  employee: EmployeeRef;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: AttendanceStatus;
  is_late: boolean;
  /** Actual working time: session minus breaks. */
  worked_minutes: number | null;
  session_minutes: number | null;
  break_minutes: number;
  total_break_seconds: number;
  /** Break time beyond the daily allowance; null when no allowance is configured. */
  break_over_allowance_minutes: number | null;
  mode: AttendanceMode;
  checkout_reason: CheckoutReason | "";
  check_in_distance_m: number | null;
  check_out_distance_m: number | null;
  last_activity_at: string | null;
  location_issue: string;
  source: "SELF" | "ADMIN";
  remarks: string;
  updated_at: string;
}

export type SessionStatus = "ACTIVE" | "COMPLETED";
export type SessionSource = "ONLINE" | "OFFLINE";

export interface BreakSession {
  id: number;
  employee: EmployeeRef;
  attendance: number;
  date: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  status: SessionStatus;
  end_reason: "" | "MANUAL" | "ALLOWANCE_EXHAUSTED" | "CHECKOUT";
  source: SessionSource;
  created_at: string;
}

export type OvertimeStatus = "REQUESTED" | "APPROVED" | "REJECTED" | "ACTIVE" | "AUTO_STOPPED" | "COMPLETED" | "CANCELLED";

export interface OvertimeSession {
  id: number;
  employee: EmployeeRef;
  attendance: number | null;
  date: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  status: OvertimeStatus;
  trigger: "AFTER_CHECKOUT";
  source: SessionSource;
  tasks: { id: number; title: string; priority: TaskPriority; status: TaskStatus }[];
  work_description: string;
  other_reason: string;
  declaration_confirmed: boolean;
  requested_at: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string;
  end_reason: "" | "MANUAL" | "OVERTIME_INACTIVITY_TIMEOUT" | "EXPIRED";
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AttendanceMode = "OFFICE" | "WORK_FROM_HOME";
export type CheckoutReason = "MANUAL" | "GEO_FENCE_EXIT" | "INACTIVITY_TIMEOUT" | "ADMIN";
export type WfhStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface WorkFromHomeRequest {
  id: number;
  employee: EmployeeRef;
  date: string;
  reason: string;
  remarks: string;
  status: WfhStatus;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string;
  cancelled_at: string | null;
  created_at: string;
}

export interface Workplace {
  configured: boolean;
  latitude: number | null;
  longitude: number | null;
  radius_m: number;
  max_accuracy_m: number;
}

/** GET /api/attendance/today/ - the server-authoritative work session. */
export interface WorkSessionState {
  date: string;
  server_time: string;
  self_attendance_enabled: boolean;
  break_allowance_minutes: number | null;
  /** Server-computed at server_time, including a break in progress. */
  break_used_seconds: number;
  break_remaining_seconds: number | null;
  inactivity_timeout_minutes: number | null;
  heartbeat_seconds: number;
  overtime_requires_approval: boolean;
  workplace: Workplace;
  wfh_today: WorkFromHomeRequest | null;
  open_overtime_request: OvertimeSession | null;
  record: AttendanceRecord | null;
  breaks: BreakSession[];
  active_break: BreakSession | null;
  overtime: OvertimeSession[];
  active_overtime: OvertimeSession | null;
  blocking_tasks: number;
  checkout_exempt: boolean;
}

export type SyncEventType = "BREAK_START" | "BREAK_END" | "OVERTIME_START" | "OVERTIME_END";
export type SyncEventStatus = "APPLIED" | "CONFLICT" | "REJECTED";

export interface SyncEventRecord {
  id: number;
  employee: EmployeeRef | null;
  client_event_id: string;
  event_type: SyncEventType;
  channel: "ONLINE" | "OFFLINE";
  client_timestamp: string | null;
  effective_at: string | null;
  received_at: string;
  status: SyncEventStatus;
  error: string;
}

export interface SyncResult {
  id: string;
  type: SyncEventType;
  status: SyncEventStatus;
  duplicate: boolean;
  error: string;
}

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export interface UserRef {
  id: number;
  full_name: string;
  username: string | null;
}

export interface Task {
  id: number;
  title: string;
  description: string;
  priority: TaskPriority;
  due_date: string | null;
  status: TaskStatus;
  display_status: TaskStatus | "OVERDUE";
  is_overdue: boolean;
  requires_response: boolean;
  assigned_to: EmployeeRef;
  assigned_by: UserRef | null;
  acknowledged_at: string | null;
  response: string;
  responded_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string;
  created_at: string;
  updated_at: string;
  is_blocking: boolean;
  is_assignee: boolean;
  can_manage: boolean;
  responses?: { id: number; author: UserRef | null; message: string; created_at: string }[];
}

export interface AssigneeLookup {
  looked_up_by: "employee_code" | "username";
  employee: EmployeeRef & { department: string | null; designation: string | null; is_self: boolean };
}

export interface Person {
  user_id: number;
  full_name: string;
  username: string | null;
  employee_id: number | null;
  employee_code: string | null;
  designation: string | null;
  department: string | null;
  has_photo: boolean;
}

export interface Conversation {
  id: number;
  other: Person | null;
  unread_count: number;
  last_message_at: string | null;
  last_message: {
    id: number;
    body: string;
    is_mine: boolean;
    attachment_count: number;
    created_at: string;
  } | null;
  created_at: string;
}

export interface MessageAttachment {
  id: number;
  original_filename: string;
  content_type: string;
  size: number;
  created_at: string;
  download_url: string;
}

export interface ChatMessage {
  id: number;
  conversation: number;
  sender_id: number | null;
  body: string;
  attachments: MessageAttachment[];
  created_at: string;
  is_mine: boolean;
}

export interface LeaveType {
  id: number;
  name: string;
  code: string;
  description: string;
  is_paid: boolean;
  annual_allocation: string | null;
  tracks_balance: boolean;
  allow_half_day: boolean;
  is_active: boolean;
}

export interface LeaveBalance {
  id: number;
  employee: number;
  employee_detail: EmployeeRef;
  leave_type: number;
  leave_type_name: string;
  year: number;
  allocated: string;
  used: string | null;
  pending: string | null;
  available: string | null;
}

export interface MyBalance {
  leave_type: number;
  leave_type_name: string;
  is_paid: boolean;
  allow_half_day: boolean;
  tracks_balance: boolean;
  has_allocation?: boolean;
  allocated?: string;
  used?: string;
  pending?: string;
  /** The balance itself: allocated minus approved (deducted) days. Pending requests do not reduce it. */
  available?: string;
  /** What can still be requested: available minus pending. */
  requestable?: string;
}

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface LeaveRequest {
  id: number;
  employee: EmployeeRef;
  leave_type: number;
  leave_type_name: string;
  start_date: string;
  end_date: string;
  is_half_day: boolean;
  half_day_period: "FIRST" | "SECOND" | "";
  days: string;
  leave_year: number;
  reason: string;
  status: LeaveStatus;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string;
  cancelled_at: string | null;
  created_at: string;
  can_decide: boolean;
  /** Only the applicant, only while pending. */
  can_cancel: boolean;
  /** Approved leave is locked. */
  is_locked: boolean;
  balance_deducted: string | null;
}

export interface LeaveBalanceTransaction {
  id: number;
  employee: EmployeeRef;
  leave_type_name: string;
  year: number;
  kind: "DEDUCTION";
  days: string;
  balance_before: string;
  balance_after: string;
  leave_request: { id: number; start_date: string; end_date: string; status: LeaveStatus };
  created_by_name: string | null;
  created_at: string;
}

export type ComponentKind = "EARNING" | "DEDUCTION";

export interface PayComponent {
  id: number;
  name: string;
  code: string;
  kind: ComponentKind;
  is_active: boolean;
}

export interface SalaryStructure {
  id: number;
  employee: number;
  employee_detail: EmployeeRef;
  effective_from: string;
  notes: string;
  items: { component: number; name: string; code: string; kind: ComponentKind; amount: string }[];
  gross_earnings: string;
  total_deductions: string;
  net_pay: string;
  created_at: string;
}

export interface PayrollRun {
  id: number;
  year: number;
  month: number;
  status: "DRAFT" | "FINALIZED";
  currency: string;
  payslip_count: number;
  total_net: string | null;
  created_at: string;
  finalized_at: string | null;
}

export interface PayslipItem {
  id: number;
  name: string;
  kind: ComponentKind;
  amount: string;
  source: "STRUCTURE" | "ADJUSTMENT";
}

export interface Payslip {
  id: number;
  run: number;
  year: number;
  month: number;
  run_status: "DRAFT" | "FINALIZED";
  currency: string;
  employee: EmployeeRef & { department: string | null; designation: string | null };
  gross_earnings: string;
  total_deductions: string;
  net_pay: string;
  items: PayslipItem[];
}

export type DocumentCategory =
  | "OFFER_LETTER"
  | "APPOINTMENT_LETTER"
  | "CERTIFICATE"
  | "ID_DOCUMENT"
  | "PAYSLIP"
  | "EXPERIENCE_LETTER"
  | "RELIEVING_LETTER"
  | "OTHER";

export interface EmployeeDocument {
  id: number;
  employee: number;
  employee_detail: EmployeeRef;
  category: DocumentCategory;
  title: string;
  original_filename: string;
  content_type: string;
  size: number;
  visible_to_employee?: boolean;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  entity_type: string;
  entity_id: string;
  link: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface Role {
  id: number;
  code: RoleCode;
  name: string;
  level: number;
  is_system: boolean;
  permissions: string[];
  user_count: number;
}

export interface Permission {
  id: number;
  codename: string;
  description: string;
}

export interface UserAccount {
  id: number;
  email: string;
  username: string | null;
  first_name: string;
  last_name: string;
  full_name: string;
  role: RoleCode;
  is_active: boolean;
  must_change_password: boolean;
  employee_id: number | null;
  date_joined: string;
  last_login: string | null;
}

export interface AuditLog {
  id: number;
  actor: number | null;
  actor_email: string;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: Record<string, unknown>;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string;
  created_at: string;
}

export interface Dashboard {
  date: string;
  unread_notifications: number;
  upcoming_holidays: Holiday[];
  me?: {
    attendance_today: AttendanceRecord | null;
    self_attendance_enabled: boolean;
    leave_year: number;
    leave_balances: (MyBalance & { leave_type: string })[];
    pending_leave_requests: number;
    open_tasks: number;
    blocking_tasks: number;
    latest_payslip: { id: number; year: number; month: number; net_pay: string; currency: string } | null;
  };
  pending_approvals?: number;
  attendance_today?: { total: number; by_status: Partial<Record<DayStatus, number>>; late: number };
  headcount?: number;
  team_size?: number;
  latest_payroll_run?: { id: number; year: number; month: number; status: string } | null;
  unread_messages?: number;
  work_sessions_now?: { on_break: number; overtime_running: number };
  tasks_overview?: { open: number; overdue: number; awaiting_response: number };
}

export type PolicyCategory =
  | "WORKING_HOURS"
  | "ATTENDANCE"
  | "BREAKS"
  | "LEAVE"
  | "HOLIDAYS"
  | "CONDUCT"
  | "COMMUNICATION"
  | "OTHER";

export interface Policy {
  id: number;
  title: string;
  category: PolicyCategory;
  category_label: string;
  body: string;
  effective_date: string | null;
  is_published: boolean;
  updated_by_name: string | null;
  created_at: string;
  updated_at: string;
}
