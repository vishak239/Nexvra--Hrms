# Meetings, Resume Work, activity detection and desktop alerts

Release 4 (2026-10-05). Server code: `backend/apps/attendance/{meetings,resume,activity,services}.py`,
`backend/apps/notifications/views.py`. Browser code: `frontend/src/lib/{activity,notifications,linkify}.ts`,
`frontend/src/components/attendance/WorkSessionProvider.tsx`, `frontend/src/components/layout/NotificationCenter.tsx`.

## Four time categories

Every day's work session (`AttendanceRecord`, one per employee and day) keeps four categories apart. Only
working time counts toward the required daily hours.

| Category | Stored as | Counts as work | Uses the break allowance |
|---|---|---|---|
| Working time | check-in → check-out minus the three below (`worked_minutes`) | yes | — |
| Break time | `BreakSession` rows, total in `total_break_seconds` | no | yes (owner policy 60 min/day) |
| Meeting time | `MeetingPause` rows, total in `total_meeting_seconds` | no | no |
| Non-working time | `NonWorkingPeriod` rows, total in `total_non_working_seconds` | no | no |

`worked = (check_out or now) − check_in − breaks − meetings − non-working`. The work-session card shows all
four plus "Required working" and the remaining time when `CompanySettings.full_day_min_hours` is set (nothing
is shown when it is not configured; no policy is invented). The attendance records table shows meeting and
non-working minutes per day.

## Meetings

Permission `meetings.manage` (HR Admin, Super Admin) creates, edits, starts, ends and cancels meetings on the
**Meetings** page (`/meetings`). Everyone else sees the overall meetings and the meetings they are invited to.

- **Overall meeting**: affects every current employee.
- **Selected employee meeting**: affects only its participants; everyone else works normally.
- Status: Scheduled → Active → Completed, or Scheduled → Cancelled. A planned end time is optional; an active
  meeting ends automatically at it (by `reconcile_attendance` or the next request).
- **Start**: each affected employee with an open session gets a `MeetingPause` from that moment. A break in
  progress ends at that moment (`end_reason = MEETING`), so break and meeting time never overlap. Someone who
  checks in (or resumes) during the meeting is paused from their check-in.
- **During**: working time is paused (the card shows "Meeting in progress — Working Time paused"), activity is
  not watched, no inactivity check-out, no geofence check-out, no breaks (409 `in_meeting`). Check-out is still
  possible and closes the pause.
- **End**: pauses close at the end time, working time continues automatically (no check-in, no request), and
  the inactivity clock restarts at the end time. Overtime's inactivity clock restarts at the end time too.
- **Overlaps**: one active overall meeting at most (DB constraint); an overall meeting cannot start while any
  meeting runs; a selected meeting cannot start during an overall one or if a participant is in another running
  meeting; each employee has at most one open pause (DB constraint). Participants can be changed while a meeting
  runs (a newcomer is paused now, a removed person resumes now).
- Notifications: scheduled, started, ended, cancelled (to the people the meeting affects).

## Automatic check-out and Resume Work

1. After 30 minutes without activity (`inactivity_timeout_minutes`) the session is checked out with reason
   `INACTIVITY_TIMEOUT` at *last activity + 30 min* (audit `ATTENDANCE_AUTO_CHECKOUT`, notification). A
   `NonWorkingPeriod` starts at that time.
2. A normal check-in is refused (409 `resume_required`). The card and header show **Resume Work**.
3. The employee gives a **Reason** and clicks **Submit Request** → `ResumeWorkRequest` (PENDING), notified to
   everyone with `resume.approve` (HR Admin, Super Admin). Status shown: "Waiting for HR/Admin approval".
4. HR / Super Admin approve or reject (Attendance → Resume Work tab, or the notification). Nobody decides their
   own request.
   - **Rejected**: "Resume request rejected"; the employee stays checked out; check-in stays blocked; a new
     request may be sent.
   - **Approved**: "Resume approved — Check in to continue working". Approval does **not** check anyone in.
5. The employee checks in again. The normal validation runs again: office check-in passes the geofence; a
   work-from-home check-in needs today's approved WFH request. On success the day's session reopens (same
   `AttendanceRecord`, first check-in time kept), the non-working period closes at the check-in time, the
   request becomes USED, and a new working segment starts (audit `ATTENDANCE_RESUMED`).
6. Requests are valid for their own day; unused ones expire. Only an inactivity check-out can be resumed: a
   manual check-out ends the day, and a geofence exit keeps its existing behaviour.

Example: 9:00 check-in, active until 13:30 → checked out at 14:00; resumed at 15:00 → 14:00–15:00 is
non-working time; working time 9:00–14:00 = 5 h, and 3 h are still needed for an 8-hour day.

## Activity detection (the "checked out while working" problem)

### What was wrong

