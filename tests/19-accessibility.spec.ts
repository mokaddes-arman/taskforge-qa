import { test, expect } from '../fixtures/pages.fixture';
import { LoginPage } from '../pages/LoginPage';
import { scanAccessibility, seriousOrCritical } from '../utils/a11y';

/**
 * Usability & accessibility (A11Y-01/02/03/05, NFR-04).
 *
 * - A11Y-01: axe-core WCAG 2.1 A/AA scan of the login page and all 17
 *   modules. Serious/critical violations fail the test; the full axe result is
 *   attached as JSON evidence for every page (also when it passes).
 * - A11Y-02: keyboard-only navigation reaches the sidebar and main content and
 *   every stop has a visible focus indicator (WCAG 2.1.1, 2.4.7).
 * - A11Y-03: modal dialogs keep focus inside, close on Escape and return focus
 *   to the trigger (WCAG 2.4.3).
 * - A11Y-05: every module has a document title, a page language and exactly
 *   one main landmark (WCAG 2.4.2, 3.1.1, 1.3.1).
 *
 * Automated rules find roughly a third of WCAG issues; a manual screen-reader
 * pass (A11Y-06) is still required. Read-only: dialogs are cancelled.
 */

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

/** Known axe defects, keyed by module, confirmed during the 17 Nov 2026 audit. */
const CONTRAST = 'QA-024: text/background colour contrast below 4.5:1 (axe color-contrast, serious).';
const TAB_ARIA = 'QA-025: Radix tab triggers reference tab panels that are not in the DOM (axe aria-valid-attr-value, critical).';
const KNOWN_AXE_DEFECTS: Partial<Record<string, string>> = {
  Tasks: TAB_ARIA,
  Notifications: TAB_ARIA,
  Announcements: TAB_ARIA,
  Projects: TAB_ARIA,
  Calendar: 'QA-026: month grid cells lack the required grid/row ARIA structure (aria-required-children/parent, critical) plus QA-024 contrast.',
  'Time clock': CONTRAST,
  'Working now': CONTRAST,
  Chat: CONTRAST,
};

