# TaskForge Playwright Suite

TypeScript (Page Object Model) + Playwright end-to-end tests for `https://mytaskforge.net/`.

## Project structure

```text
pages/        Page objects: all locators and page actions live here
  AnnouncementsPage.ts
  BasePage.ts
  AppShellPage.ts
  HomePage.ts
  TasksPage.ts
  CalendarPage.ts
  LoginPage.ts
  SchedulePage.ts
  SettingsPage.ts
  TimeClockPage.ts
  TimesheetsPage.ts
  LeavePage.ts
  LaborCostPage.ts
  NotificationsPage.ts
  PayrollPage.ts
  ProjectsPage.ts
  ProjectDetailPage.ts   (project workspace: Board/List/Milestones/Calendar/Chat/Files/Settings)
  ChatPage.ts
  DepartmentsPage.ts
  EmployeesPage.ts
  WorkingNowPage.ts
  WorkspacePage.ts
fixtures/     Playwright fixtures that inject page objects and credentials
  auth.fixture.ts        (also records failure context: URL, console errors, failed requests)
  pages.fixture.ts
utils/        Shared auth, env and navigation helpers
tests/        Specs and the auth setup project
reporters/    Custom dashboard reporter (test-health dashboard + developer bug report)
  dashboard-reporter.js
  bug-report.js
  open.js
  template.html
  assets/dashboard.css, assets/dashboard.js
scripts/      open-dashboard.js (npm run dashboard)
.github/      GitHub Actions CI workflow
```

Follow the Page Object Model: specs call page-object methods and must not use
`page.locator(...)` or page-specific `getByRole(...)` directly. Add a new method
to the relevant page object instead.

## Prerequisites

- Node.js 20+ on macOS or Windows.
- Google Chrome installed (the `*-chrome` projects use `channel: "chrome"`).
- `.env` at the project root:

```dotenv
BASE_URL = https://mytaskforge.net/
owner_email = <owner sign-in email>
owner_password = "<owner password>"
# optional, defaults to /abdul-s-workspace
WORKSPACE_PATH = /abdul-s-workspace
```

`.env` is gitignored. Never commit credentials or storage state. Quote the
password if it contains `#`; dotenv treats an unquoted `#` as a comment.

## Install
 
```sh
npm install
```

`postinstall` downloads the Playwright Chromium, Firefox and WebKit builds.
The Chrome projects still use your installed Google Chrome.

## Projects

| Project | Files | Auth state | Purpose |
|---|---|---|---|
| `auth-chrome`, `auth-firefox`, `auth-webkit` | `tests/00-auth.spec.ts` | empty | Standalone auth coverage; every test starts logged out |
| `setup` | `tests/auth.setup.ts` | empty | Logs in once and writes `playwright/.auth/user.json` |
| `modules-chrome`, `modules-firefox`, `modules-webkit` | `tests/0[1-9]-*.spec.ts`, `tests/1[0-9]-*.spec.ts` | saved | Module specs reuse the saved session |

Run everything:

```sh
npm test
```

Run only auth (all three browsers):

```sh
npm run test:auth:all
```

Refresh the saved session without running module tests:

```sh
npm run test:setup
```

Type-check:

```sh
npm run typecheck
```

### Parallel execution

The suite runs fully parallel (`fullyParallel: true`): 4 workers locally and 2
on CI. Module specs are read-only and share no state between tests, so any test
can run in any worker. `tests/00-auth.spec.ts` stays sequential within its file
(`test.describe.configure({ mode: 'default' })`) because every test submits the
real sign-in form and `/sign-in/email` is rate-limited. It still runs alongside
the other files. A transient `/login` redirect caused by the get-session limiter
is recovered by `AppShellPage.retryOnLoginRedirect`.

