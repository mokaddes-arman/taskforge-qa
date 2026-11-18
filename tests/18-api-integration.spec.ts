import { request as playwrightRequest } from '@playwright/test';
import { test, expect } from '../fixtures/pages.fixture';
import {
  TaskForgeApi, WS_API, WORKSPACE_SLUG, expectErrorEnvelope, expectSuccessEnvelope, isoDateIn, weekRange,
} from '../utils/api';

/**
 * Integration — API layer (API-01…API-07, INT-09/10/11).
 *
 * Frontend ↔ backend integration through the same REST API the web app uses:
 * response contract, server-side validation and error handling, API ↔ UI data
 * consistency and third-party dependencies. GET requests only (the saved owner
 * session is reused); no record is created, changed or deleted. Response
 * values are compared, never written to the report beyond counts.
 *
 * Run: npm run test:modules:chrome -- tests/18-api-integration.spec.ts
 */

/** Read endpoints the 17 modules call on load (from the 17 Nov recon). */
const READ_ENDPOINTS = [
  '/api/v1/workspaces',
  '/api/v1/workspaces/owned-limit',
  '/api/v1/plans',
  '/api/v1/timer',
  '/api/v1/chat/unread',
  '/api/v1/notifications/unread-counts',
  ...[
    '', '/announcements', '/announcements/unread-count', '/channel-chat/unread', '/channels', '/chat/messages',
    '/dashboard', '/dashboard/my-day', '/dashboard/overview', '/dm', '/hr-settings', '/leave/balances',
    '/leave/requests', '/leave/types', '/locations', '/members', '/notifications', '/plan', '/projects',
    '/reports/job-budgets', '/reports/payroll', '/storage', '/tasks', '/team-chat/unread', '/teams',
    '/time-clock', '/time-clock/working-now', '/timesheets',
  ].map((segment) => `${WS_API}${segment}`),
];

/** Endpoints that require a date range (max 42 days). */
const RANGED_ENDPOINTS = ['/calendar', '/reports/labor-cost', '/shifts', '/time-clock/entries'].map((s) => `${WS_API}${s}`);

type Overview = { today: string; cards: { employees: number; workingNow: number; openJobs: number; hoursThisWeekMinutes: number } };
type Plan = { limits: { maxMembers: number; maxProjects: number }; usage: { members: number; projects: number } };
type Timesheet = { periodStart: string; periodEnd: string; status: string; totals: { total: number }; canSubmit: boolean };

