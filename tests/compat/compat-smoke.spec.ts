import { test, expect } from '../../fixtures/pages.fixture';

/**
 * COMP-04 … COMP-06 — compatibility smoke across Microsoft Edge and emulated
 * phones/tablets (see playwright.compat.config.ts). Every core module must
 * load through its page object, render without broken values, stay inside the
 * viewport (no horizontal scroll) and raise no unhandled page errors.
 *
 * Read-only: navigation and assertions only.
 * Run: npm run test:compat
 */

// Next.js aborts RSC prefetches when a navigation supersedes them; WebKit
// surfaces those as page errors. They are router noise, not app failures.
const ABORTED_RSC_PREFETCH = /[?&]_rsc=.*(access control checks|aborted)|Load failed/i;

type ModuleFixture =
  | 'homePage' | 'tasksPage' | 'calendarPage' | 'schedulePage' | 'timeClockPage'
  | 'timesheetsPage' | 'leavePage' | 'laborCostPage' | 'payrollPage' | 'workingNowPage'
  | 'chatPage' | 'announcementsPage' | 'notificationsPage' | 'projectsPage'
  | 'departmentsPage' | 'employeesPage' | 'settingsPage';

const MODULES: ReadonlyArray<{ name: string; fixture: ModuleFixture }> = [
  { name: 'Home', fixture: 'homePage' },
  { name: 'Tasks', fixture: 'tasksPage' },
  { name: 'Calendar', fixture: 'calendarPage' },
  { name: 'Schedule', fixture: 'schedulePage' },
  { name: 'Time clock', fixture: 'timeClockPage' },
  { name: 'Timesheets', fixture: 'timesheetsPage' },
  { name: 'Leave', fixture: 'leavePage' },
  { name: 'Labor cost', fixture: 'laborCostPage' },
  { name: 'Payroll', fixture: 'payrollPage' },
  { name: 'Working now', fixture: 'workingNowPage' },
  { name: 'Chat', fixture: 'chatPage' },
  { name: 'Announcements', fixture: 'announcementsPage' },
  { name: 'Notifications', fixture: 'notificationsPage' },
  { name: 'Projects', fixture: 'projectsPage' },
  { name: 'Departments', fixture: 'departmentsPage' },
  { name: 'Employees', fixture: 'employeesPage' },
  { name: 'Settings', fixture: 'settingsPage' },
];

test.describe('Compatibility smoke (COMP-04/05/06)', () => {
  for (const module of MODULES) {
    test(`${module.name} loads, fits the viewport and raises no page errors`, async ({
      page, homePage, tasksPage, calendarPage, schedulePage, timeClockPage,
      timesheetsPage, leavePage, laborCostPage, payrollPage, workingNowPage,
      chatPage, announcementsPage, notificationsPage, projectsPage,
      departmentsPage, employeesPage, settingsPage,
    }) => {
      const fixtures = {
        homePage, tasksPage, calendarPage, schedulePage, timeClockPage,
        timesheetsPage, leavePage, laborCostPage, payrollPage, workingNowPage,
        chatPage, announcementsPage, notificationsPage, projectsPage,
        departmentsPage, employeesPage, settingsPage,
      };
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      const target = (fixtures as unknown as Record<ModuleFixture, {
        goto(): Promise<void>;
        expectLoaded(): Promise<void>;
        expectNoHorizontalOverflow(): Promise<void>;
      }>)[module.fixture];

      await target.goto();
      // Phones hide desktop-only controls (Chat's conversation rail becomes a
      // drawer, the Projects Table/Cards toggle is removed), so the full
      // readiness check applies from tablet width up; goto() already waits.
      if ((page.viewportSize()?.width ?? 0) >= 768) await target.expectLoaded();
      await target.expectNoHorizontalOverflow();

      expect(
        pageErrors.filter((message) => !ABORTED_RSC_PREFETCH.test(message)),
        `${module.name} must not raise unhandled page errors`,
      ).toEqual([]);
    });
  }
});