test.describe('Accessibility (WCAG 2.1 AA)', () => {
  test('A11Y-01: Login page has no serious or critical WCAG 2.1 AA violations', async ({ browser, browserName }, testInfo) => {
    // Firefox's axe run cannot resolve the gradient behind the hero text, so it
    // reports the contrast nodes as "incomplete" instead of violations.
    test.fail(browserName !== 'firefox', CONTRAST);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    await loginPage.goto({ waitForHydration: true });

    const blocking = seriousOrCritical(await scanAccessibility(page, testInfo, 'login'));
    await context.close();
    expect(blocking, 'Login: serious/critical axe violations').toEqual([]);
  });

  for (const module of MODULES) {
    test(`A11Y-01: ${module.name} has no serious or critical WCAG 2.1 AA violations`, async ({
      page, homePage, tasksPage, calendarPage, schedulePage, timeClockPage,
      timesheetsPage, leavePage, laborCostPage, payrollPage, workingNowPage,
      chatPage, announcementsPage, notificationsPage, projectsPage,
      departmentsPage, employeesPage, settingsPage,
    }, testInfo) => {
      const known = KNOWN_AXE_DEFECTS[module.name];
      test.fail(Boolean(known), known);

      const target = {
        homePage, tasksPage, calendarPage, schedulePage, timeClockPage,
        timesheetsPage, leavePage, laborCostPage, payrollPage, workingNowPage,
        chatPage, announcementsPage, notificationsPage, projectsPage,
        departmentsPage, employeesPage, settingsPage,
      }[module.fixture];

      await target.goto();
      await target.expectLoaded();

      const findings = await scanAccessibility(page, testInfo, module.name);
      testInfo.annotations.push({
        type: 'axe-summary',
        description: findings.length ? findings.map((f) => `${f.rule}:${f.impact}:${f.nodes}`).join(', ') : 'no violations',
      });
      expect(seriousOrCritical(findings), `${module.name}: serious/critical axe violations`).toEqual([]);
    });
  }

  test('A11Y-02: keyboard Tab order reaches the sidebar and main content with visible focus', async ({ tasksPage }) => {
    await tasksPage.goto();
    await tasksPage.expectLoaded();

    const stops = await tasksPage.tabSequence(45);
    const reachable = stops.filter((stop) => stop.tag !== 'body');

    expect(reachable.length, 'Tab should move focus through interactive elements').toBeGreaterThan(10);
    expect(reachable.some((stop) => stop.inNav), 'Keyboard focus reaches the sidebar navigation').toBe(true);
    expect(reachable.some((stop) => stop.inMain), 'Keyboard focus reaches the main content').toBe(true);
    expect(
      reachable.filter((stop) => !stop.visible).map((stop) => `${stop.tag} "${stop.name}"`),
      'Focus never lands on an invisible element',
    ).toEqual([]);
    expect(
      reachable.filter((stop) => !stop.focusIndicator).map((stop) => `${stop.tag} "${stop.name}"`),
      'Every focus stop shows a visible focus indicator (WCAG 2.4.7)',
    ).toEqual([]);
  });

  test('A11Y-03: dialogs trap focus and close on Escape', async ({ announcementsPage }) => {
    await announcementsPage.goto();
    await announcementsPage.expectLoaded();
    await announcementsPage.openNewAnnouncementDialog();
    await announcementsPage.expectNewAnnouncementDialog();

    const stops = await announcementsPage.tabSequence(20);
    expect(
      stops.filter((stop) => !stop.inDialog).map((stop) => `${stop.tag} "${stop.name}"`),
      'Focus must stay inside the open dialog',
    ).toEqual([]);

    await announcementsPage.pressKey('Escape');
    await expect(announcementsPage.dialog, 'Escape closes the dialog').toBeHidden();
  });

  test('A11Y-03 (QA-028): closing a dialog returns focus to its trigger', async ({ announcementsPage }) => {
    test.slow();
    test.fail(true, 'QA-028: after Escape, focus falls back to <body> instead of the "New announcement" trigger (WCAG 2.4.3).');

    await announcementsPage.goto();
    await announcementsPage.expectLoaded();
    await announcementsPage.openNewAnnouncementDialog();
    await announcementsPage.expectNewAnnouncementDialog();
    await announcementsPage.pressKey('Escape');
    await expect(announcementsPage.dialog).toBeHidden();

    const afterClose = await announcementsPage.activeElementInfo();
    expect(afterClose.name, 'Focus returns to the "New announcement" trigger').toMatch(/new announcement/i);
  });

  test('A11Y-05: every module has a title, page language and one main landmark', async ({
    homePage, tasksPage, calendarPage, schedulePage, timeClockPage,
    timesheetsPage, leavePage, laborCostPage, payrollPage, workingNowPage,
    chatPage, announcementsPage, notificationsPage, projectsPage,
    departmentsPage, employeesPage, settingsPage,
  }) => {
    test.slow(); // 17 full module loads.
    const pages = {
      homePage, tasksPage, calendarPage, schedulePage, timeClockPage,
      timesheetsPage, leavePage, laborCostPage, payrollPage, workingNowPage,
      chatPage, announcementsPage, notificationsPage, projectsPage,
      departmentsPage, employeesPage, settingsPage,
    };
    const problems: string[] = [];

    for (const module of MODULES) {
      const target = pages[module.fixture];
      await target.goto();
      await target.expectLoaded();
      const semantics = await target.documentSemantics();
      if (!semantics.lang) problems.push(`${module.name}: missing <html lang>`);
      if (!semantics.title) problems.push(`${module.name}: empty document title`);
      if (semantics.mainLandmarks !== 1) problems.push(`${module.name}: ${semantics.mainLandmarks} visible main landmarks`);
    }

    expect(problems, 'Document semantics per module').toEqual([]);
  });
});
