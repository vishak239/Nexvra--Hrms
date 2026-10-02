// Shapes returned by the Django API (see docs/api.md). Decimals arrive as strings.

export type RoleCode = "SUPER_ADMIN" | "HR_ADMIN" | "MANAGER" | "EMPLOYEE" | (string & {});

export interface Me {
  id: number;
  email: string;
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
  worked_minutes: number | null;
  source: "SELF" | "ADMIN";
  remarks: string;
  updated_at: string;
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
  available?: string;
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
    latest_payslip: { id: number; year: number; month: number; net_pay: string; currency: string } | null;
  };
  pending_approvals?: number;
  attendance_today?: { total: number; by_status: Partial<Record<DayStatus, number>>; late: number };
  headcount?: number;
  team_size?: number;
  latest_payroll_run?: { id: number; year: number; month: number; status: string } | null;
}
