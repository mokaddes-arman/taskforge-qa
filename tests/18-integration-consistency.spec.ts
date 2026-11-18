import { test, expect } from '../fixtures/pages.fixture';
import { env } from '../utils/env';

/**
 * Integration — cross-module data consistency and frontend↔backend contracts
 * (INT-01/02/03/05/07/08, H-01, ST-08, LC-05, P-03, D-03, E-08).
 *
 * Read-only. Values are read from each module's own UI (or its export) and
 * compared; nothing is created or changed. CSV exports are downloaded and
 * parsed in memory only.
 */

const ORIGIN = new URL(env.baseURL).origin;

/** "1h 30m" / "45m" / "2h" -> minutes. */
function toMinutes(value: string): number {
  const hours = Number(value.match(/(\d+)\s*h/)?.[1] ?? 0);
  const minutes = Number(value.match(/(\d+)\s*m/)?.[1] ?? 0);
  return hours * 60 + minutes;
}

/** Minimal RFC 4180 parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const body = text.replace(/^﻿/, '');
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function expectWellFormedCsv(label: string, rows: string[][]): void {
  expect(rows.length, `${label}: has a header row`).toBeGreaterThanOrEqual(1);
  const width = rows[0].length;
  expect(width, `${label}: header has several columns`).toBeGreaterThan(1);
  rows[0].forEach((header) => expect(header.trim(), `${label}: header cells are named`).not.toBe(''));
  rows.forEach((row, index) => expect(row.length, `${label}: row ${index + 1} has ${width} columns`).toBe(width));
}

test.describe('Integration — cross-module consistency', () => {
  test('INT-01/H-01: Home KPIs match the Employees, Projects and Working now modules', async ({
    homePage, employeesPage, projectsPage, workingNowPage,
  }) => {
    await homePage.goto();
    await homePage.expectKpis();
    const kpi = async (label: string) => Number(((await homePage.kpiValue(label).textContent()) ?? '').replace(/,/g, ''));
    const home = { employees: await kpi('Employees'), working: await kpi('Working now'), projects: await kpi('Open projects') };

    await employeesPage.goto();
    await employeesPage.expectLoaded();
    const employees = await employeesPage.employeeCount();

    await projectsPage.goto();
    await projectsPage.expectLoaded();
    const projects = await projectsPage.projectCount();

    await workingNowPage.goto();
    await workingNowPage.expectLoaded();
    const snapshot = await workingNowPage.snapshot();
    const working = snapshot.locations.reduce((sum, location) => sum + location.onTheClock.count + (location.onBreak?.count ?? 0), 0);

    test.info().annotations.push({ type: 'values', description: `Home ${JSON.stringify(home)} vs modules ${JSON.stringify({ employees, working, projects })}` });
    expect(home.employees, 'Employees KPI = employee directory count').toBe(employees);
    expect(home.projects, 'Open projects KPI = active projects in the Projects table').toBe(projects);
    expect(home.working, 'Working now KPI = people on the clock or on break').toBe(working);
  });

  test('INT-02/ST-08: plan usage counts match the employee directory and projects list', async ({
    settingsPage, employeesPage, projectsPage,
  }) => {
    await settingsPage.gotoPlan();
    await settingsPage.expectPlanLoaded();
    const members = await settingsPage.planUsage('Members');
    const projectUsage = await settingsPage.planUsage('Projects');

    await employeesPage.goto();
    await employeesPage.expectLoaded();
    const employees = await employeesPage.employeeCount();
    await projectsPage.goto();
    await projectsPage.expectLoaded();
    const projects = await projectsPage.projectCount();

    expect(members.used, 'Members used = employee directory count').toBe(employees);
    expect(projectUsage.used, 'Projects used = projects in the list').toBe(projects);
    expect(members.used).toBeLessThanOrEqual(members.limit);
    expect(projectUsage.used).toBeLessThanOrEqual(projectUsage.limit);
  });

  test('INT-03: hours this week agree across Home, Time clock and Timesheets', async ({
    homePage, timeClockPage, timesheetsPage,
  }) => {
    await homePage.goto();
    const home = toMinutes((await homePage.kpiValue('Hours this week').textContent()) ?? '');

    await timeClockPage.goto();
    await timeClockPage.expectLoaded();
    const clock = toMinutes(await timeClockPage.weekTotal());

    await timesheetsPage.goto();
    await timesheetsPage.expectLoaded();
    const sheet = toMinutes(await timesheetsPage.totalDuration());

    test.info().annotations.push({ type: 'values', description: `Home ${home} min, Time clock ${clock} min, Timesheets ${sheet} min` });
    expect(clock, 'Time clock week total = Home "Hours this week"').toBe(home);
    expect(sheet, 'Timesheets current-period total = Home "Hours this week" (weekly pay period)').toBe(home);
  });

  test('INT-05: every module loads its data APIs with 2xx JSON responses', async ({
    page, homePage, tasksPage, calendarPage, schedulePage, timeClockPage, timesheetsPage, leavePage,
    laborCostPage, payrollPage, workingNowPage, chatPage, announcementsPage, notificationsPage,
    projectsPage, departmentsPage, employeesPage, settingsPage,
  }) => {
    test.slow(); // 17 full module loads.
    const problems: string[] = [];
    let checked = 0;
    let unverified = 0;
    page.on('response', async (response) => {
      const url = new URL(response.url());
      if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/') || url.pathname.startsWith('/api/v1/auth/')) return;
      if (response.request().method() !== 'GET') return;
      if (response.status() === 304) return;
      checked += 1;
      if (response.status() >= 400) {
        problems.push(`${response.status()} ${url.pathname}`);
        return;
      }
      // headers() is synchronous; Firefox leaves it empty for some cached
      // responses, so fall back to allHeaders() (which fails once the page has
      // navigated away — those responses are counted as unverified, not failed).
      const type = response.headers()['content-type']
        ?? (await response.allHeaders().catch(() => ({} as Record<string, string>)))['content-type'];
      if (!type) unverified += 1;
      else if (response.status() !== 204 && !/application\/json/.test(type)) problems.push(`non-JSON (${type}) ${url.pathname}`);
    });

    for (const module of [homePage, tasksPage, calendarPage, schedulePage, timeClockPage, timesheetsPage, leavePage,
      laborCostPage, payrollPage, workingNowPage, chatPage, announcementsPage, notificationsPage,
      projectsPage, departmentsPage, employeesPage, settingsPage]) {
      await module.goto();
      await module.expectLoaded();
    }

    test.info().annotations.push({ type: 'api-responses', description: `${checked} data API responses checked; content-type unreadable for ${unverified}` });
    expect(checked, 'Modules should call data APIs').toBeGreaterThan(17);
    expect(problems, 'Failed or non-JSON data API responses').toEqual([]);
  });

  test('INT-07/LC-05: labor cost CSV export returns a well-formed CSV', async ({ page, laborCostPage }) => {
    await laborCostPage.goto();
    await laborCostPage.expectLoaded();
    const url = await laborCostPage.exportUrl();

    const response = await page.request.get(url.toString());
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type'] ?? '').toMatch(/text\/csv/);
    expect(response.headers()['content-disposition'] ?? '', 'Served as a file download').toMatch(/attachment/i);
    expectWellFormedCsv('Labor cost CSV', parseCsv(await response.text()));
  });

  test('INT-07/P-03: payroll CSV exports return well-formed CSVs', async ({ page, payrollPage }) => {
    await payrollPage.goto();
    await payrollPage.expectLoaded();

    for (const [label, link] of [['summary', payrollPage.exportLink], ['detail', payrollPage.exportDetailLink]] as const) {
      const href = await link.getAttribute('href');
      expect(href, `Payroll ${label} export link`).toBeTruthy();
      const response = await page.request.get(new URL(href!, ORIGIN).toString());
      expect(response.status(), `Payroll ${label} export status`).toBe(200);
      expect(response.headers()['content-type'] ?? '').toMatch(/text\/csv/);
      expectWellFormedCsv(`Payroll ${label} CSV`, parseCsv(await response.text()));
    }
  });

  test('E-08: employee directory Export CSV has one row per employee', async ({ employeesPage }) => {
    await employeesPage.goto();
    await employeesPage.expectLoaded();
    const total = await employeesPage.employeeCount();

    const { filename, text } = await employeesPage.downloadExport();
    const rows = parseCsv(text);
    expect(filename, 'Download is a .csv file').toMatch(/\.csv$/i);
    expectWellFormedCsv('Employees CSV', rows);
    expect(rows.length - 1, 'One data row per employee in the directory').toBe(total);
    test.info().annotations.push({ type: 'csv-columns', description: rows[0].join(' | ') });
  });

  test('INT-08/D-03: department member counts match the employee directory', async ({ departmentsPage, employeesPage }) => {
    await departmentsPage.goto();
    await departmentsPage.expectLoaded();
    const counts = await departmentsPage.memberCounts();
    expect(Object.keys(counts).length, 'At least one department with a member count').toBeGreaterThan(0);

    await employeesPage.goto();
    await employeesPage.expectLoaded();
    const rows = parseCsv((await employeesPage.downloadExport()).text);
    const deptColumn = rows[0].findIndex((header) => /department/i.test(header));
    expect(deptColumn, `Employees CSV has a Department column (${rows[0].join(', ')})`).toBeGreaterThanOrEqual(0);

    for (const [department, members] of Object.entries(counts)) {
      const inDirectory = rows.slice(1).filter((row) => row[deptColumn].split(/[;,]/).map((d) => d.trim()).includes(department)).length;
      expect(inDirectory, `Department "${department}": list says ${members} member(s)`).toBe(members);
    }
  });
});
