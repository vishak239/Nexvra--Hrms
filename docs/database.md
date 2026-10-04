# Database

PostgreSQL 16, accessed only through the Django ORM. All schema changes are made with Django migrations (`backend/apps/*/migrations/`). Seed data created by migrations is limited to what the brief specifies: the 4 roles, the permission catalogue, and the company name. Policy settings start empty.

## Entity overview

```
Company (singleton)        CompanySettings (singleton, HR policy, all optional)

Permission ──< Role.permissions >── Role ──< User ──1:1── Employee ──< Employee (manager → direct_reports)
                                                             │  ├─> Department (PROTECT)    Department.head → Employee
                                                             │  └─> Designation (PROTECT)
                                                             ├──< AttendanceRecord
                                                             ├──< LeaveBalance >── LeaveType
                                                             ├──< LeaveRequest >── LeaveType
                                                             ├──< SalaryStructure ──< SalaryStructureItem >── PayComponent
                                                             ├──< Payslip ──< PayslipItem          Payslip >── PayrollRun
                                                             ├──< EmployeeDocument
                                                             ├──< Task ──< TaskResponse        (Task.assigned_by → User)
                                                             ├──< OvertimeSession
                                                             └──< BreakSession >── AttendanceRecord
LeaveBalance ──< LeaveBalanceTransaction ──1:1── LeaveRequest
User ──< SyncEvent        User >── ConversationParticipant ──< Conversation ──< Message ──< MessageAttachment
User ──< Notification            AuditLog (actor → User, SET_NULL)            Holiday
```

## Tables

### accounts
| Model | Key fields | Constraints / indexes |
|---|---|---|
| `Permission` | `codename`, `description` | `codename` unique |
| `Role` | `code`, `name`, `level`, `is_system`, `permissions` (M2M) | `code`, `name` unique |
| `User` | `email` (login), `username` (public @handle, lower-case, generated from the email when not given), `first_name`, `last_name`, `role` FK (PROTECT), `is_active`, `is_staff`, `must_change_password`, `password` (PBKDF2 hash), `last_login`, `date_joined` | `email` unique + `UniqueConstraint(Lower(email))`; emails are stored lower-case; `username` unique |

### organization
| Model | Key fields | Constraints |
|---|---|---|
| `Company` | `name`, `legal_name`, `email`, `phone`, `website`, `address` | `CHECK id = 1` (singleton) |
| `CompanySettings` | see api.md "settings fields" (incl. `break_allowance_minutes`, 1–480 or empty) | `CHECK id = 1`; `half_day_min_hours < full_day_min_hours` when both set |
| `Department` | `name`, `code`, `description`, `head` FK Employee (SET_NULL), `is_active` | `name`, `code` unique |
| `Designation` | `name`, `description`, `is_active` | `name` unique |
| `Holiday` | `date`, `name`, `is_optional` | unique (`date`, `name`); index on `date` |
| `Policy` | `title`, `category`, `body`, `effective_date`, `is_published`, `created_by`/`updated_by` FK User (SET_NULL) | unique `lower(title)`; index (`is_published`, `category`) |

### employees
| Model | Key fields | Constraints |
|---|---|---|
| `Employee` | `user` 1:1 (PROTECT), `employee_code`, `phone`, `joining_date`, `exit_date`, `department`/`designation` FK (PROTECT), `manager` self-FK (SET_NULL), `employment_type`, `employment_status`, `address`, `emergency_contact_name/phone/relation`, `photo` (private file) | `employee_code` unique; `CHECK manager ≠ self`; `CHECK exit_date ≥ joining_date`; index on `employment_status` |

Name and email are **not** duplicated on Employee; they live on User.