| Override | Effect |
|---|---|
| `WORKERS=<n>` | Worker pool size (for example `WORKERS=2 npm test`) |
| `RETRIES=<n>` | Retries per test (default 0 locally, 1 on CI) |
| `npm run test:serial` | One worker, for diagnosing ordering or rate-limit issues |

### Reports

Every run writes three reports:

| Output | Open with | Contents |
|---|---|---|
| `playwright-report/index.html` | `npm run report` | Playwright HTML report with traces |
| `dashboard-report/index.html` | `npm run dashboard` | Test-health dashboard. Tabs: Overview, Tests, Failures, **Bug report**, Breakdown, Slowest, API, Timeline |
| `dashboard-report/bug-report.md` (+ `bug-report.json`) | any Markdown viewer | Bug report to share with developers |

The dashboard opens automatically after a local run in an interactive terminal.
Set `DASHBOARD_OPEN=never` to stop that, or `always` to force it. The reporter
matches the
[conduit-playwright-framework-js reporters](https://github.com/mokaddes-arman/conduit-playwright-framework-js/tree/main/reporters)
(same files, template, assets, history/trend and attachment handling). It adds
TaskForge branding and the bug report.

**Bug report tab / `bug-report.md`:**

- **New bugs.** One entry per failed or flaky test, with all browsers merged.
  Each entry has a suggested severity, the browsers it fails and passes in,
  preconditions, steps to reproduce (the failing step is flagged),
  expected/actual, the element locator, and the page state at failure (URL,
  console errors, uncaught errors, failed/5xx/429 requests, credential query
  values masked). It also links the screenshot, video and trace, and gives a
  one-line re-run command. Each bug has a **Copy this bug** button, and
  **Copy as Markdown** copies the whole report.
- **Known defects.** Tests marked `test.fail()` with a QA ID (for example
  QA-014). If an expected failure starts passing, it is flagged
  **possibly fixed** so the annotation can be removed.
- **Not verified.** Tests skipped because live data did not meet the
  precondition, with the reason.

**Counts.** The *Bug report* badge counts new bugs **plus** known defects, so
a green run never shows 0 while confirmed defects still reproduce. Expected
failures count as *passed* (Playwright semantics); the *Passed* card and the
bug report's Result row state how many of them are known-defect expected
failures. A test that is a known defect in some browsers only (for example
`test.fail` unless Firefox) is still reported as a new bug when it fails in a
browser without the annotation.

**Partial runs.** The reports always describe the latest run. When fewer test
projects ran than are configured (a single spec, one browser), the dashboard
and `bug-report.md` say **Partial run: N of M test projects**, because defects
in specs that did not run are not listed.

`dashboard-report/history.json` keeps the last 20 runs for the pass-rate trend.

**Every run is archived.** `playwright-report/` and `dashboard-report/` are
rebuilt by each run. After writing them, the dashboard reporter copies both to
`qa/report-history/<run time>_auto-<full|projects>/` (local runs only; never
overwrites; the HTML report is copied only if this run produced it). Set
`QA_ARCHIVE=never` to skip that. A milestone run can also be archived with a
label:

```sh
npm run report:archive -- <label>   # -> qa/report-history/<run date>_<label>/
```

**Do not pass `--reporter` on its own.** On the command line it *replaces* the
configured reporters, so the dashboard, bug report and HTML report are not
updated (the config prints a warning). Omit it, or keep all three:
`--reporter=list,html,./reporters/dashboard-reporter.js`.

**Credential masking (QA-018).** Playwright titles input steps with their value
(`Fill "<value>"`). The real password is therefore typed with
`LoginPage.fillSecretPassword` (recorded only as `Evaluate`), and the dashboard
reporter masks every `*password*` / `*secret*` / `*token*` / `*api_key*`
environment value in `index.html`, `bug-report.md` and `bug-report.json`.
`npm run test:unit` runs the masking unit tests.

## Continuous integration

`.github/workflows/playwright.yml` runs on pushes and pull requests to `main`
and can also be started manually. It performs two jobs:

1. **Type check** — installs dependencies and runs `npm run typecheck`.
2. **E2E (Chrome)** — installs Google Chrome and runs `auth-chrome` and
   `modules-chrome` in one Playwright invocation (2 workers by default; set the
   `WORKERS` repository *variable* to change it). The bug report is appended to
   the job summary. `playwright-report/` + `test-results/` and `dashboard-report/`
   are uploaded as two artifacts (kept for 14 days). The job is skipped for pull
   requests from forks because those runs do not receive repository secrets.

Configure these repository secrets under **Settings → Secrets and variables →
Actions** before running the E2E job:

| Secret | Purpose |
|---|---|
| `OWNER_EMAIL` | Authorized QA account email (maps to `owner_email`) |
| `OWNER_PASSWORD` | Authorized QA account password (maps to `owner_password`) |
| `BASE_URL` | Optional app URL; defaults to `https://mytaskforge.net/` |
| `WORKSPACE_PATH` | Optional workspace path; defaults to `/abdul-s-workspace` |

The workflow never writes `.env`, and credentials are passed only through
environment variables. Workflow runs for the same ref are de-duplicated by the
concurrency group (a newer push cancels the older run), so two CI runs never
sign in with the shared owner account at the same time.

## Auth coverage (`tests/00-auth.spec.ts`)

`Login page UI`

1. Renders the form, password toggle, forgot-password and register links.
2. Empty fields show inline validation without calling the sign-in API.
3. An invalid email format is rejected before the sign-in API.
4. Password visibility toggles without losing the value.

`Authentication`

5. Valid owner credentials authenticate and return a JSON API response.
6. Invalid credentials return `401` and do not create a session.
7. Authenticated `storageState` persists into a new browser context.
8. A fresh unauthenticated context is redirected from protected routes.
9. Logout clears the session and protects workspace routes.
10. Clearing session cookies redirects protected routes to login.
11. QA-003 regression guard: repeated fresh-context sign-ins are consistent.

`Authentication hardening` (added 17 Nov 2026; dummy credentials, sign-up /
password-reset / validation-only sign-in APIs blocked in the browser)

12. AUTH-12: forgot-password validates empty/invalid email without sending a reset.
13. AUTH-13: sign-up renders and rejects a weak, mismatched password without calling the API.
14. AUTH-14: a whitespace-only email is rejected before the sign-in API.
15. AUTH-14 (QA-029, `test.fail`): over-long email / whitespace-only password reach the API.
16. SEC-16 (QA-012, `test.fail`): with scripts blocked the form submits a GET with the credentials in the URL.
17. SEC-08/AUTH-15: a foreign `callbackURL`/`redirect`/`next` is ignored after login, and a logged-out session token cannot be replayed.

Animations/loading are handled with visibility and response/URL assertions, not
fixed sleeps. This file runs its tests in order on one worker (sign-in rate
limit); the rest of the suite runs in parallel around it.

## Module coverage

| # | Module | Spec | Page object |
|---|---|---|---|
| 01 | Home | `tests/01-home.spec.ts` | `pages/HomePage.ts` (extends `AppShellPage`) |
| 02 | Tasks | `tests/02-tasks.spec.ts` | `pages/TasksPage.ts` (extends `AppShellPage`) |
| 03 | Calendar | `tests/03-calendar.spec.ts` | `pages/CalendarPage.ts` (extends `AppShellPage`) |
| 04 | Schedule | `tests/04-schedule.spec.ts` | `pages/SchedulePage.ts` (extends `AppShellPage`) |
| 05 | Time clock | `tests/05-time-clock.spec.ts` | `pages/TimeClockPage.ts` (extends `AppShellPage`) |
| 06 | Timesheets | `tests/06-timesheets.spec.ts` | `pages/TimesheetsPage.ts` (extends `AppShellPage`) |
| 07 | Leave | `tests/07-leave.spec.ts` | `pages/LeavePage.ts` (extends `AppShellPage`) |
| 08 | Labor cost | `tests/08-labor-cost.spec.ts` | `pages/LaborCostPage.ts` (extends `AppShellPage`) |
| 09 | Payroll | `tests/09-payroll.spec.ts` | `pages/PayrollPage.ts` (extends `AppShellPage`) |
| 10 | Working now | `tests/10-working-now.spec.ts` | `pages/WorkingNowPage.ts` (extends `AppShellPage`) |
| 11 | Chat | `tests/11-chat.spec.ts` | `pages/ChatPage.ts` (extends `AppShellPage`) |
| 12 | Announcements | `tests/12-announcements.spec.ts` | `pages/AnnouncementsPage.ts` (extends `AppShellPage`) |
| 13 | Notifications | `tests/13-notifications.spec.ts` | `pages/NotificationsPage.ts` (extends `AppShellPage`) |
| 14 | Projects | `tests/14-projects.spec.ts` | `pages/ProjectsPage.ts`, `pages/ProjectDetailPage.ts` (extend `AppShellPage`) |
| 15 | Departments | `tests/15-departments.spec.ts` | `pages/DepartmentsPage.ts` (extends `AppShellPage`) |
| 16 | Employees | `tests/16-employees.spec.ts` | `pages/EmployeesPage.ts` (extends `AppShellPage`) |
| 17 | Settings | `tests/17-settings.spec.ts` | `pages/SettingsPage.ts` (extends `AppShellPage`) |
| — | Cross-cutting Security / Responsive / Realtime (SEC-01/05/06, GEN-07/08, NFR-03/08) | `tests/11-security-edge-cases.spec.ts` | `pages/BasePage.ts` (viewport + overflow helpers) |

### Module 1 — Home

Read-only checks: dashboard load, greeting and the *Business at a glance* /
*Needs attention* regions, the *Business numbers* KPI term/definition group with
well-formed values, the New task dialog (opened and closed), setup checklist
link targets, dashboard shortcuts, the *My day* aside (schedule, clock, Request
time off, All tasks), loading-skeleton replacement (QA-007), and the global
shell. The shell check covers the regrouped sidebar (Work / Team time / People /
Costs / Settings, as of the 16 Nov 2026 release) and the realtime status banner
(QA-001).

Module specs use `fixtures/pages.fixture.ts`, which injects page objects and a
saved-session restore hook. A transient `/login` redirect on module navigation is
retried once without repeating UI login; auth behaviour itself stays covered by
`tests/00-auth.spec.ts`.

### Module 2 — Tasks

Read-only checks: module load, numeric tab counts, all five tab routes and
selection state, per-tab zero-state copy, search no-match and clear behaviour,
Status + Priority filter combinations with clear-filters recovery, filter
popover option sets, and the due-from/due-until date-range controls. Task
creation, editing, completion and deletion are deferred because they mutate the
shared workspace.

### Module 3 — Calendar

Read-only checks: month view load, month grid structure, previous/next/Today
navigation and Today disabled state on the current period, Month/Week view
switching with a seven-day week grid and week navigation, independent layer
toggles, Department/Project/Employee filter combinations with clear-filters
recovery, filter option/search-box inventories, and the empty-month copy over an
intact grid. Event drill-down, timezone-boundary placement and event show/hide
verification are deferred until scheduled data exists.

### Module 4 — Schedule

Read-only checks: weekly grid load, seven day columns tied to the week label,
employee rows with one add-shift action per day, the *Schedule view* radiogroup
(Day view with its date label and 08:00–17:00 hours, Month view with 42 day
cells, each period navigated and returned), Previous/Next/This week
navigation with stable employee rows, My shifts toggle with the personal empty
state, department/office filter option sets, department filter apply/clear,
publish and discard gating with no drafts, empty-schedule zero-hour state, and
the Add shift draft dialog defaults with a clean cancel. Shift creation,
Copy last week, Discard drafts, publishing and overlap validation are deferred
because they mutate the shared workspace.

### Module 5 — Time clock

Read-only checks: live clock and date formatting, current clock state and timer,
the off-clock action and location notice, project picker options with selection
and reset back to No project, today's worked time/entry count with the zero state,
and the weekly total plus seven-day chart. Clock in/out, breaks and job switching
are deferred because they mutate the owner's time entry and shared workspace.

### Module 6 — Timesheets

Read-only checks: current pay period with the *Period totals* summary group and
seven daily rows,
Previous/Next/This period navigation, My timesheet/Team tabs with URL sync, team
rows with status/hours/overtime/flags/pay, Approve selected row-selection gating,
and the Add entry dialog defaults, project/office/break options, reason
requirement, clock-order validation and clean cancel. Submitting, approving and
saving manual entries are deferred because they mutate the shared workspace.
The empty-timesheet Submit state is annotated as QA-006 and is never activated.

### Module 7 — Leave

Read-only checks: balance cards for Vacation, Sick, Personal and unpaid leave,
My leave/Requests/Calendar tabs with URL sync, the personal empty-request state,
the team request queue status filters (Pending/Approved/Rejected/Cancelled/All),
and month navigation on the leave calendar with weekday headers, a 28–42-cell
week grid (35 or 42 cells depending on the month), out-of-month dimming, the
today highlight and the Approved/Pending legend. The Request leave dialog is
covered for its owner/type options, default dates, length radios and preview,
optional reason, end-before-start validation and a clean cancel that leaves
balances and requests unchanged. Submitting, approving, rejecting and cancelling
leave are deferred because they mutate the shared workspace. Choosing dates only
calls the dialog's non-mutating preview endpoint. Correcting an end-before-start
range restores the preview and enables Send request but leaves the Length control
hidden; that state is annotated as QA-013 and is never submitted.

### Module 8 — Labor cost

Read-only checks: the report shell with the current week and export link, all
five preset ranges with the range summary and export dates in sync, custom
from/to date pickers with the pending prompt and export gating, and the
Employee/Project/Department/Office groupings with their matching columns and
row/footer totals. Department, Office and Project filter option sets are
inventoried and the Department/Project filters are applied, cleared and checked
against the export query. The Approved-only switch is toggled and checked in the
export query, and empty or populated results are validated without broken
values. Exporting is verified through the CSV link's query only; no download is
started and no workspace data is changed.

### Module 9 — Payroll

Read-only checks: the report shell on the last completed weekly period, the
disabled Last completed period reset, Previous/Next week navigation with the
period heading and both export dates in sync, the export detail/summary links,
the closing estimated-wages note, and the no-approved-timesheets empty state.
Same-year and cross-year period labels are parsed and checked across a year
boundary. When the period has unapproved timesheets, the warning text and its
Team timesheets review link are validated. If approved timesheets exist, the
employee table columns, footer totals and expandable adjustment details are
checked; that test skips while the workspace has no approved payroll rows.
Exporting is verified through the CSV links only; no download is started and no
payroll data is changed.

### Module 10 — Working now

Read-only checks: board loading, the empty state, location groups, and the On
the clock/On break/Not in yet sections with their counts, row copy, flag badges
and clock-out actions kept in sync. The clock-out confirmation is opened to
check its employee name and copy, then cancelled; no clock-out is confirmed and
no time entry is changed. The On leave today card and its employee/leave-type
rows are checked when people are on leave; otherwise that test skips.

### Module 11 - Chat
Read-only checks: conversation sidebar with workspace, department and project
channels and their active state, All/Channels/Direct filters, channel search with
no-match and clear behaviour, switching between conversation types with their
member count and privacy summary (workspace: everyone; department/project: only
that department plus workspace Owners/Admins), the empty
conversation state and composer gating with draft text and clear recovery,
formatting hide/show, the new-channel dialog with a clean cancel, global and
conversation-scoped message search dialogs, the member popover and direct-message
picker without submitting a conversation, and the emoji picker plus mention
suggestions without sending. Below 768px the conversation rail is treated as a
collapsed drawer. No message is sent, no channel is created and no direct
message is started.

### Module 12 - Announcements
Read-only checks: the announcement list with its All/Unread tabs and empty
state, and the new-announcement dialog. The dialog is opened and checked for
its title, message, audience switch, pin control, attachment input, validation
message and disabled Post button. Title and message drafts enable Post, the
draft is cleared back to the disabled state, the audience switch is toggled back
to its original value, and the pin date picker is opened and closed. No
announcement is posted, pinned or deleted.

### Module 13 - Notifications
Read-only checks: the notification list with its All/Unread tabs and empty
state, plus the Mark all read control. Mark all read is asserted disabled
while there are no unread notifications; it is never clicked.

### Module 14 - Projects
Read-only checks on the list: the active projects list and controls, the table
columns (Project, Due, Progress, Next milestone, Logged, Labor budget, Owner,
Actions) and row roll-up values, status tabs (Active/Overdue/Archived), the
Table/Cards layout toggle, and the new-project dialog (opened and cancelled).

Read-only checks in the project workspace (`ProjectDetailPage`): Board, List and
Milestones tabs; project calendar previous-month and Today navigation; the
project Chat and Files surfaces (nothing sent or uploaded). The Files tab lives
at `/projects/<slug>/files`; the old `/attachments` URL returns 404. Project
Settings checks the immutable-key note, columns 5/10, assignment rules 0/20,
Save/Change owner/Move project disabled until edited, Archive enabled and Delete
disabled. Every tab's canonical URL and `aria-current` state is also checked.
No project is created, starred, archived, moved or deleted.

### Module 15 - Departments
Read-only checks: the department list and the new-department dialog. The dialog
is opened and cancelled only; no department is created.

### Module 16 - Employees
Read-only checks: the employee list with its filters and count, search with a
no-match and clear recovery, the add-members dialog, and the employee deep page
with its Profile/Schedule/Time/Leave/Pay tabs (E-06). No employee is added,
removed or reassigned.

### Module 17 - Settings
Read-only checks: the settings shell with its section navigation, the general
settings form (name, URL name, business type, timezone), disabled Save changes
for unchanged values, and the danger-zone delete button. Sub-pages: Offices
(tabs, empty state, New office dialog, 150 m geofence default and out-of-range
rejection, ST-04), HR & Pay (pay rules, disabled save, negative grace period
rejected, ST-05), Holidays (year navigation and empty state, ST-06), Leave
(leave types and actions, ST-07) and Plan & usage (plan, upgrade path, limits
note, ST-08). No setting is saved and the workspace is not deleted.

### Cross-cutting — Security, Responsive & Edge Cases

`tests/11-security-edge-cases.spec.ts` covers the scenarios that cut across
module boundaries instead of belonging to a single module:

- **SEC-01 / GEN-07** — unauthenticated deep links (workspace root, tasks, leave,
  labor cost, settings, chat) redirect to the login page without rendering
  workspace content.
- **SEC-05** — script/HTML injection payloads (`<script>`, `<img onerror>`) in the
  Tasks search and the unsubmitted New-announcement form stay inert; no dialog is
  opened and no page error is raised.
- **SEC-06** — the Labor cost CSV export control targets the export endpoint and is
  not a script/data URL; spreadsheet formula prefixes (`=1+1`, `=cmd|…`, `@SUM(1)`,
  `+1`, `-1`) stay inert in the Tasks search.
- **NFR-08** — with the realtime host (`api.mytaskforge.net`) unreachable, the status
  strip is polled until it reports *Reconnecting… Live updates are paused, but
  your changes still save.* and no unhandled page error occurs.
- **NFR-03 / GEN-08** — responsive checks at 375px and 1440px (no horizontal
  overflow on core pages). The 44px tap-target check is a separate test marked
  `test.fail()` for **QA-014**. Mobile header controls are 32–40px (Notifications,
  Account menu, Search and the nav burger are 32×32; Create is 40×32). The defect
  stays visible under *Known defects* in the bug report without failing the run.
  If it starts passing, Playwright fails it so the annotation gets removed.

The spec never submits or mutates data: dialogs are cancelled, searches are
cleared and exports are inspected only.

### Coverage-audit specs (17 Nov 2026)

| Spec | Scenarios | Notes |
|---|---|---|
| `tests/11-security-api.spec.ts` | SEC-02/04/08/09/10/11/12/13/14/17, GEN-07 | Headers, clickjacking, CORS, version banners, anonymous API access (endpoints discovered from the app's own calls), session payload, cookie flags, non-member workspace, error pages, QA-002 description scan. GET/OPTIONS only. |
| `tests/18-global-shell.spec.ts` | GEN-02/03/04/05 | Clicks every sidebar link, Ctrl+K search (QA-023), workspace switcher, theme (restored afterwards). |
| `tests/18-api-integration.spec.ts` | API-01…07, INT-09/12 | REST contract of 38 read endpoints, server-side validation (422) and 404 handling, API ↔ UI consistency (KPIs, directory, projects, plan, working now, tasks, departments, leave, timesheets), QA-006 rule server-side, workspace time zone and server clock, realtime host reachability (QA-001), analytics outage isolation. GET only (`utils/api.ts`). |
| `tests/18-integration-consistency.spec.ts` | INT-01/02/03/05/07/08, E-08 | Home KPIs vs modules, plan usage vs directory, hours across modules, every data API 2xx JSON, CSV exports parsed in memory. |
| `tests/19-accessibility.spec.ts` | A11Y-01/02/03/05 | axe-core WCAG 2.1 A/AA on login + 17 modules (axe JSON attached), keyboard order and focus visibility, dialog focus trap/restore (QA-028), titles/lang/landmarks. Known axe defects QA-024/025/026 are `test.fail`. |
| `tests/19-performance.spec.ts` | NFR-01, PERF-02, PERF-05 | Single-user timings with budgets; **skipped in parallel runs**, run with `npm run test:perf` (1 worker). Not a load test. |
| `tests/19-resilience.spec.ts` | NFR-08, PERF-06 | Simulated API 500 (friendly error + Try again), offline navigation (QA-027), recovery, slow API. Nothing reaches the server. |
| `tests/19-compatibility.spec.ts` | COMP-07 / NFR-03 | 320, 768, 1024, 1920 px overflow checks. |
| `tests/compat/compat-smoke.spec.ts` | COMP-04/05/06 | `npm run test:compat` (`playwright.compat.config.ts`): Edge, Pixel 7, Galaxy S9+ (320 px), iPhone 15, iPad Pro 11. Not part of `npm test`. |
| `reporters/redact.test.js` | UNIT-08 / REG-07 | `npm run test:unit` (Node test runner). |
| `tests/20-rbac.spec.ts` | RBAC-01…10, PERM-02/03/04, E-03/E-10, ST-10, SEC-02/03 | Admin / Manager / Employee: sidebar, Create menu, payroll & labor cost, Working now, settings, module actions, pay-rate protection, API write refusals (no-op probes), cross-tenant isolation, QA-030. Project `roles-chrome`. |
| `tests/20-platform-admin.spec.ts` | PA-01…05 | Platform admin console (`/admin`): dashboard/users/plans vs API, console closed to workspace roles, no implicit workspace access, row actions, impersonation banner and stop. |

Scenario catalogue, coverage matrix and the Excel/Markdown QA reports are built
from real run archives by `qa/tools/build_qa_reports.py` (see `qa/README.md`).

### Role-based access (RBAC) suite

`roles.setup.ts` (project `setup-roles`) signs in the platform admin
(`super_admin` / `super_admin_password` in `.env`), reusing
`playwright/.auth/super-admin.json` while it is still valid, then uses the
platform's **Impersonate** feature to write one session per role:
`playwright/.auth/role-{admin,manager,employee}.json`. The server treats these
sessions as the impersonated user (`session.impersonatedBy` is set), so
authorization is enforced exactly as for a normal sign-in.

| Role | Account (`.env`) | Origin |
|---|---|---|
| Admin | `qa_admin_email` | Created 17 Nov 2026 by `scripts/provision-role-accounts.cjs` |
| Manager | `qa_manager_email` | Created 17 Nov 2026 by `scripts/provision-role-accounts.cjs` |
| Employee | `qa_employee_email` | Existing test member (the Free plan allows 5 members; the workspace is now 5/5) |

The Admin/Manager accounts were created through the normal sign-up and still
await e-mail verification; their passwords (`qa_*_password`) only work after
the verification links are clicked. Impersonation does not need them.

Write probes in `20-rbac` are no-ops even if wrongly accepted (same role, same
settings, empty patch, inviting an existing member). Admin writes are not
exercised. `fixtures/roles.fixture.ts` selects the session with
`test.use({ role: 'admin' | 'manager' | 'employee' | 'platform' })`.

```sh
npx playwright test --project=roles-chrome   # runs setup, setup-roles, then 20-*
```

## Known constraints handled by the helpers

- **Rate limiting:** Better Auth limits `/sign-in/email`; TaskForge returns
  `429` with `X-Retry-After`. `utils/auth.ts` paces submissions and
  retries after the advertised delay. Pacing is shared by every worker
  process: a ledger in `playwright/.auth/signin-ledger.json` behind an atomic
  lock allows at most 2 UI sign-ins per 10 s across the whole run, out of the
  server's 3. `00-auth` also runs its tests in order on one worker. Module
  specs never sign in through the UI; they reuse the saved session.
- **Hydration:** submitting `/login` before React attaches `onSubmit` causes a
  native GET and puts the password in the URL (QA-012). The helper waits for
  React's form handler before filling/submitting.
- **Transient network/DNS errors:** `gotoWithRetry` retries
  `ERR_NAME_NOT_RESOLVED` / `ERR_NETWORK_CHANGED` navigations.
- **Realtime host:** `api.mytaskforge.net` does not resolve (QA-001), so tests
  must assert persisted HTTP state and must not depend on live updates.
- **Free plan limits:** members `5/5` (since the RBAC accounts were added), projects `1/1`, workspaces `1/1`
  (QA-005, 16 Nov 2026). Creation tests need a staging workspace or explicit
  approval/data cleanup.

## Adding module specs

Create files in order:

```text
tests/01-home.spec.ts
tests/02-tasks.spec.ts
...
tests/17-settings.spec.ts
```

The `modules-*` projects automatically pick up `01` through `17` and supply
`playwright/.auth/user.json`. Keep tests non-destructive unless the scenario is
explicitly approved. Reuse the `loginPage` / `workspacePage` fixtures rather
than logging in or querying the DOM inside each spec.

## Safety

- No application source code is modified by this suite.
- Tests sign in/out and read pages; they do not create, update or delete
  workspace records.
- Do not commit `.env`, `playwright/.auth/`, `test-results/`,
  `playwright-report/`, `dashboard-report/` or `qa/` evidence. All are
  gitignored.
- The failure-context attachment masks credential-like query values
  (`password`, `token`, `email`, …), and `00-auth` / `setup` keep traces off.
  Before 17 Nov 2026 the bug report and the Playwright HTML report still
  contained the password through `Fill "<value>"` step titles (QA-018); the
  real password is now typed without a value-bearing step and the dashboard
  reporter masks secret values in everything it writes.