test.describe('Integration — API contract and API ↔ UI consistency', () => {
  test('API-01: every read endpoint honours the response envelope contract', async ({ page }) => {
    const api = new TaskForgeApi(page.request);
    const week = weekRange(isoDateIn('Asia/Dhaka'));
    const paths = [...READ_ENDPOINTS, ...RANGED_ENDPOINTS.map((p) => `${p}?from=${week.from}&to=${week.to}`)];

    for (const path of paths) {
      expectSuccessEnvelope(path, await api.get(path));
    }
    test.info().annotations.push({ type: 'endpoints', description: `${paths.length} endpoints honour {success,data,message,statusCode,path}` });
  });

  test('API-02: server-side validation rejects missing, malformed, reversed and oversized parameters with 422', async ({ page }) => {
    const api = new TaskForgeApi(page.request);

    for (const path of RANGED_ENDPOINTS) {
      const result = await api.get(path);
      expectErrorEnvelope(path, result, 422, 'VALIDATION_ERROR');
      expect(Object.keys(result.body.error?.details ?? {}), `${path}: names the missing fields`).toEqual(expect.arrayContaining(['from', 'to']));
    }

    const labor = `${WS_API}/reports/labor-cost`;
    const malformed = await api.get(`${labor}?from=not-a-date&to=2026-11-22`);
    expectErrorEnvelope(labor, malformed, 422, 'VALIDATION_ERROR');
    expect(malformed.body.error?.details?.from, 'Explains the malformed date').toMatch(/date/i);

    expectErrorEnvelope(labor, await api.get(`${labor}?from=2026-11-22&to=2026-11-16`), 422, 'UNPROCESSABLE_ENTITY');
    const oversized = await api.get(`${WS_API}/shifts?from=1900-01-01&to=2999-12-31`);
    expectErrorEnvelope('shifts', oversized, 422, 'UNPROCESSABLE_ENTITY');
    expect(oversized.body.message, 'Explains the range limit').toMatch(/42 days/);

    const badEnum = await api.get(`${WS_API}/tasks?view=__nope__`);
    expectErrorEnvelope('tasks', badEnum, 422, 'VALIDATION_ERROR');
    expect(badEnum.body.error?.details?.view, 'Lists the allowed values').toMatch(/MY, TEAM, OVERDUE, UPCOMING, COMPLETED/);

    expectErrorEnvelope('payroll', await api.get(`${WS_API}/reports/payroll?periodStart=garbage`), 422, 'VALIDATION_ERROR');
  });

  test('API-03: unknown workspaces, resources and injected identifiers return a clean 404', async ({ page }) => {
    const api = new TaskForgeApi(page.request);
    const cases = [
      '/api/v1/workspaces/qa-nonexistent-ws-zz9/members',
      `${WS_API}/projects/00000000-0000-0000-0000-000000000000`,
      `${WS_API}/qa-not-a-resource`,
      `/api/v1/workspaces/${WORKSPACE_SLUG}'%20OR%201=1--/members`,
    ];
    for (const path of cases) {
      expectErrorEnvelope(path, await api.get(path), 404, 'NOT_FOUND');
    }
  });

  test('API-04: Home, Employees, Projects and Plan pages show the counts the API returns', async ({
    page, homePage, employeesPage, projectsPage, settingsPage, workingNowPage,
  }) => {
    const api = new TaskForgeApi(page.request);
    const overview = await api.data<Overview>(`${WS_API}/dashboard/overview`);
    const members = await api.data<unknown[]>(`${WS_API}/members`);
    const projects = await api.data<Array<{ archivedAt: string | null }>>(`${WS_API}/projects`);
    const plan = await api.data<Plan>(`${WS_API}/plan`);
    const activeProjects = projects.filter((p) => !p.archivedAt).length;

    // API internal consistency first.
    expect(overview.cards.employees, 'overview.employees = members').toBe(members.length);
    expect(plan.usage.members, 'plan.usage.members = members').toBe(members.length);
    expect(overview.cards.openJobs, 'overview.openJobs = active projects').toBe(activeProjects);
    expect(plan.usage.projects, 'plan.usage.projects = projects').toBe(projects.length);

    // Then every screen against the API.
    await homePage.goto();
    const kpi = async (label: string) => Number(((await homePage.kpiValue(label).textContent()) ?? '').replace(/,/g, ''));
    expect(await kpi('Employees'), 'Home Employees KPI = API').toBe(overview.cards.employees);
    expect(await kpi('Working now'), 'Home Working now KPI = API').toBe(overview.cards.workingNow);
    expect(await kpi('Open projects'), 'Home Open projects KPI = API').toBe(overview.cards.openJobs);

    await employeesPage.goto();
    await employeesPage.expectLoaded();
    expect(await employeesPage.employeeCount(), 'Employee directory = API members').toBe(members.length);

    await projectsPage.goto();
    await projectsPage.expectLoaded();
    expect(await projectsPage.projectCount(), 'Projects table = API active projects').toBe(activeProjects);

    await settingsPage.gotoPlan();
    await settingsPage.expectPlanLoaded();
    expect(await settingsPage.planUsage('Members'), 'Plan page members = API').toEqual({ used: plan.usage.members, limit: plan.limits.maxMembers });
    expect(await settingsPage.planUsage('Projects'), 'Plan page projects = API').toEqual({ used: plan.usage.projects, limit: plan.limits.maxProjects });

    const workingNow = await api.data<{ locations: Array<{ onTheClock: unknown[]; onBreak: unknown[] }> }>(`${WS_API}/time-clock/working-now`);
    const apiWorking = workingNow.locations.reduce((sum, l) => sum + l.onTheClock.length + l.onBreak.length, 0);
    expect(apiWorking, 'working-now API = overview workingNow').toBe(overview.cards.workingNow);
    await workingNowPage.goto();
    await workingNowPage.expectLoaded();
    const snapshot = await workingNowPage.snapshot();
    const uiWorking = snapshot.locations.reduce((sum, l) => sum + l.onTheClock.count + (l.onBreak?.count ?? 0), 0);
    expect(uiWorking, 'Working now board = API').toBe(apiWorking);
  });

  test('API-05: Tasks, Departments, Leave and Timesheets screens match their APIs', async ({
    page, tasksPage, departmentsPage, leavePage, timesheetsPage,
  }) => {
    test.slow();
    const api = new TaskForgeApi(page.request);

    const tasks = await api.data<{ counts: Record<'MY' | 'TEAM' | 'OVERDUE' | 'UPCOMING' | 'COMPLETED', number> }>(`${WS_API}/tasks`);
    await tasksPage.goto();
    await tasksPage.waitForTaskCounts();
    expect(await tasksPage.tabCounts(), 'Task tab badges = API counts (My, Team, Overdue, Upcoming, Completed)')
      .toEqual([tasks.counts.MY, tasks.counts.TEAM, tasks.counts.OVERDUE, tasks.counts.UPCOMING, tasks.counts.COMPLETED]);

    const teams = await api.data<Array<{ name: string; memberCount: number }>>(`${WS_API}/teams`);
    await departmentsPage.goto();
    await departmentsPage.expectLoaded();
    expect(await departmentsPage.memberCounts(), 'Department list = API teams')
      .toEqual(Object.fromEntries(teams.map((t) => [t.name, t.memberCount])));

    const balances = await api.data<Array<{ leaveType: { name: string }; availableDays: number | null }>>(`${WS_API}/leave/balances`);
    await leavePage.goto();
    await leavePage.expectLoaded();
    const leaveText = await leavePage.balanceSectionText();
    for (const balance of balances) {
      expect(leaveText, `Leave card "${balance.leaveType.name}"`).toContain(balance.leaveType.name.replace(/ leave$/i, ''));
      if (balance.availableDays !== null) {
        expect(leaveText, `${balance.leaveType.name}: ${balance.availableDays} days available`).toMatch(new RegExp(`\\b${balance.availableDays}\\b`));
      }
    }

    const sheet = await api.data<Timesheet>(`${WS_API}/timesheets`);
    const hr = await api.data<{ weekStartsOn: string }>(`${WS_API}/hr-settings`);
    await timesheetsPage.goto();
    await timesheetsPage.expectLoaded();
    const range = await timesheetsPage.periodRange();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect({ start: iso(range.start), end: iso(range.end) }, 'Timesheet period on screen = API').toEqual({ start: sheet.periodStart, end: sheet.periodEnd });
    const startDay = new Date(`${sheet.periodStart}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    expect(startDay.toUpperCase(), 'Pay period starts on the HR week-start day').toBe(hr.weekStartsOn.toUpperCase());
    const total = await timesheetsPage.totalDuration();
    const minutes = Number(total.match(/(\d+)\s*h/)?.[1] ?? 0) * 60 + Number(total.match(/(\d+)\s*m/)?.[1] ?? 0);
    expect(minutes, 'Timesheet total on screen = API total minutes').toBe(sheet.totals.total);
  });

  test('API-06 (QA-006): the API refuses submission of an empty timesheet', async ({ page }) => {
    const api = new TaskForgeApi(page.request);
    const sheet = await api.data<Timesheet>(`${WS_API}/timesheets`);
    test.skip(sheet.totals.total > 0, 'Current period has entries; the empty-timesheet rule cannot be checked.');
    test.fail(true, 'QA-006: GET /timesheets returns canSubmit=true for an OPEN period with 0 minutes — the rule is missing server-side, not only in the UI.');

    expect(sheet.canSubmit, `Empty ${sheet.status} timesheet must not be submittable`).toBe(false);
  });

  test('API-07: dates are computed in the workspace time zone and the server clock is correct', async ({ page }) => {
    const api = new TaskForgeApi(page.request);
    const workspace = await api.data<{ timezone: string }>(WS_API);
    const overview = await api.data<Overview>(`${WS_API}/dashboard/overview`);
    expect(overview.today, `dashboard "today" is the current date in ${workspace.timezone}`).toBe(isoDateIn(workspace.timezone));

    // Compare the app's serverTime with Cloudflare's edge Date header (NTP-synced),
    // not with the QA workstation clock.
    const response = await page.request.get(`${WS_API}/time-clock`);
    const edge = Date.parse(response.headers()['date'] ?? '');
    const server = Date.parse(((await response.json()) as { data: { serverTime: string } }).data.serverTime);
    expect(Math.abs(server - edge), 'Application server clock within 5 s of the edge clock').toBeLessThan(5_000);
  });
});

test.describe('Integration — third-party dependencies', () => {
  test('INT-09 (QA-001): the realtime (Socket.IO) host is reachable', async () => {
    test.fail(true, 'QA-001: api.mytaskforge.net does not resolve (ERR_NAME_NOT_RESOLVED / ENOTFOUND).');
    const context = await playwrightRequest.newContext();
    let outcome = 'no response';
    try {
      const response = await context.get('https://api.mytaskforge.net/socket.io/?EIO=4&transport=polling', { timeout: 15_000, failOnStatusCode: false });
      outcome = `HTTP ${response.status()}`;
    } catch (error) {
      outcome = String(error).split('\n')[0];
    } finally {
      await context.dispose();
    }
    test.info().annotations.push({ type: 'realtime-host', description: outcome });
    expect(outcome, 'Socket.IO handshake answers over HTTP').toMatch(/^HTTP [23]\d\d$/);
  });

  test('INT-12: an analytics (PostHog) outage does not break the application', async ({ page, homePage, tasksPage }) => {
    const blocked: string[] = [];
    await page.route(/posthog|i\.posthog\.com|us-assets\.i\.posthog/i, async (route) => {
      blocked.push(new URL(route.request().url()).hostname);
      await route.abort('failed');
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await homePage.goto();
    await homePage.expectLoaded();
    await tasksPage.goto();
    await tasksPage.expectLoaded();

    test.info().annotations.push({ type: 'analytics-requests-blocked', description: `${blocked.length} (${[...new Set(blocked)].join(', ') || 'none'})` });
    // WebKit reports the dead realtime host's Socket.IO polling (QA-001, covered by
    // INT-09) as page errors; only analytics-related breakage is judged here.
    expect(errors.filter((e) => !/_rsc=|posthog|socket\.io/i.test(e)), 'No application errors when analytics is unavailable').toEqual([]);
  });
});
