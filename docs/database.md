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
                                                             └──< EmployeeDocument
User ──< Notification            AuditLog (actor → User, SET_NULL)            Holiday
```

## Tables

### accounts
| Model | Key fields | Constraints / indexes |
|---|---|---|
| `Permission` | `codename`, `description` | `codename` unique |
| `Role` | `code`, `name`, `level`, `is_system`, `permissions` (M2M) | `code`, `name` unique |
| `User` | `email` (login), `first_name`, `last_name`, `role` FK (PROTECT), `is_active`, `is_staff`, `must_change_password`, `password` (PBKDF2 hash), `last_login`, `date_joined` | `email` unique + `UniqueConstraint(Lower(email))`; emails are stored lower-case |

### organization
| Model | Key fields | Constraints |
|---|---|---|
| `Company` | `name`, `legal_name`, `email`, `phone`, `website`, `address` | `CHECK id = 1` (singleton) |
| `CompanySettings` | see api.md "settings fields" | `CHECK id = 1`; `half_day_min_hours < full_day_min_hours` when both set |
| `Department` | `name`, `code`, `description`, `head` FK Employee (SET_NULL), `is_active` | `name`, `code` unique |
| `Designation` | `name`, `description`, `is_active` | `name` unique |
| `Holiday` | `date`, `name`, `is_optional` | unique (`date`, `name`); index on `date` |

### employees
| Model | Key fields | Constraints |
|---|---|---|
| `Employee` | `user` 1:1 (PROTECT), `employee_code`, `phone`, `joining_date`, `exit_date`, `department`/`designation` FK (PROTECT), `manager` self-FK (SET_NULL), `employment_type`, `employment_status`, `address`, `emergency_contact_name/phone/relation`, `photo` (private file) | `employee_code` unique; `CHECK manager ≠ self`; `CHECK exit_date ≥ joining_date`; index on `employment_status` |

Name and email are **not** duplicated on Employee; they live on User.

### attendance
| Model | Key fields | Constraints |
|---|---|---|
| `AttendanceRecord` | `employee`, `date`, `check_in`, `check_out`, `status` (PRESENT/HALF_DAY/ABSENT), `is_late`, `source` (SELF/ADMIN), `remarks`, `updated_by` | unique (`employee`, `date`); `CHECK check_out IS NULL OR (check_in NOT NULL AND check_out ≥ check_in)`; index on `date` |

Absence, leave, holiday and weekly-off days are **derived** (not stored), so no nightly job is needed.

### leaves
| Model | Key fields | Constraints |
|---|---|---|
| `LeaveType` | `name`, `code`, `is_paid`, `annual_allocation` (null = untracked), `allow_half_day`, `is_active` | `name`, `code` unique; allocation ≥ 0 |
| `LeaveBalance` | `employee`, `leave_type` (PROTECT), `year`, `allocated` | unique (`employee`, `leave_type`, `year`); allocated ≥ 0 |
| `LeaveRequest` | `employee`, `leave_type` (PROTECT), `start_date`, `end_date`, `is_half_day`, `half_day_period`, `days` (snapshot), `leave_year`, `reason`, `status`, `decided_by`, `decided_at`, `decision_note`, `cancelled_at` | `CHECK end ≥ start`; `CHECK NOT half_day OR start = end`; `CHECK days > 0`; indexes on `status` and (`employee`, `start_date`, `end_date`) |

`used` and `pending` balances are computed from requests, not stored.

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

### notifications / audit
| Model | Key fields | Constraints |
|---|---|---|
| `Notification` | `recipient`, `type`, `title`, `message`, `entity_type`, `entity_id`, `is_read`, `read_at` | index (`recipient`, `is_read`, `-created_at`) |
| `AuditLog` | `actor` (SET_NULL), `actor_email` (snapshot), `action`, `entity_type`, `entity_id`, `changes` (JSON), `metadata` (JSON), `ip_address`, `user_agent`, `created_at` | indexes on `created_at`, (`entity_type`, `entity_id`), `action`, `actor` |

## Working with migrations

```bash
cd backend
.venv/Scripts/python manage.py makemigrations      # after model changes
.venv/Scripts/python manage.py migrate
.venv/Scripts/python manage.py makemigrations --check --dry-run   # CI: fails if a migration is missing
.venv/Scripts/python manage.py sync_rbac           # after adding permissions to apps/accounts/rbac.py
```

Never alter the production schema by hand. Demo data (`seed_demo`) is fictional, uses the reserved `example.test` domain, and refuses to run unless `DJANGO_DEBUG=True`.