1. **Only the HRMS tab was watched.** Employees working in other applications (editor, Excel, mail) produced no
   events in the browser tab. The optional device-wide signal (Chrome/Edge Idle Detection) was:
   - lost after every page reload (it was only started from a button click);
   - aborted whenever the monitor restarted, e.g. starting or ending a break, because `stop()` also cancelled it
     and the monitor effect re-ran on every phase or callback change.
2. **Activity during a network outage was lost.** The browser sent only "seconds since the last interaction"
   every two minutes; while the network was down nothing arrived, and the scheduled 30-minute rule checked the
   employee out although they were working.
3. **Each open tab ran its own copy** and only saw its own events; a background tab could report "idle".
4. Page-load was counted as activity, so reopening a browser after a long absence back-filled working time.

### What it does now (browser)

- Signals: `pointerdown`, `keydown`, `input`, `wheel`, `scroll` (capture phase, so scrolling inside panels
  counts), `touchstart`, window `focus`, returning to the tab, and deliberate pointer movement (≥ 24 px, at
  most every 5 s). Listeners are passive; the handlers only record a timestamp. **No key, text, page content,
  screenshot, microphone or camera data is ever read or sent.**
- The tracker keeps the *moments* of activity (at most one per 30 s) until the server acknowledges them, and
  sends them as "seconds ago" offsets with `observed_seconds` (how long the page has been watching). Moments seen
  while offline are delivered when the connection returns.
- One tracker per page (survives React re-renders); the heartbeat loop never restarts on state changes.
- Open tabs share activity (BroadcastChannel, storage-event fallback) and only one tab sends each heartbeat;
  fresh state is shared back to the other tabs.
- Device-wide activity (Idle Detection, Chrome/Edge, active/idle only) is offered on the work-session card and
  restored automatically after a reload once allowed.
- Heartbeat every 60 s (`heartbeat_seconds`), plus an immediate one when the local idle time reaches the limit.
- Not watched during a meeting, outside a session, or after check-out.

### What it does now (server — authoritative)

- The server walks the reported timeline from its last known activity. Breaks (until the allowance runs out)
  and meeting pauses stop the clock; their end restarts it. A full 30-minute gap → check-out at the start of the
  gap + 30 min. Otherwise the latest moment becomes `last_activity_at` (only ever moves forward, never before
  check-in, never in the future, never before the page started watching).
- **Evidence before checking out**: a missing heartbeat alone is not inactivity. The scheduled job checks out
  only when a heartbeat after the deadline confirmed it (`last_heartbeat_at ≥ deadline`) or the browser has been
  silent for `SILENT_GRACE` (30 min) beyond the deadline. Either way the check-out time is the deadline itself.
- Duplicate check-ins, check-outs without a check-in and overlapping sessions are refused (409; DB constraints).

### Limits no web page can overcome

- A web page cannot see keyboard or mouse use in other applications. Without the Idle Detection permission
  (Chrome/Edge only) only interaction with Nexvra HRMS counts; the card says so and offers the permission.
  Firefox and Safari have no Idle Detection.
- Nothing runs while the browser is closed or the computer sleeps; that time is treated as inactive.
- Browsers may freeze background tabs (energy saver); the heartbeat then resumes when the tab wakes, and the
  evidence rule above prevents a false check-out during short freezes.
- A determined user can fake browser signals; the server limits what a report can claim but cannot verify
  physical presence.

## Desktop alerts for notifications and messages

- The header polls `GET /api/notifications/updates/?since=<server_time>` every 30 s (browsers slow this to about
  once a minute in background tabs) and on focus. It returns new unread notifications plus both unread counts.
- Tab in front and focused → in-app toast. Tab in the background or window minimised → operating-system popup
  through the browser Notifications API, with the OS default sound (`silent: false`).
- Permission is requested only from the **Enable desktop alerts** button (Notifications page). Granted, denied
  and unsupported are all shown; nothing tries to bypass the browser.
- No spam: each item alerts once (id + time, remembered per user across tabs and reloads); a stable `tag` lets
  the OS replace rather than stack; at most 3 popups per check plus one summary; message alerts are skipped while
  the Messages page is in front. Message alerts never contain message text ("New message from …").

## Clickable links in messages

`LinkifiedText` splits message text into text and link parts and React renders them as text nodes and `<a>`
elements — never as HTML, so `<script>` or `<img onerror>` in a message is shown as text. Only `http(s)` links
(and `www.`, opened as https) become links; `javascript:`, `data:`, `file:` and links with credentials never do.
Links open in a new tab with `rel="noopener noreferrer nofollow"`. Conversation previews and notification text
stay plain text (they sit inside clickable rows, where nested links are not allowed).

## Dashboard

The summary cards use an auto-fit grid: one row when the width allows (each card at least 11.5 rem), wrapping
evenly on smaller screens. My Tasks, Unread Messages and Unread Notifications use three theme colours
(`primary-fixed`, `info`, `notice`). Measured contrast on cards (incl. hover) is 5.7–13.3:1, above WCAG AA (4.5:1), in light and dark mode.
