# Requirements Analysis

## Sources

| ID | Source | Description |
|---|---|---|
| **BRIEF** | The project brief from the owner (master implementation prompt, 2026-10-01) | Scope, modules, roles, stack, security and testing requirements |
| **OWNER-Q** | Owner answers during inspection (2026-10-01) | No HR policy documents exist; the Stitch export and logo SVG will be supplied; PostgreSQL to be installed locally |

No other requirements documents, HR policies, or company data were supplied (see `project-inventory.md`).

**Rule applied throughout:** anything the sources do not state is marked **NOT SPECIFIED — CONFIGURABLE**. It is stored as an editable setting or record, and is either left empty or disabled until an administrator configures it. No company policy has been invented.

---

## 1. Extracted company facts

| Item | Value | Source |
|---|---|---|
| Company name | Nexvra Solutions | BRIEF |
| Brand colours | Lime `#9CFF00`, Black `#000000`, White `#FFFFFF`, Gray `#A0A0A0` | BRIEF §4 |
| Logo | Official SVG (awaited); PNG available now | BRIEF §4, OWNER-Q |
| Registered address, legal name, tax IDs | NOT SPECIFIED — CONFIGURABLE (Company profile) | — |
| Departments | NOT SPECIFIED — CONFIGURABLE (created by admins) | — |
| Designations | NOT SPECIFIED — CONFIGURABLE (created by admins) | — |
| Working days | NOT SPECIFIED — CONFIGURABLE | — |
| Working hours | NOT SPECIFIED — CONFIGURABLE | — |
| Time zone | NOT SPECIFIED — CONFIGURABLE (starts from the server `TIME_ZONE` env value) | — |
| Currency | NOT SPECIFIED — CONFIGURABLE | — |
| Holidays | NOT SPECIFIED — CONFIGURABLE (holiday calendar) | — |
| Leave types and quotas | NOT SPECIFIED — CONFIGURABLE | — |
| Payroll components | NOT SPECIFIED — CONFIGURABLE | — |
| Statutory deductions (PF/ESI/TDS/PT) | NOT SPECIFIED. **Not implemented** (BRIEF §16 forbids assuming them) | BRIEF §16 |

---

## 2. Requirements by module

Columns: **Req**, **Source**, **DB impact**, **UI impact**, **API impact**, **Permission impact**, **Business rule**, **Open question**.

### 2.1 Authentication (BRIEF §12)

| Req | DB | UI | API | Permission | Business rule | Open question |
|---|---|---|---|---|---|---|
| Login / logout | `User` (email login, hashed password) | Login page | `POST /api/auth/login/`, `POST /api/auth/logout/`, `GET /api/auth/me/` | Public login; everything else needs an authenticated session | Only active users can log in. Failed logins are audited and rate-limited. | — |
| Password hashing | Django PBKDF2 (default hasher) | — | — | — | Never store plain-text passwords | — |
| Session/token strategy | Django sessions table | Cookies handled by the browser | CSRF endpoint `GET /api/auth/csrf/` | — | HttpOnly session cookie + CSRF token (see architecture.md) | — |
| Password reset | Stateless signed tokens (no table) | Forgot / reset pages | `POST /api/auth/password-reset/`, `POST /api/auth/password-reset/confirm/`, `POST /api/auth/change-password/` | Public reset request; the response never reveals whether an email exists | Token expiry uses Django `PASSWORD_RESET_TIMEOUT` (env-configurable) | Email provider: NOT SPECIFIED — CONFIGURABLE (SMTP env vars; console backend in dev) |
| Account status | `User.is_active`, `Employee.employment_status` | Status badges | Admin can activate/deactivate | `users.manage` / `employees.manage` | Inactive users cannot log in. Existing sessions are rejected on their next request. | Whether exit automatically deactivates the login: NOT SPECIFIED — CONFIGURABLE (`deactivate_user_on_exit`, default off) |
| Password policy | — | Error messages | Validation errors | — | Django's default validators (minimum length 8, not common, not numeric, not similar to email) | Company-specific password rules: NOT SPECIFIED. Technical defaults are used. |

### 2.2 Company & Settings (BRIEF §6, §9)

| Req | DB | UI | API | Permission | Business rule | Open question |
|---|---|---|---|---|---|---|
| Company profile | `Company` (singleton) | Settings → Company | `GET/PATCH /api/company/` | View: any authenticated user. Edit: `company.manage` | One company per deployment (internal HRMS) | — |
| Policy settings | `CompanySettings` (singleton, nullable fields) | Settings → Policies | `GET/PATCH /api/settings/` | View: authenticated. Edit: `settings.manage` | Empty value = rule not applied | Every value: NOT SPECIFIED — CONFIGURABLE |

