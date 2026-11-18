# TaskForge QA Automation Suite

End-to-end test suite for [TaskForge](https://mytaskforge.net/), built with
**Playwright + TypeScript** using the **Page Object Model**.

The suite covers the login flow, all 17 workspace modules, and cross-cutting
security, API, integration, accessibility, performance, resilience,
compatibility and role-based-access checks. It is **read-only by design**: it
runs against the production app with a shared workspace, so dialogs are
cancelled, drafts are cleared and exports are only inspected. No workspace
records are created, changed or deleted.

> For in-depth details (reporter internals, CI secrets, rate-limit handling,
> RBAC account setup), see the [detailed suite guide](tests/README.md).

## Contents

- [At a glance](#at-a-glance)
- [Quick start](#quick-start)
- [Running tests](#running-tests)
- [Project layout](#project-layout)
- [Test cases by module](#test-cases-by-module)
- [Cross-cutting test cases](#cross-cutting-test-cases)
- [Known defects tracked by the suite](#known-defects-tracked-by-the-suite)
- [Reports](#reports)
- [Contributing](#contributing)

## At a glance

| Area | Spec files | Test cases | Browsers / projects |
|---|---|---:|---|
| Authentication | `00-auth` | 17 | Chrome, Firefox, WebKit |
| Functional modules (01–17) | `01`–`17` | 110 | Chrome, Firefox, WebKit |
| Security | `11-security-api`, `11-security-edge-cases` | 17 | Chrome, Firefox, WebKit |
| Global shell, API & integration | `18-*` | 23 | Chrome, Firefox, WebKit |
| Accessibility, compatibility, performance, resilience | `19-*` | 37 | Chrome, Firefox, WebKit |
| Role-based access & platform admin | `20-*` | 30 | Chrome only (`roles-chrome`) |
| Device compatibility smoke | `compat/compat-smoke` | 17 | Edge + 4 emulated devices (separate config) |
| **Total** | | **251** | |

`npm test` runs **644** test executions (234 test cases × their browsers, plus 2
setup steps). The device compatibility smoke runs separately with
`npm run test:compat` (17 cases × 5 devices).

## Quick start

**Prerequisites:** Node.js 20+, Google Chrome (the `*-chrome` projects use the
installed Chrome), and access to an authorized TaskForge QA account.

```sh
# 1. Install dependencies (also downloads Playwright's Chromium, Firefox and WebKit)
npm install

# 2. Create your local environment file and fill in the QA account
cp .env.example .env

# 3. Run the suite
npm test
```

Minimum `.env` values:

```dotenv
BASE_URL=https://mytaskforge.net/
owner_email=<authorized QA account email>
owner_password="<password>"   # quote it if it contains #
WORKSPACE_PATH=/abdul-s-workspace
```

The RBAC suite (`20-*`) also needs `super_admin`, `super_admin_password` and the
`qa_*_email` values. See [`.env.example`](.env.example).
`.env` is gitignored. **Never commit credentials or `playwright/.auth/`.**

## Running tests

| Command | What it runs |
|---|---|
| `npm test` | Everything in the default config (auth, modules, RBAC; all projects) |
| `npm run test:auth:all` | Auth spec in Chrome, Firefox and WebKit |
| `npm run test:auth:headed` | Auth spec in headed Chrome |
| `npm run test:modules` | Module and cross-cutting specs (`01`–`19`) in all three browsers |
| `npm run test:modules:chrome` | Same, Chrome only (also `:firefox`, `:webkit`) |
| `npx playwright test --project=roles-chrome` | RBAC + platform admin (`20-*`) |
| `npm run test:perf` | Performance timings (needs 1 worker; skipped in parallel runs) |
| `npm run test:compat` | Edge + emulated phone/tablet smoke |
| `npm run test:setup` | Refresh the saved login session only |
| `npm run test:unit` | Unit tests for report credential masking |
| `npm run test:ui` | Playwright UI mode |
| `npm run typecheck` | TypeScript check |

Run a single module: `npx playwright test tests/07-leave.spec.ts --project=modules-chrome`

| Variable | Effect |
|---|---|
| `WORKERS=<n>` | Worker count (default 4 locally, 2 on CI) |
| `RETRIES=<n>` | Retries per test (default 0 locally, 1 on CI) |
| `HEADED=1` | Show the browser |
| `DASHBOARD_OPEN=never\|always` | Control dashboard auto-open after a local run |
| `QA_ARCHIVE=never` | Skip archiving the run to `qa/report-history/` |

### Playwright projects

| Project | Specs | Session |
|---|---|---|
| `auth-chrome`, `auth-firefox`, `auth-webkit` | `00-auth` | Logged out |
| `setup` | `auth.setup.ts` | Signs in once, saves `playwright/.auth/user.json` |
| `modules-chrome`, `modules-firefox`, `modules-webkit` | `01`–`19` | Reuses saved owner session |
| `setup-roles` | `roles.setup.ts` | Saves Admin / Manager / Employee sessions via platform-admin impersonation |
| `roles-chrome` | `20-*` | Per-role sessions |
| `compat-*` (`playwright.compat.config.ts`) | `compat/compat-smoke` | Reuses saved owner session |

## Project layout

```text
pages/       Page objects: every locator and page action lives here
fixtures/    Fixtures that inject page objects, sessions and failure context
utils/       Auth pacing, env, navigation, API and axe helpers
tests/       Spec files (numbered by module) and setup projects
reporters/   Custom dashboard + developer bug-report reporter
scripts/     Dashboard opener, report archiver, role-account provisioning
.github/     CI workflow (type check + Chrome E2E)
```

---

## Test cases by module

Legend:
**⚠ QA-0xx**: confirmed app defect. The test is marked `test.fail()`, so it
passes while the bug reproduces and fails once the bug is fixed.
**⏭**: skips when live workspace data does not meet the precondition.

### 00 · Authentication: 17 tests

Spec: [`tests/00-auth.spec.ts`](tests/00-auth.spec.ts) · Page object: `LoginPage`, `AuthFormsPage` · Runs logged out, in order (sign-in is rate-limited)

| # | Test case | Notes |
|---:|---|---|
| | **Login page UI** | |
| 1 | [Renders the login form and account links](tests/00-auth.spec.ts#L33) | |
| 2 | [Empty fields show inline validation without calling the sign-in API](tests/00-auth.spec.ts#L40) | |
| 3 | [Invalid email format is rejected before the sign-in API](tests/00-auth.spec.ts#L53) | |
| 4 | [Password visibility toggles without losing the value](tests/00-auth.spec.ts#L68) | |
| | **Authentication** | |
| 5 | [Valid owner credentials authenticate and return a JSON API response](tests/00-auth.spec.ts#L86) | |
| 6 | [Invalid credentials return 401 and do not create a session](tests/00-auth.spec.ts#L133) | |
| 7 | [Authenticated storageState persists into a new browser context](tests/00-auth.spec.ts#L168) | |
| 8 | [A fresh unauthenticated context is redirected from protected routes](tests/00-auth.spec.ts#L221) | |
| 9 | [Logout clears the session and protects workspace routes](tests/00-auth.spec.ts#L239) | |
| 10 | [Clearing session cookies redirects protected routes to login](tests/00-auth.spec.ts#L268) | |
| 11 | [QA-003: repeated fresh-context sign-ins are consistent](tests/00-auth.spec.ts#L301) | Regression guard |
| | **Authentication hardening** | |
| 12 | [AUTH-12: forgot-password page validates an empty email without sending a reset](tests/00-auth.spec.ts#L368) | |
| 13 | [AUTH-13: sign-up page renders its form without submitting](tests/00-auth.spec.ts#L381) | |
| 14 | [AUTH-14: whitespace-only email is rejected before the sign-in API](tests/00-auth.spec.ts#L395) | |
| 15 | [AUTH-14: over-long email and whitespace-only password are rejected before the sign-in API](tests/00-auth.spec.ts#L409) | ⚠ QA-029 |
| 16 | [SEC-16: login form without scripts must not put credentials in the URL](tests/00-auth.spec.ts#L428) | ⚠ QA-012 |
| 17 | [SEC-08/AUTH-15: post-login redirect stays on-origin and a logged-out token cannot be replayed](tests/00-auth.spec.ts#L439) | |

### 01 · Home: 12 tests

Spec: [`tests/01-home.spec.ts`](tests/01-home.spec.ts) · Page object: `HomePage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the owner dashboard with greeting and overview regions](tests/01-home.spec.ts#L14) | |
| 2 | [Renders every KPI card with a populated, well-formed value](tests/01-home.spec.ts#L29) | |
| 3 | [New task dialog opens with a project selector and closes cleanly](tests/01-home.spec.ts#L39) | |
| 4 | [Setup checklist exposes the expected link targets](tests/01-home.spec.ts#L46) | |
| 5 | [Setup checklist step "Add employees" opens /employees](tests/01-home.spec.ts#L56) | ⏭ step already complete |
| 6 | [Setup checklist step "Add offices" opens /settings/locations](tests/01-home.spec.ts#L56) | ⏭ step already complete |
| 7 | [Setup checklist step "Create a project" opens /projects](tests/01-home.spec.ts#L56) | ⏭ step already complete |
| 8 | [Setup checklist step "Build the schedule" opens /schedule](tests/01-home.spec.ts#L56) | ⏭ step already complete |
| 9 | [Quick access shortcuts point at the expected modules](tests/01-home.spec.ts#L79) | |
| 10 | [My day shows schedule, clock, leave and task shortcuts](tests/01-home.spec.ts#L86) | |
| 11 | [QA-007: loading skeletons are replaced by stable dashboard content](tests/01-home.spec.ts#L94) | Regression guard |
| 12 | [Global shell exposes all navigation and reports realtime status](tests/01-home.spec.ts#L122) | |

### 02 · Tasks: 7 tests

Spec: [`tests/02-tasks.spec.ts`](tests/02-tasks.spec.ts) · Page object: `TasksPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the task list with tabs, search and filters](tests/02-tasks.spec.ts#L15) | |
| 2 | [Keeps tab counts, selection, URL and zero-state copy in sync](tests/02-tasks.spec.ts#L25) | |
| 3 | [Shows the My Tasks zero state when no tasks are assigned](tests/02-tasks.spec.ts#L49) | ⏭ tasks assigned |
| 4 | [Search shows a no-match state and clearing it restores the list](tests/02-tasks.spec.ts#L65) | |
| 5 | [Combines Status and Priority filters, then clears them](tests/02-tasks.spec.ts#L87) | |
| 6 | [Filter popovers expose the expected option sets](tests/02-tasks.spec.ts#L109) | |
| 7 | [Date range filter exposes due-from and due-until inputs](tests/02-tasks.spec.ts#L116) | |

### 03 · Calendar: 7 tests

Spec: [`tests/03-calendar.spec.ts`](tests/03-calendar.spec.ts) · Page object: `CalendarPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the month view with navigation, layers and filters](tests/03-calendar.spec.ts#L17) | |
| 2 | [Moves between months and returns to the current month](tests/03-calendar.spec.ts#L27) | |
| 3 | [Switches to a seven-day week view and navigates weeks](tests/03-calendar.spec.ts#L57) | |
| 4 | [Toggles each event layer independently](tests/03-calendar.spec.ts#L95) | |
| 5 | [Applies Department, Project and Employee filters, then clears them](tests/03-calendar.spec.ts#L114) | |
| 6 | [Filter popovers expose options and search inputs](tests/03-calendar.spec.ts#L139) | |
| 7 | [Shows the empty-month copy over an intact grid](tests/03-calendar.spec.ts#L146) | ⏭ events scheduled |

### 04 · Schedule: 9 tests

Spec: [`tests/04-schedule.spec.ts`](tests/04-schedule.spec.ts) · Page object: `SchedulePage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the weekly schedule with toolbar, seven day columns and employee rows](tests/04-schedule.spec.ts#L15) | |
| 2 | [Switches Day, Week and Month views and navigates each period](tests/04-schedule.spec.ts#L32) | |
| 3 | [Navigates by whole weeks and returns to the current week](tests/04-schedule.spec.ts#L82) | |
| 4 | [Toggles My shifts and shows the personal empty state](tests/04-schedule.spec.ts#L112) | |
| 5 | [Filters employees by department and restores them when cleared](tests/04-schedule.spec.ts#L141) | |
| 6 | [Exposes department and office filter options](tests/04-schedule.spec.ts#L164) | |
| 7 | [Opens the Add shift draft dialog with defaults and cancels cleanly](tests/04-schedule.spec.ts#L173) | |
| 8 | [Gates publish and discard controls when there are no drafts](tests/04-schedule.spec.ts#L196) | ⏭ drafts exist |
| 9 | [Renders an empty schedule with zero hours and no broken values](tests/04-schedule.spec.ts#L210) | ⏭ shifts exist |

### 05 · Time clock: 5 tests

Spec: [`tests/05-time-clock.spec.ts`](tests/05-time-clock.spec.ts) · Page object: `TimeClockPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the time clock with live time, date and status](tests/05-time-clock.spec.ts#L16) | |
| 2 | [Shows the off-clock action, timer and location notice](tests/05-time-clock.spec.ts#L26) | ⏭ owner clocked in |
| 3 | [Lists project options and restores the No project selection](tests/05-time-clock.spec.ts#L42) | ⏭ clocked in / no projects |
| 4 | [Shows today's worked time, entry count and empty state](tests/05-time-clock.spec.ts#L82) | |
| 5 | [Shows the weekly total and seven-day chart](tests/05-time-clock.spec.ts#L103) | |

### 06 · Timesheets: 6 tests

Spec: [`tests/06-timesheets.spec.ts`](tests/06-timesheets.spec.ts) · Page object: `TimesheetsPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the current pay period with summaries and seven daily rows](tests/06-timesheets.spec.ts#L19) | |
| 2 | [Navigates by whole pay periods and returns to the current period](tests/06-timesheets.spec.ts#L52) | |
| 3 | [Switches between My timesheet and Team with URL-synced tabs](tests/06-timesheets.spec.ts#L83) | |
| 4 | [Renders team rows and gates Approve selected on row selection](tests/06-timesheets.spec.ts#L106) | |
| 5 | [Opens the Add entry dialog with defaults and cancels cleanly](tests/06-timesheets.spec.ts#L117) | |
| 6 | [Validates the manual entry reason and clock order without saving](tests/06-timesheets.spec.ts#L145) | |

### 07 · Leave: 6 tests

Spec: [`tests/07-leave.spec.ts`](tests/07-leave.spec.ts) · Page object: `LeavePage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads balance cards, tabs and the personal requests section](tests/07-leave.spec.ts#L20) | |
| 2 | [Syncs My leave, Requests and Calendar tabs with the URL](tests/07-leave.spec.ts#L42) | |
| 3 | [Lists request status filters and the team request queue state](tests/07-leave.spec.ts#L65) | |
| 4 | [Navigates the leave calendar by month and returns to today](tests/07-leave.spec.ts#L89) | |
| 5 | [Opens the Request leave dialog with defaults and cancels cleanly](tests/07-leave.spec.ts#L121) | |
| 6 | [Validates the date range and length without sending the request](tests/07-leave.spec.ts#L147) | Notes QA-013 |

### 08 · Labor cost: 6 tests

Spec: [`tests/08-labor-cost.spec.ts`](tests/08-labor-cost.spec.ts) · Page object: `LaborCostPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the report shell with the current week and export link](tests/08-labor-cost.spec.ts#L21) | |
| 2 | [Offers preset ranges and keeps labels and export dates in sync](tests/08-labor-cost.spec.ts#L56) | |
| 3 | [Renders each grouping with the matching columns and totals](tests/08-labor-cost.spec.ts#L92) | ⏭ no labor hours |
| 4 | [Applies and clears department and project filters](tests/08-labor-cost.spec.ts#L123) | |
| 5 | [Toggles Approved only and syncs the export query](tests/08-labor-cost.spec.ts#L149) | |
| 6 | [Supports a custom range with date pickers and an updated export](tests/08-labor-cost.spec.ts#L169) | |

### 09 · Payroll: 6 tests

Spec: [`tests/09-payroll.spec.ts`](tests/09-payroll.spec.ts) · Page object: `PayrollPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the last completed period with exports, note and empty state](tests/09-payroll.spec.ts#L26) | |
| 2 | [Navigates by whole weeks and resets to the last completed period](tests/09-payroll.spec.ts#L60) | |
| 3 | [Parses same-year and cross-year period labels](tests/09-payroll.spec.ts#L103) | |
| 4 | [Keeps week labels and export dates aligned across a year boundary](tests/09-payroll.spec.ts#L118) | ⏭ no year boundary within 12 weeks |
| 5 | [Shows the unapproved-timesheets warning with its team link](tests/09-payroll.spec.ts#L153) | ⏭ no unapproved timesheets |
| 6 | [Renders employee rows, totals and adjustment details when data exists](tests/09-payroll.spec.ts#L171) | ⏭ no approved timesheets |

### 10 · Working now: 4 tests

Spec: [`tests/10-working-now.spec.ts`](tests/10-working-now.spec.ts) · Page object: `WorkingNowPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the board with its location groups or empty state](tests/10-working-now.spec.ts#L15) | |
| 2 | [Keeps section counts, row copy, flags and clock-out actions in sync](tests/10-working-now.spec.ts#L44) | ⏭ nobody on the clock |
| 3 | [Opens and cancels the clock-out confirmation without changing rows](tests/10-working-now.spec.ts#L61) | ⏭ nobody on the clock |
| 4 | [Shows the on-leave-today card when people are on leave](tests/10-working-now.spec.ts#L96) | ⏭ nobody on leave |

### 11 · Chat: 8 tests

Spec: [`tests/11-chat.spec.ts`](tests/11-chat.spec.ts) · Page object: `ChatPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the workspace conversation, sidebar and composer](tests/11-chat.spec.ts#L20) | |
| 2 | [Filters conversations and searches channels without changing data](tests/11-chat.spec.ts#L54) | ⏭ no conversations |
| 3 | [Switches between workspace, department and project conversations](tests/11-chat.spec.ts#L112) | ⏭ only one conversation |
| 4 | [Shows the empty state and gates the composer on a draft](tests/11-chat.spec.ts#L148) | ⏭ conversation has messages |
| 5 | [Opens the new-channel dialog and cancels without creating a channel](tests/11-chat.spec.ts#L173) | |
| 6 | [Opens message search globally and scoped to the conversation](tests/11-chat.spec.ts#L190) | |
| 7 | [Shows members and starts a direct-message picker without submitting](tests/11-chat.spec.ts#L217) | |
| 8 | [Opens the emoji picker and mention suggestions without sending](tests/11-chat.spec.ts#L257) | |

### 12 · Announcements: 5 tests

Spec: [`tests/12-announcements.spec.ts`](tests/12-announcements.spec.ts) · Page object: `AnnouncementsPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the announcements module with tabs and empty state](tests/12-announcements.spec.ts#L13) | ⏭ announcements exist |
| 2 | [Switches between All and Unread tabs](tests/12-announcements.spec.ts#L30) | |
| 3 | [Opens the new-announcement dialog and cancels without posting](tests/12-announcements.spec.ts#L51) | |
| 4 | [Gates Post on a title and message, then clears the draft](tests/12-announcements.spec.ts#L69) | |
| 5 | [Toggles the audience and pin controls without saving](tests/12-announcements.spec.ts#L87) | |

### 13 · Notifications: 3 tests

Spec: [`tests/13-notifications.spec.ts`](tests/13-notifications.spec.ts) · Page object: `NotificationsPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the notifications module with tabs and empty state](tests/13-notifications.spec.ts#L13) | ⏭ notifications exist |
| 2 | [Switches between All and Unread tabs](tests/13-notifications.spec.ts#L30) | |
| 3 | [Keeps Mark all read disabled when there are no unread notifications](tests/13-notifications.spec.ts#L51) | |

### 14 · Projects: 10 tests

Spec: [`tests/14-projects.spec.ts`](tests/14-projects.spec.ts) · Page objects: `ProjectsPage`, `ProjectDetailPage`

| # | Test case | Notes |
|---:|---|---|
| | **Project list** | |
| 1 | [Loads the active projects list with its controls](tests/14-projects.spec.ts#L15) | |
| 2 | [Shows the expanded table columns and project roll-up values](tests/14-projects.spec.ts#L27) | |
| 3 | [Switches between Active, Overdue and Archived tabs](tests/14-projects.spec.ts#L40) | |
| 4 | [Switches the project layout between Table and Cards](tests/14-projects.spec.ts#L65) | |
| 5 | [Opens the new-project dialog and cancels without creating](tests/14-projects.spec.ts#L78) | |
| | **Project workspace** | |
| 6 | [Opens the Board, List and Milestones project tabs](tests/14-projects.spec.ts#L89) | |
| 7 | [Navigates the project calendar back to the current month](tests/14-projects.spec.ts#L105) | |
| 8 | [Shows the project chat and files surfaces without sending or uploading](tests/14-projects.spec.ts#L134) | |
| 9 | [Renders project settings with column/rule limits and gated danger actions](tests/14-projects.spec.ts#L146) | |
| 10 | [Exposes every project tab with its canonical URL](tests/14-projects.spec.ts#L154) | |

### 15 · Departments: 2 tests

Spec: [`tests/15-departments.spec.ts`](tests/15-departments.spec.ts) · Page object: `DepartmentsPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the department list](tests/15-departments.spec.ts#L13) | |
| 2 | [Opens the new-department dialog and cancels without creating](tests/15-departments.spec.ts#L23) | |

### 16 · Employees: 5 tests

Spec: [`tests/16-employees.spec.ts`](tests/16-employees.spec.ts) · Page object: `EmployeesPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the employee list with its controls](tests/16-employees.spec.ts#L12) | |
| 2 | [Search shows no match and clears back to the list](tests/16-employees.spec.ts#L19) | |
| 3 | [E-04: search finds employees by name and email, case-insensitively](tests/16-employees.spec.ts#L34) | |
| 4 | [Opens the add-members dialog and cancels without adding](tests/16-employees.spec.ts#L55) | |
| 5 | [E-06: employee deep page exposes the Profile/Schedule/Time/Leave/Pay tabs](tests/16-employees.spec.ts#L66) | |

### 17 · Settings: 9 tests

Spec: [`tests/17-settings.spec.ts`](tests/17-settings.spec.ts) · Page object: `SettingsPage`

| # | Test case | Notes |
|---:|---|---|
| 1 | [Loads the general settings with its navigation and controls](tests/17-settings.spec.ts#L25) | |
| 2 | [Keeps Save changes disabled for unchanged values](tests/17-settings.spec.ts#L34) | |
| 3 | [ST-04: offices sub-page renders tabs, empty state and New office dialog](tests/17-settings.spec.ts#L43) | |
| 4 | [ST-04: New office geofence radius defaults to 150m and rejects out-of-range input](tests/17-settings.spec.ts#L54) | |
| 5 | [ST-05: HR & Pay sub-page renders pay rules and keeps save disabled](tests/17-settings.spec.ts#L71) | |
| 6 | [ST-05: HR grace period rejects negative values without saving](tests/17-settings.spec.ts#L78) | |
| 7 | [ST-06: holidays sub-page renders year, empty state and navigation controls](tests/17-settings.spec.ts#L91) | |
| 8 | [ST-07: leave sub-page renders leave types and type actions](tests/17-settings.spec.ts#L98) | |
| 9 | [ST-08: plan & usage sub-page renders plan, upgrade path and limits note](tests/17-settings.spec.ts#L105) | |

---

## Cross-cutting test cases

### Security: transport, API and session: 10 tests

Spec: [`tests/11-security-api.spec.ts`](tests/11-security-api.spec.ts) · GET/OPTIONS requests only

| # | Test case | Notes |
|---:|---|---|
| 1 | [SEC-09: HTML responses send baseline security headers](tests/11-security-api.spec.ts#L49) | ⚠ QA-019 |
| 2 | [SEC-10: the login page refuses to render inside a third-party frame](tests/11-security-api.spec.ts#L66) | ⚠ QA-020 |
| 3 | [SEC-11: the API does not grant CORS access to foreign origins](tests/11-security-api.spec.ts#L90) | |
| 4 | [SEC-12: responses do not disclose server software versions](tests/11-security-api.spec.ts#L112) | ⚠ QA-021 |
| 5 | [SEC-13: data APIs reject anonymous requests](tests/11-security-api.spec.ts#L128) | |
| 6 | [SEC-14: the session API returns no credential material](tests/11-security-api.spec.ts#L157) | |
| 7 | [SEC-08: session cookies are HttpOnly, Secure and SameSite](tests/11-security-api.spec.ts#L178) | |
| 8 | [SEC-02/GEN-07: a non-member workspace URL exposes no workspace data](tests/11-security-api.spec.ts#L198) | |
| 9 | [SEC-17: unknown routes and API paths return clean errors without stack traces](tests/11-security-api.spec.ts#L219) | |
| 10 | [SEC-04: project descriptions contain no environment/config secrets](tests/11-security-api.spec.ts#L228) | ⚠ QA-002 |

### Security, responsive and edge cases: 7 tests

Spec: [`tests/11-security-edge-cases.spec.ts`](tests/11-security-edge-cases.spec.ts)

| # | Test case | Notes |
|---:|---|---|
| 1 | [SEC-01/GEN-07: unauthenticated deep links redirect to the login page](tests/11-security-edge-cases.spec.ts#L80) | |
| 2 | [SEC-05: script injection payloads in search and unsubmitted inputs stay inert](tests/11-security-edge-cases.spec.ts#L110) | |
| 3 | [SEC-06: CSV export is a safe download link and formula payloads stay inert](tests/11-security-edge-cases.spec.ts#L150) | |
| 4 | [NFR-08: realtime degradation on the unreachable host stays graceful](tests/11-security-edge-cases.spec.ts#L183) | |
| 5 | [NFR-03/GEN-08: mobile viewport avoids horizontal overflow](tests/11-security-edge-cases.spec.ts#L206) | |
| 6 | [NFR-03/GEN-08: mobile shell controls keep 44px tap targets](tests/11-security-edge-cases.spec.ts#L228) | ⚠ QA-014 |
| 7 | [NFR-03/GEN-08: desktop viewport avoids horizontal overflow on core pages](tests/11-security-edge-cases.spec.ts#L278) | |

### Global shell: 6 tests

Spec: [`tests/18-global-shell.spec.ts`](tests/18-global-shell.spec.ts)

| # | Test case | Notes |
|---:|---|---|
| 1 | [GEN-02: every sidebar link opens its module with the active state](tests/18-global-shell.spec.ts#L13) | |
| 2 | [GEN-03: global search finds a page and navigates to it](tests/18-global-shell.spec.ts#L25) | |
| 3 | [GEN-03: global search shows a no-results state for unknown terms](tests/18-global-shell.spec.ts#L39) | |
| 4 | [GEN-03: global search finds every sidebar module by name](tests/18-global-shell.spec.ts#L47) | ⚠ QA-023 |
| 5 | [GEN-04: workspace switcher marks the current workspace and gates creation at the plan limit](tests/18-global-shell.spec.ts#L63) | |
| 6 | [GEN-05: theme switch applies dark mode, persists on reload and is restored](tests/18-global-shell.spec.ts#L74) | |

### API contract and integration: 9 tests

Spec: [`tests/18-api-integration.spec.ts`](tests/18-api-integration.spec.ts) · GET requests only

| # | Test case | Notes |
|---:|---|---|
| 1 | [API-01: every read endpoint honours the response envelope contract](tests/18-api-integration.spec.ts#L44) | |
| 2 | [API-02: server-side validation rejects missing, malformed, reversed and oversized parameters with 422](tests/18-api-integration.spec.ts#L55) | |
| 3 | [API-03: unknown workspaces, resources and injected identifiers return a clean 404](tests/18-api-integration.spec.ts#L81) | |
| 4 | [API-04: Home, Employees, Projects and Plan pages show the counts the API returns](tests/18-api-integration.spec.ts#L94) | |
| 5 | [API-05: Tasks, Departments, Leave and Timesheets screens match their APIs](tests/18-api-integration.spec.ts#L140) | |
| 6 | [API-06: the API refuses submission of an empty timesheet](tests/18-api-integration.spec.ts#L183) | ⚠ QA-006 · ⏭ period has entries |
| 7 | [API-07: dates are computed in the workspace time zone and the server clock is correct](tests/18-api-integration.spec.ts#L192) | |
| 8 | [INT-09: the realtime (Socket.IO) host is reachable](tests/18-api-integration.spec.ts#L208) | ⚠ QA-001 |
| 9 | [INT-12: an analytics (PostHog) outage does not break the application](tests/18-api-integration.spec.ts#L224) | |

### Cross-module consistency: 8 tests

Spec: [`tests/18-integration-consistency.spec.ts`](tests/18-integration-consistency.spec.ts)

| # | Test case | Notes |
|---:|---|---|
| 1 | [INT-01/H-01: Home KPIs match the Employees, Projects and Working now modules](tests/18-integration-consistency.spec.ts#L55) | |
| 2 | [INT-02/ST-08: plan usage counts match the employee directory and projects list](tests/18-integration-consistency.spec.ts#L82) | |
| 3 | [INT-03: hours this week agree across Home, Time clock and Timesheets](tests/18-integration-consistency.spec.ts#L103) | |
| 4 | [INT-05: every module loads its data APIs with 2xx JSON responses](tests/18-integration-consistency.spec.ts#L122) | |
| 5 | [INT-07/LC-05: labor cost CSV export returns a well-formed CSV](tests/18-integration-consistency.spec.ts#L162) | |
| 6 | [INT-07/P-03: payroll CSV exports return well-formed CSVs](tests/18-integration-consistency.spec.ts#L174) | |
| 7 | [E-08: employee directory Export CSV has one row per employee](tests/18-integration-consistency.spec.ts#L188) | |
| 8 | [INT-08/D-03: department member counts match the employee directory](tests/18-integration-consistency.spec.ts#L201) | |

### Accessibility (WCAG 2.1 AA): 22 tests

Spec: [`tests/19-accessibility.spec.ts`](tests/19-accessibility.spec.ts) · axe-core scan; the axe JSON is attached to each result

**A11Y-01: no serious or critical axe violations** (one test per page):

| Page | Notes | Page | Notes |
|---|---|---|---|
| [Login](tests/19-accessibility.spec.ts#L63) | ⚠ QA-024 (not Firefox) | [Payroll](tests/19-accessibility.spec.ts#L78) | |
| [Home](tests/19-accessibility.spec.ts#L78) | | [Working now](tests/19-accessibility.spec.ts#L78) | ⚠ QA-024 |
| [Tasks](tests/19-accessibility.spec.ts#L78) | ⚠ QA-025 | [Chat](tests/19-accessibility.spec.ts#L78) | ⚠ QA-024 |
| [Calendar](tests/19-accessibility.spec.ts#L78) | ⚠ QA-026, QA-024 | [Announcements](tests/19-accessibility.spec.ts#L78) | ⚠ QA-025 |
| [Schedule](tests/19-accessibility.spec.ts#L78) | | [Notifications](tests/19-accessibility.spec.ts#L78) | ⚠ QA-025 |
| [Time clock](tests/19-accessibility.spec.ts#L78) | ⚠ QA-024 | [Projects](tests/19-accessibility.spec.ts#L78) | ⚠ QA-025 |
| [Timesheets](tests/19-accessibility.spec.ts#L78) | | [Departments](tests/19-accessibility.spec.ts#L78) | |
| [Leave](tests/19-accessibility.spec.ts#L78) | | [Employees](tests/19-accessibility.spec.ts#L78) | |
| [Labor cost](tests/19-accessibility.spec.ts#L78) | | [Settings](tests/19-accessibility.spec.ts#L78) | |

| # | Test case | Notes |
|---:|---|---|
| 19 | [A11Y-02: keyboard Tab order reaches the sidebar and main content with visible focus](tests/19-accessibility.spec.ts#L106) | |
| 20 | [A11Y-03: dialogs trap focus and close on Escape](tests/19-accessibility.spec.ts#L126) | |
| 21 | [A11Y-03: closing a dialog returns focus to its trigger](tests/19-accessibility.spec.ts#L142) | ⚠ QA-028 |
| 22 | [A11Y-05: every module has a title, page language and one main landmark](tests/19-accessibility.spec.ts#L157) | |

### Compatibility (screen resolutions): 4 tests

Spec: [`tests/19-compatibility.spec.ts`](tests/19-compatibility.spec.ts)

| # | Test case |
|---:|---|
| 1 | [COMP-07: core pages fit 320px small phone without horizontal scroll](tests/19-compatibility.spec.ts#L20) |
| 2 | [COMP-07: core pages fit 768px tablet portrait without horizontal scroll](tests/19-compatibility.spec.ts#L20) |
| 3 | [COMP-07: core pages fit 1024px tablet landscape without horizontal scroll](tests/19-compatibility.spec.ts#L20) |
| 4 | [COMP-07: core pages fit 1920px full HD without horizontal scroll](tests/19-compatibility.spec.ts#L20) |

### Performance (single-user timings): 7 tests

Spec: [`tests/19-performance.spec.ts`](tests/19-performance.spec.ts) · Runs only with `npm run test:perf` (1 worker); skipped in parallel runs. This is not a load test.

| # | Test case | Notes |
|---:|---|---|
| 1 | [PERF-01 (NFR-01): Home shows meaningful content within 3 s](tests/19-performance.spec.ts#L64) | |
| 2 | [PERF-01 (NFR-01): Labor cost shows meaningful content within 3 s](tests/19-performance.spec.ts#L64) | ⚠ QA-007 |
| 3 | [PERF-01 (NFR-01): Payroll shows meaningful content within 3 s](tests/19-performance.spec.ts#L64) | |
| 4 | [PERF-01 (NFR-01): Projects shows meaningful content within 3 s](tests/19-performance.spec.ts#L64) | |
| 5 | [PERF-01 (NFR-01): Tasks shows meaningful content within 3 s](tests/19-performance.spec.ts#L64) | |
| 6 | [PERF-02: module data APIs respond within the p95 budget](tests/19-performance.spec.ts#L93) | |
| 7 | [PERF-05: a cold Home load stays within the page-weight budget](tests/19-performance.spec.ts#L114) | |

### Resilience: 4 tests

Spec: [`tests/19-resilience.spec.ts`](tests/19-resilience.spec.ts) · Failures are simulated in the browser; nothing reaches the server

| # | Test case | Notes |
|---:|---|---|
| 1 | [NFR-08: API 500 responses show a friendly error with a working Try again](tests/19-resilience.spec.ts#L26) | |
| 2 | [NFR-08: navigating while offline keeps the app with a friendly message](tests/19-resilience.spec.ts#L44) | ⚠ QA-027 (not WebKit) |
| 3 | [PERF-06: the app recovers after a network outage](tests/19-resilience.spec.ts#L60) | |
| 4 | [NFR-08: slow API responses keep a loading state and then render](tests/19-resilience.spec.ts#L74) | |

### Role-based access control (RBAC): 25 tests

Spec: [`tests/20-rbac.spec.ts`](tests/20-rbac.spec.ts) · Project `roles-chrome` · Write probes are no-ops even if wrongly accepted

| ID | Check | Admin | Manager | Employee |
|---|---|:-:|:-:|:-:|
| [RBAC-01](tests/20-rbac.spec.ts#L98) | Sidebar shows only the destinations the role may use | ✓ | ✓ | ✓ |
| [RBAC-02](tests/20-rbac.spec.ts#L105) | Header Create menu offers only permitted actions | ✓ | ✓ | ✓ |
| [RBAC-03](tests/20-rbac.spec.ts#L110) | Payroll and labor cost available (Admin) / withheld (others) in UI and API | ✓ | ✓ | ✓ |
| [RBAC-04](tests/20-rbac.spec.ts#L130) | Working now and the business overview follow the role | ✓ | ✓ | ✓ |
| [RBAC-05](tests/20-rbac.spec.ts#L149) | Settings sections and controls match the role | ✓ | ✓ | ✓ |
| [RBAC-06](tests/20-rbac.spec.ts#L171) | Management actions in modules match the role | ✓ | ✓ | ✓ |
| [RBAC-07](tests/20-rbac.spec.ts#L180) | Another member's pay rates and pay fields are protected | ✓ | ✓ | ✓ |
| [RBAC-08](tests/20-rbac.spec.ts#L194) | The API refuses management writes (no-op probes) | | ✓ | ✓ |
| [RBAC-09](tests/20-rbac.spec.ts#L221) | Owner, Manager and Employee cannot read another tenant's workspace: one combined test (⏭ no foreign workspace) | — | ✓ | ✓ |
| [RBAC-10](tests/20-rbac.spec.ts#L245) | An empty Projects page offers employees no dead "Create project" button (⚠ QA-030) | | | ✓ |

### Platform admin console: 5 tests

Spec: [`tests/20-platform-admin.spec.ts`](tests/20-platform-admin.spec.ts) · Project `roles-chrome`

| # | Test case |
|---:|---|
| 1 | [PA-01: dashboard, user list and plans match the admin API](tests/20-platform-admin.spec.ts#L24) |
| 2 | [PA-02: workspace roles cannot reach the admin console or its API](tests/20-platform-admin.spec.ts#L79) |
| 3 | [PA-03: the platform admin has no workspace access of its own](tests/20-platform-admin.spec.ts#L44) |
| 4 | [PA-04: row actions: other users can be impersonated or banned, the admin itself cannot](tests/20-platform-admin.spec.ts#L51) |
| 5 | [PA-05: impersonation shows a banner, acts as the user and can be stopped](tests/20-platform-admin.spec.ts#L61) |

### Device compatibility smoke: 17 tests × 5 devices

Spec: [`tests/compat/compat-smoke.spec.ts`](tests/compat/compat-smoke.spec.ts) · Config: [`playwright.compat.config.ts`](playwright.compat.config.ts) · `npm run test:compat`

For each of the 17 modules (Home through Settings): *"&lt;Module&gt; loads, fits
the viewport and raises no page errors"*. Devices: Microsoft Edge (desktop),
Pixel 7, Galaxy S9+ (320 px), iPhone 15 and iPad Pro 11. Device emulation is
not a substitute for real iOS/Android hardware.

### Setup steps (not test cases)

| Step | Project | Purpose |
|---|---|---|
| [authenticate owner and save storage state](tests/auth.setup.ts#L12) | `setup` | Signs in once; module specs reuse the session |
| [create super admin and role sessions](tests/roles.setup.ts#L32) | `setup-roles` | Writes Admin / Manager / Employee sessions for `20-*` |

---

## Known defects tracked by the suite

Each confirmed defect is kept visible as `test.fail(true, 'QA-0xx: …')`. These
tests **pass while the bug reproduces** and appear under *Known defects* in the
bug report. When a defect is fixed, Playwright reports the test as failed
("expected to fail, but passed"). Remove the annotation at that point.

| ID | Defect | Test |
|---|---|---|
| QA-001 | Realtime host `api.mytaskforge.net` does not resolve | [INT-09](tests/18-api-integration.spec.ts#L208) |
| QA-002 | A project description contains an `.env`-style configuration template | [SEC-04](tests/11-security-api.spec.ts#L228) |
| QA-006 | API returns `canSubmit=true` for an empty open timesheet | [API-06](tests/18-api-integration.spec.ts#L183) |
| QA-007 | Labor cost takes 4.3–4.8 s to show content (budget 3 s) | [PERF-01 Labor cost](tests/19-performance.spec.ts#L64) |
| QA-012 | Pre-hydration / no-JS login submit sends credentials in the URL | [SEC-16](tests/00-auth.spec.ts#L428) |
| QA-014 | Mobile header controls are 32–40 px instead of 44 px | [NFR-03 tap targets](tests/11-security-edge-cases.spec.ts#L228) |
| QA-019 | Missing HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy | [SEC-09](tests/11-security-api.spec.ts#L49) |
| QA-020 | Login page can be framed (clickjacking) | [SEC-10](tests/11-security-api.spec.ts#L66) |
| QA-021 | `x-powered-by` discloses server software and version | [SEC-12](tests/11-security-api.spec.ts#L112) |
| QA-023 | Ctrl+K search finds nothing for several modules | [GEN-03](tests/18-global-shell.spec.ts#L47) |
| QA-024 | Text colour contrast below 4.5:1 | [A11Y-01](tests/19-accessibility.spec.ts#L49) (Login, Calendar, Time clock, Working now, Chat) |
| QA-025 | Tab triggers reference tab panels missing from the DOM | [A11Y-01](tests/19-accessibility.spec.ts#L49) (Tasks, Announcements, Notifications, Projects) |
| QA-026 | Calendar month grid lacks required grid/row ARIA structure | [A11Y-01 Calendar](tests/19-accessibility.spec.ts#L78) |
| QA-027 | Offline navigation shows the browser error page | [NFR-08 offline](tests/19-resilience.spec.ts#L44) |
| QA-028 | Closing a dialog does not return focus to its trigger | [A11Y-03](tests/19-accessibility.spec.ts#L142) |
| QA-029 | Over-long email and whitespace-only password reach the sign-in API | [AUTH-14](tests/00-auth.spec.ts#L409) |
| QA-030 | Employees see an enabled "Create project" button that does nothing | [RBAC-10](tests/20-rbac.spec.ts#L245) |

QA-003 and QA-007 (home skeletons) are covered by passing **regression guards**.
QA-013 is noted in the Leave dialog test, which never submits that state.

## Reports

Every run writes:

| Output | Open with | Contents |
|---|---|---|
| `playwright-report/` | `npm run report` | Playwright HTML report with traces |
| `dashboard-report/index.html` | `npm run dashboard` | Test-health dashboard (overview, failures, bug report, timeline, API) |
| `dashboard-report/bug-report.md` | Any Markdown viewer | Developer bug report: new bugs, known defects, not-verified tests |

Local runs are also archived to `qa/report-history/`. To archive a milestone run
with a label, use `npm run report:archive -- <label>`.

Don't pass `--reporter` on its own: it replaces the configured reporters and the
dashboard is not updated. See the [detailed guide](tests/README.md#reports).

## Contributing

- **Page Object Model:** specs call page-object methods only. Never use
  `page.locator(...)` in a spec; add a method to the page object in `pages/`.
- **Stay read-only:** cancel dialogs, clear drafts, inspect exports through
  their links. Mutating tests need a staging workspace and explicit approval.
- **Data-dependent tests** use `test.skip(condition, reason)` so they show as
  *Not verified* instead of failing.
- **Confirmed app bugs** use `test.fail(true, 'QA-0xx: …')` and get a row in
  [Known defects](#known-defects-tracked-by-the-suite).
- **Numbering:** `01`–`19` are picked up by the `modules-*` projects, and `20-*`
  by `roles-chrome`.
- **Keep this README in sync:** when you add or rename a test, update its
  module table. `npx playwright test --list` prints every test with its line.
- Run `npm run typecheck` and `npm run test:unit` before pushing; CI runs both.