### attendance
| Model | Key fields | Constraints |
|---|---|---|
| `AttendanceRecord` | `employee`, `date`, `check_in`, `check_out`, `status` (PRESENT/HALF_DAY/ABSENT), `is_late`, `source` (SELF/ADMIN), `remarks`, `total_break_seconds` (server-maintained), `mode` (OFFICE/WORK_FROM_HOME), `wfh_request` FK (SET_NULL), `checkout_reason`, `check_in_latitude/longitude/accuracy_m/distance_m`, `check_out_latitude/longitude/distance_m`, `last_activity_at`, `location_issue(_at)`, `updated_by` | unique (`employee`, `date`); `CHECK check_out IS NULL OR (check_in NOT NULL AND check_out ≥ check_in)`; index on `date`; partial index on `last_activity_at` for open sessions (reconciliation) |
| `BreakSession` | `attendance`, `employee`, `started_at`, `ended_at`, `duration_seconds`, `status` (ACTIVE/COMPLETED), `end_reason` (MANUAL/ALLOWANCE_EXHAUSTED/CHECKOUT), `source` (ONLINE/OFFLINE) | **one ACTIVE break per employee** (partial unique index); `CHECK ended_at ≥ started_at`; `CHECK` status matches end/duration; index (`employee`, `started_at`) |
| `OvertimeSession` | `employee`, `attendance` (SET_NULL), `date`, `started_at` (null until started), `ended_at`, `duration_seconds`, `status` (REQUESTED/APPROVED/REJECTED/ACTIVE/AUTO_STOPPED/COMPLETED/CANCELLED), `tasks` M2M Task, `work_description`, `other_reason`, `declaration_confirmed`, `requested_at`, `decided_by/at`, `decision_note`, `end_reason`, `last_activity_at`, `trigger`, `source`, timestamps | **one ACTIVE overtime per employee** and **one open (REQUESTED/APPROVED) request per employee** (partial unique indexes); `CHECK` status matches start/end/duration; indexes on `date`, (`employee`, `started_at`), (`status`, `date`) |
| `WorkFromHomeRequest` | `employee`, `date`, `reason`, `remarks`, `status` (PENDING/APPROVED/REJECTED/CANCELLED), `decided_by/at`, `decision_note`, `cancelled_at` | **one PENDING/APPROVED request per employee and date** (partial unique index); indexes (`status`, `date`), (`employee`, `date`) |
| `SyncEvent` | `user`, `employee`, `client_event_id` (UUID), `event_type`, `channel` (ONLINE/OFFLINE), `client_timestamp`, `effective_at`, `received_at`, `status` (APPLIED/CONFLICT/REJECTED), `error`, `entity_type/id` | **unique (`user`, `client_event_id`)**: the idempotency key; indexes on `status`, (`channel`, `received_at`) |

Absence, leave, holiday and weekly-off days are **derived** (not stored), so no nightly job is needed. Overtime is never added to `AttendanceRecord` worked time.

### leaves
| Model | Key fields | Constraints |
|---|---|---|
| `LeaveType` | `name`, `code`, `is_paid`, `annual_allocation` (null = untracked), `allow_half_day`, `is_active` | `name`, `code` unique; allocation ≥ 0 |
| `LeaveBalance` | `employee`, `leave_type` (PROTECT), `year`, `allocated` | unique (`employee`, `leave_type`, `year`); allocated ≥ 0 |
| `LeaveRequest` | `employee`, `leave_type` (PROTECT), `start_date`, `end_date`, `is_half_day`, `half_day_period`, `days` (snapshot), `leave_year`, `reason`, `status`, `decided_by`, `decided_at`, `decision_note`, `cancelled_at` | `CHECK end ≥ start`; `CHECK NOT half_day OR start = end`; `CHECK days > 0`; indexes on `status` and (`employee`, `start_date`, `end_date`) |

| `LeaveBalanceTransaction` | `balance` (PROTECT), `leave_request` **1:1** (PROTECT), `kind` (DEDUCTION), `days`, `balance_before`, `balance_after`, `created_by`, `created_at` | one row per request (database guarantee against double deduction); `CHECK days > 0`; `CHECK balance_after ≥ 0` |

`used` = sum of the balance's ledger deductions (written once, on approval). `pending` is computed from pending requests and never reduces the balance. Migration `leaves.0003` backfilled one deduction per previously approved request.

### payroll
| Model | Key fields | Constraints |
|---|---|---|
| `PayComponent` | `name`, `code`, `kind` (EARNING/DEDUCTION), `is_active` | `name`, `code` unique |
| `SalaryStructure` | `employee`, `effective_from`, `notes` | unique (`employee`, `effective_from`) |
| `SalaryStructureItem` | `structure`, `component` (PROTECT), `amount` (monthly) | unique (`structure`, `component`); amount ≥ 0 |
| `PayrollRun` | `year`, `month`, `status` (DRAFT/FINALIZED), `currency` (snapshot), `created_by`, `finalized_by`, `finalized_at` | unique (`year`, `month`); `CHECK 1 ≤ month ≤ 12` |
| `Payslip` | `run`, `employee` (PROTECT), `gross_earnings`, `total_deductions`, `net_pay` | unique (`run`, `employee`) |
| `PayslipItem` | `payslip`, `name` (snapshot), `kind`, `amount`, `source` (STRUCTURE/ADJUSTMENT) | amount ≥ 0 |