### 2.3 Users, Roles & Permissions (BRIEF §7)

| Req | DB | UI | API | Permission | Business rule | Open question |
|---|---|---|---|---|---|---|
| Roles SUPER_ADMIN, HR_ADMIN, MANAGER, EMPLOYEE | `Role` (code, name, level, is_system) | Roles page | `GET /api/roles/`, `PATCH /api/roles/{id}/` (permissions) | `roles.view`, `roles.manage` | The 4 system roles are seeded by migration and can't be deleted | Extra custom roles: SHOULD HAVE (the model supports them) |
| Permission model | `Permission` (codename), `Role.permissions` M2M | Permission matrix | `GET /api/permissions/` | `roles.view` | Permissions are checked server-side on every request. The frontend only reads `me.permissions` for display. | — |
| User management | `User.role` FK | Users page | `/api/users/` CRUD | `users.view`, `users.manage` | **No privilege escalation:** a user can assign only roles with a lower `level` than their own (SUPER_ADMIN excepted), and can never change their own role | — |

### 2.4 Departments & Designations (BRIEF §6, §8)

| Req | DB | UI | API | Permission | Business rule | Open question |
|---|---|---|---|---|---|---|
| Departments | `Department` (name unique, code unique, head FK Employee, is_active) | Departments page | `/api/departments/` | View: authenticated. Manage: `departments.manage` | A department with employees can't be deleted, only deactivated | Department list: NOT SPECIFIED — CONFIGURABLE |
| Designations | `Designation` (name unique, is_active) | Designations page | `/api/designations/` | View: authenticated. Manage: `designations.manage` | Same as departments | Designation list: NOT SPECIFIED — CONFIGURABLE |

### 2.5 Employees & Profiles (BRIEF §13)

| Req | DB | UI | API | Permission | Business rule | Open question |
|---|---|---|---|---|---|---|
| Employee record | `Employee` 1:1 `User`. Fields: employee_code (unique), phone, joining_date, department, designation, manager (self FK), employment_type, employment_status, exit_date, address, emergency contact (name/phone/relation), profile photo | Employee list, create/edit form, profile | `/api/employees/` CRUD, `/api/employees/me/`, `/api/employees/{id}/photo/` | `employees.view_all` (HR), `employees.view_team` (manager, direct reports only), own record always. `employees.manage` to create/update. | Name and email live on `User` only (no duplication). DOB, gender, marital status, national IDs etc. are **not collected** (BRIEF §13: no unnecessary personal data). | Employee ID format / auto-numbering: NOT SPECIFIED. HR enters it manually; it must be unique. |
| Self-service contact details | — | My profile edit | `PATCH /api/employees/me/` | Own record only | Employees may edit only phone, address and emergency contact; everything else is HR-managed | — |
| Role-aware profile | — | Fields hidden by role | Different serializers per viewer | Confidential fields (phone, address, emergency contact) go only to self, HR, and super admin. Managers get basic fields for their team. | Employees see only their own record. There's no company directory in V1. | Company-wide staff directory: LATER |
| Employment types | Enum: FULL_TIME, PART_TIME, CONTRACT, INTERN | Select | — | — | Generic classification, not a policy | — |
| Employment status | Enum: ACTIVE, PROBATION, NOTICE_PERIOD, EXITED | Badge | — | — | Probation length and notice period length: not modelled | Probation/notice durations: NOT SPECIFIED — CONFIGURABLE (later) |

### 2.6 Attendance (BRIEF §14)

| Req | DB | UI | API | Permission | Business rule | Open question |
|---|---|---|---|---|---|---|
| Check-in / check-out | `AttendanceRecord` (employee, date, check_in, check_out, status, is_late, source, remarks). Unique (employee, date) | Check-in widget, my attendance | `POST /api/attendance/check-in/`, `POST /api/attendance/check-out/`, `GET /api/attendance/today/` | Own records: any employee with `attendance.self` | One record per employee per day (company time zone). Check-out must be after check-in. | Whether employees self-check-in at all: NOT SPECIFIED — CONFIGURABLE (`self_attendance_enabled`) |
| Late status | `is_late` | Badge | — | — | Late only if `work_start_time` **and** `late_grace_minutes` are both configured | Grace period: NOT SPECIFIED — CONFIGURABLE |
| Half-day | status HALF_DAY | Badge | — | — | Computed only if `half_day_min_hours` / `full_day_min_hours` are configured. Otherwise a day with a check-in is PRESENT. | Thresholds: NOT SPECIFIED — CONFIGURABLE |
| Absence | Derived (no stored row needed) | Calendar / report | Report endpoint | — | A configured working day that isn't a holiday, has no approved leave and no record is ABSENT in reports. If working days aren't configured, absences aren't computed. | Working days: NOT SPECIFIED — CONFIGURABLE |
| History, team, HR management | — | Tables with date filters | `GET /api/attendance/` (scoped), `POST/PATCH /api/attendance/` | `attendance.view_team`, `attendance.view_all`, `attendance.manage` (HR corrections, audited) | Corrections are recorded with `source=ADMIN` and audited | Regularisation request workflow: SHOULD HAVE / later |

