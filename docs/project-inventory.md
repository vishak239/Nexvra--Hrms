# Project Inventory

Inspection date: 2026-10-01
Inspected path: `C:\Nexvra-HRMS` (plus a read-only check of `C:\stitch`, the only Stitch-related folder on the machine)

## 1. What existed before any changes

| Path | Type | Size | Notes |
|---|---|---|---|
| `public/` | folder | — | Only contains `brand/` |
| `public/brand/` | folder | — | Only contains the logo PNG |
| `public/brand/nexvra-logo.png` | PNG, 76×78 px, RGBA | 3,003 bytes | Nexvra mark in lime on a dark background. Raster only, and low resolution. |

That is the entire project directory: **1 file, 2 folders**.

## 2. Findings by category

| Category | Found? | Detail |
|---|---|---|
| Stitch-generated HRMS UI (HTML / Tailwind / screenshots) | **No** | Nothing in the project directory. |
| Stitch files elsewhere on the machine | Yes, but **unrelated** | `C:\stitch\!-- Design System --.txt` (47 KB) is a Stitch export for a *personal portfolio site* ("Vishak", gold `#C9A227` / black palette, Playfair Display + Manrope + JetBrains Mono, AI-engineer project cards). It is **not** an HRMS design, so it must not be used as the HRMS UI reference. It was not copied or modified. |
| Nexvra logo SVG | **No** | Only the PNG above. The project owner will supply the official SVG. |
| Nexvra logo (any format) | Yes | `public/brand/nexvra-logo.png` (raster) |
| Other images / assets | No | — |
| Requirements documents | **No** | The only requirements source is the project brief (the master prompt). |
| HR policy documents | **No** | Confirmed with the owner: none exist. Every company policy is therefore **NOT SPECIFIED — CONFIGURABLE**. |
| Screenshots / exported designs | No | — |
| Existing source code | No | — |
| Package / config files | No | No `package.json`, `requirements.txt`, `.gitignore`, `.env`, etc. |
| Git repository | No | Not initialised. |
| Duplicate / unnecessary files | None | — |

## 3. Local toolchain (relevant to setup)

| Tool | Status |
|---|---|
| Python | 3.11.9 (`python`), 3.13.7 (`py`) |
| Node.js / npm | v24.14.0 / 11.9.0 |
| Git | 2.53.0 |
| PostgreSQL | Not installed at inspection time; being installed (PostgreSQL 16 via winget), as approved by the owner |
| Docker | Not installed |

## 4. Decisions per file

| File | Retain | Move | Rename | Reason |
|---|---|---|---|---|
| `public/brand/nexvra-logo.png` | Yes, byte-for-byte unchanged | → `brand/nexvra-logo.png` | No | `public/` at the repo root has no meaning without a root-level web app. Brand assets live in `brand/` (the single source of truth). The frontend copies them into `frontend/public/brand/` at build time. |
| `public/` (empty after the move) | No | — | — | Removed once empty. |

Nothing is unnecessary or duplicated, so nothing was deleted except the empty folder.

## 5. Inputs received later (2026-10-01)

| File as supplied | What it is | Decision |
|---|---|---|
| `brand/nexvra logo.svg` | Inkscape SVG wrapping a 1536×1024 high-resolution image of the mark (black background built in) | **Official logo** (owner confirmed). Renamed to `brand/nexvra-logo.svg` (byte-identical) and used by the app. |
| `design/stitch/svg xmlns=…vie.txt` (and a duplicate in `brand/`) | A logo Stitch redrew "matching the reference image", not HRMS screens | Not official. Kept as `design/stitch/stitch-logo-redraw.reference.svg`; the exact duplicate in `brand/` was removed. |

No Stitch **screen** export was supplied. The owner then asked for the screens to be built directly, so the UI is our own enterprise design on the Nexvra brand (see `architecture.md` §1).

## 6. Inputs originally awaited (historical)

1. **Stitch HRMS export.** Place it in `design/stitch/` (HTML files, zip, and/or screenshots). Frontend UI work is **on hold** until it arrives, by owner decision.
2. **Official logo SVG.** Place it at `brand/nexvra-logo.svg`. The app references the logo through one component (`NexvraLogo`), so the swap is a single path change.
3. **HR policies.** None exist. If any are written later, place them in `docs/source-requirements/` and update `docs/requirements-analysis.md`.

## 6. Final project structure

```
Nexvra-HRMS/
├── backend/                  Django + DRF API (Python)
│   ├── config/               settings, root urls, wsgi/asgi
│   ├── apps/
│   │   ├── core/             shared base models, permission classes, pagination, errors
│   │   ├── accounts/         User, Role, Permission, authentication endpoints
│   │   ├── organization/     Company, CompanySettings (policies), Department, Designation, Holiday
│   │   ├── employees/        Employee records and profiles
│   │   ├── attendance/       Daily attendance records, check-in/out
│   │   ├── leaves/           Leave types, balances, requests, approvals
│   │   ├── payroll/          Pay components, salary structures, payroll runs, payslips
│   │   ├── documents/        Private employee documents
│   │   ├── notifications/    In-app notifications
│   │   ├── audit/            Immutable audit log
│   │   └── reports/          Reports + role-aware dashboard API
│   ├── manage.py
│   ├── requirements.txt
│   └── requirements-dev.txt
├── frontend/                 Next.js + TypeScript + Tailwind (UI on hold for Stitch)
├── brand/                    Official brand assets (logo) — single source of truth
├── design/
│   └── stitch/               Stitch export goes here (awaited)
├── docs/                     All project documentation
│   └── source-requirements/  Any future requirements / policy documents
├── tests/
│   └── e2e/                  Playwright end-to-end tests
├── README.md
├── .gitignore
└── .env.example
```

Backend unit and API tests live next to each app (`backend/apps/<app>/tests/`), which is the Django/pytest convention. Cross-stack end-to-end tests live in `tests/e2e/`.