Payslip totals and item names are deliberate snapshots, so a finalized payslip never changes when salary structures or component names change later.

### documents
| Model | Key fields | Constraints |
|---|---|---|
| `EmployeeDocument` | `employee`, `category`, `title`, `file` (random name in private storage), `original_filename`, `content_type`, `size`, `visible_to_employee`, `uploaded_by` | index (`employee`, `category`) |

### tasks
| Model | Key fields | Constraints |
|---|---|---|
| `Task` | `title`, `description`, `assigned_by` (User, SET_NULL), `assigned_to` (Employee, PROTECT, internal id), `priority`, `due_date`, `requires_response`, `status` (PENDING/IN_PROGRESS/COMPLETED/CANCELLED), `acknowledged_at`, `response`, `responded_at`, `completed_at`, `cancelled_at`, `cancelled_by`, `cancel_reason`, timestamps | `CHECK` completed ⇒ `completed_at`, cancelled ⇒ `cancelled_at`; indexes (`assigned_to`, `status`), (`status`, `due_date`). OVERDUE is derived, not stored. |
| `TaskResponse` | `task`, `author`, `message`, `created_at` | ordered by time |

### messaging
| Model | Key fields | Constraints |
|---|---|---|
| `Conversation` | `pair_key` ("low:high" user ids), `created_by`, `last_message_at`, timestamps | `pair_key` unique (one 1:1 conversation per pair) |
| `ConversationParticipant` | `conversation`, `user`, `last_read_message_id` (read watermark) | unique (`conversation`, `user`); index (`user`, `conversation`) |
| `Message` | `conversation`, `sender` (SET_NULL), `body`, `created_at` | index (`conversation`, `id`) |
| `MessageAttachment` | `message`, `uploaded_by`, `file` (random name, private storage `message_files/`), `original_filename`, `content_type`, `size`, `created_at` | — |

### notifications / audit
| Model | Key fields | Constraints |
|---|---|---|
| `Notification` | `recipient`, `type`, `title`, `message`, `entity_type`, `entity_id`, `is_read`, `read_at` | index (`recipient`, `is_read`, `-created_at`) |
| `AuditLog` | `actor` (SET_NULL), `actor_email` (snapshot), `action`, `entity_type`, `entity_id`, `changes` (JSON), `metadata` (JSON), `ip_address`, `user_agent`, `created_at` | indexes on `created_at`, (`entity_type`, `entity_id`), `action`, `actor` |

Migrations added on 2026-10-03 (second set): `organization.0004_geofence_inactivity_overtime_settings` (workplace coordinates, radius 20, accuracy 100, inactivity 30, overtime approval; both-or-neither coordinate constraint), `organization.0005_owner_break_policy_60` (data: empty break allowance → 60), `attendance.0004_geofence_wfh_overtime_workflow` (fields above, `WorkFromHomeRequest`, overtime states; existing ACTIVE/COMPLETED rows stay valid), `notifications.0003_wfh_overtime_autocheckout_types`, `accounts.0006_sync_rbac_wfh_overtime` (`wfh.approve`, `overtime.approve` for HR Admin). All are additive; no data is deleted.

Migrations added on 2026-10-03 (first set): `organization.0003_break_allowance_and_policies` (new nullable column + `Policy` table; no data changes) and `accounts.0005_sync_rbac_policies` (adds the `policies.manage` permission to HR Admin and Super Admin).

## Working with migrations

```bash
cd backend
.venv/Scripts/python manage.py makemigrations      # after model changes
.venv/Scripts/python manage.py migrate
.venv/Scripts/python manage.py makemigrations --check --dry-run   # CI: fails if a migration is missing
.venv/Scripts/python manage.py sync_rbac           # after adding permissions to apps/accounts/rbac.py
```

Never alter the production schema by hand. Demo data (`seed_demo`) is fictional, uses the reserved `example.test` domain, and refuses to run unless `DJANGO_DEBUG=True`.