### 2.7 Leave & Holidays (BRIEF §15)

| Req | DB | UI | API | Permission | Business rule | Open question |
|---|---|---|---|---|---|---|
| Leave types | `LeaveType` (name, code, is_paid, annual_allocation nullable, allow_half_day, requires_reason, is_active) | Settings → Leave types | `/api/leaves/types/` | `leave.manage_types` | **None seeded in production.** Demo data only, clearly marked demo. | Which leave types exist, quotas, paid/unpaid: NOT SPECIFIED — CONFIGURABLE |
| Leave balances | `LeaveBalance` (employee, leave_type, year, allocated). Used and pending are computed from requests, not stored. | My balances; HR balance admin | `/api/leaves/balances/` | Own; `leave.view_all`; `leave.manage_balances` | Balance per leave year (calendar year unless `leave_year_start_month` is set). A request is rejected if it exceeds available balance, **only** when the type has an allocation. | Carry-forward, encashment, accrual, negative balance: NOT SPECIFIED. Not implemented; HR adjusts allocations manually. |
| Leave requests | `LeaveRequest` (employee, type, start, end, half_day, half, days, reason, status, decided_by, decided_at, decision_note) | Apply form, my requests | `/api/leaves/requests/`, `.../{id}/approve/`, `.../{id}/reject/`, `.../{id}/cancel/` | Apply: `leave.apply` (own only). Approve: `leave.approve_team` (direct reports) or `leave.approve_all` (HR). | No overlapping pending/approved requests. Nobody can approve their own request. Days = configured working days minus holidays in the range (calendar days if working days aren't configured). Only the employee can cancel; pending requests can always be cancelled, approved ones only before their start date. | Sandwich rule, notice period for applying, max consecutive days, back-dated limit: NOT SPECIFIED. Not implemented. |
| Approval flow | — | Approvals inbox | — | — | BRIEF names "manager approval" + "HR administration": the direct manager can approve, and HR can approve any request | Multi-level approval: LATER |
| Holidays | `Holiday` (date, name, is_optional). Unique (date, name) | Holiday calendar | `/api/holidays/` | View: authenticated. Manage: `holidays.manage` | Excluded from leave day counts and absence computation | Holiday list: NOT SPECIFIED — CONFIGURABLE |

### 2.8 Payroll (BRIEF §16)

| Req | DB | UI | API | Permission | Business rule | Open question |
|---|---|---|---|---|---|---|
| Salary structure | `PayComponent` (name, code, kind EARNING/DEDUCTION), `SalaryStructure` (employee, effective_from), `SalaryStructureItem` (component, monthly amount) | Employee → Salary | `/api/payroll/components/`, `/api/payroll/salary-structures/` | `payroll.manage` (HR, super admin) | The latest structure with effective_from ≤ period end applies | Component list: NOT SPECIFIED — CONFIGURABLE |
| Payroll period | `PayrollRun` (year, month, status DRAFT/FINALIZED). Unique (year, month) | Payroll runs page | `/api/payroll/runs/`, `.../{id}/generate/`, `.../{id}/finalize/` | `payroll.manage` | V1 supports monthly periods | Pay frequency: NOT SPECIFIED. Monthly is the V1 technical scope; confirm. |
| Gross / deductions / net | `Payslip` (gross, total_deductions, net) + `PayslipItem` (snapshot of name/kind/amount) | Payslip view | `/api/payroll/payslips/` | Own: `payroll.view_own` (finalized only). All: `payroll.view_all`. | gross = Σ earnings, net = gross − Σ deductions. **No statutory deductions. No automatic proration or loss-of-pay.** HR may add manual adjustment lines while DRAFT. Finalized runs are immutable. | Proration for mid-month joiners/leavers, LOP for unpaid leave, statutory deductions, rounding: NOT SPECIFIED. Not implemented. |
| Payroll history | Runs + payslips | History tables | List endpoints | As above | — | — |

### 2.9 Documents (BRIEF §17)

| Req | DB | UI | API | Permission | Business rule | Open question |
|---|---|---|---|---|---|---|
| Controlled documents | `EmployeeDocument` (employee, category, title, file in private storage, original_filename, content_type, size, uploaded_by, visible_to_employee) | Documents tab | `/api/documents/` list/upload, `/api/documents/{id}/download/` | Own (visible only): any employee. All: `documents.view_all`. Upload/delete: `documents.manage`. | Files are never served from a public URL. Downloads stream through an authorised endpoint. Extension allowlist + magic-byte check + size limit. | Whether employees may upload their own docs: NOT SPECIFIED — CONFIGURABLE (`employee_document_upload_enabled`, default off). Retention period: NOT SPECIFIED. |
| Categories | Enum: OFFER_LETTER, APPOINTMENT_LETTER, CERTIFICATE, ID_DOCUMENT, PAYSLIP, EXPERIENCE_LETTER, RELIEVING_LETTER, OTHER | Filter | — | — | List taken from BRIEF §17 | — |

### 2.10 Reports, Notifications, Audit, Dashboards (BRIEF §6, §18)

| Req | DB | UI | API | Permission | Business rule | Open question |
|---|---|---|---|---|---|---|
| Reports | None (computed) | Reports page | `/api/reports/headcount/`, `/attendance-summary/`, `/leave-summary/`, `/payroll-summary/` | `reports.view_all` (HR), `reports.view_team` (manager, own team only) | Payroll report needs `payroll.view_all` | Specific report formats: NOT SPECIFIED. V1 provides these four + CSV export. |
| Notifications | `Notification` (recipient, type, title, message, entity, is_read) | Bell + list | `/api/notifications/`, `mark-read`, `mark-all-read` | Own only | Created on: leave submitted (to manager), leave decided (to employee), payslip published, document shared | Email delivery: SHOULD HAVE (SMTP config) |
| Audit logs | `AuditLog` (actor, actor_email snapshot, action, entity_type, entity_id, changes, metadata, ip, user_agent, created_at) | Audit log page | `GET /api/audit-logs/` (read-only) | `audit.view` (SUPER_ADMIN only) | Append-only: there's no update/delete API, and the Django admin is read-only. IP + user agent are recorded for security traceability. | Log retention period: NOT SPECIFIED — CONFIGURABLE (later) |
| Dashboards | — | Role-aware dashboard | `GET /api/dashboard/` | Content varies by permissions | Shows only real data. No fake statistics. | — |

---

## 3. Policy settings (all NOT SPECIFIED — CONFIGURABLE)

Stored in `CompanySettings`. An empty value means the dependent rule is **not applied**.

| Setting | Type | Empty means | Used by |
|---|---|---|---|
| `timezone` | IANA tz | Server `TIME_ZONE` | Attendance date boundaries |
| `currency` | ISO 4217 code | Amounts shown without a currency | Payroll |
| `working_days` | list of weekdays 0–6 | No weekend/absence logic; leave counts calendar days | Attendance, leave |
| `work_start_time` / `work_end_time` | time | No late detection | Attendance |
| `late_grace_minutes` | int | No late detection | Attendance |
| `half_day_min_hours` / `full_day_min_hours` | decimal | Any check-in = PRESENT | Attendance |
| `self_attendance_enabled` | bool | — (technical default **on**, so the check-in feature works) | Attendance |
| `leave_year_start_month` | 1–12 | Calendar year (January) | Leave balances |
| `employee_document_upload_enabled` | bool | — (default **off**, the secure default) | Documents |
| `deactivate_user_on_exit` | bool | — (default **off**) | Employees |
| `max_upload_size_mb` | int | 10 MB technical limit | Documents, photos |

## 4. Open questions for Nexvra HR

1. Working days and hours, late grace, and half-day thresholds?
2. Leave types, annual allocations, paid/unpaid, carry-forward, accrual, sandwich rule?
3. Leave approval: is the direct manager enough, or is manager → HR two-level approval needed?
4. Pay frequency (monthly assumed for V1), salary components, proration, loss-of-pay for unpaid leave?
5. Statutory deductions (PF/ESI/TDS/PT): required? If so, which state rules apply?
6. Employee ID format and auto-numbering?
7. Can employees see a company directory (names/designations of colleagues)?
8. Should employees be allowed to upload their own documents?
9. Document and audit-log retention periods?
10. Email provider for notifications and password resets?
