import { test, expect } from '../fixtures/pages.fixture';
import { PROJECT_TABLE_COLUMNS } from '../pages/ProjectsPage';
import { DEMO_PROJECT, PROJECT_TABS } from '../pages/ProjectDetailPage';

/**
 * Module 14 — Projects.
 *
 * Read-only coverage for the projects list, status tabs, filters, layout
 * toggle and the new-project dialog. The dialog is opened and cancelled only;
 * no project is created or starred.
 *
 * Run: npm run test:modules:chrome -- tests/14-projects.spec.ts
 */
test.describe('Projects (Module 14)', () => {
  test('loads the active projects list with its controls', async ({
    projectsPage,
  }) => {
    await projectsPage.goto();
    await projectsPage.expectTitle(/Projects .+ TaskForge/i);
    await projectsPage.expectPath(projectsPage.workspaceHref('/projects'));
    await projectsPage.expectLoaded();

    await expect(projectsPage.projectsTable).toBeVisible();
    await projectsPage.expectSingleProjectRow('Global Softel');
  });

  test('shows the expanded table columns and project roll-up values', async ({
    projectsPage,
  }) => {
    await projectsPage.goto();
    await projectsPage.expectLoaded();

    expect(PROJECT_TABLE_COLUMNS).toContain('Next milestone');
    expect(PROJECT_TABLE_COLUMNS).toContain('Labor budget');

    await projectsPage.expectTableColumns();
    await projectsPage.expectProjectRow(DEMO_PROJECT.name);
  });

  test('switches between Active, Overdue and Archived tabs', async ({
    projectsPage,
  }) => {
    await projectsPage.goto();
    await projectsPage.expectLoaded();

    await projectsPage.overdueTab.click();
    await expect(projectsPage.overdueTab).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await projectsPage.archivedTab.click();
    await expect(projectsPage.archivedTab).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await projectsPage.activeTab.click();
    await expect(projectsPage.activeTab).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('switches the project layout between Table and Cards', async ({
    projectsPage,
  }) => {
    await projectsPage.goto();
    await projectsPage.expectLoaded();

    await projectsPage.selectLayout('Cards');
    await projectsPage.expectNoBrokenValues();

    await projectsPage.selectLayout('Table');
    await expect(projectsPage.projectsTable).toBeVisible();
  });

  test('opens the new-project dialog and cancels without creating', async ({
    projectsPage,
  }) => {
    await projectsPage.goto();
    await projectsPage.expectLoaded();

    await projectsPage.openNewProjectDialog();
    await projectsPage.expectNewProjectDialog();
    await projectsPage.cancelNewProjectDialog();
  });

  test('opens the Board, List and Milestones project tabs', async ({
    projectDetailPage,
  }) => {
    await projectDetailPage.goto('Board');
    await projectDetailPage.expectCurrentTab('Board');
    await projectDetailPage.expectBoard();

    await projectDetailPage.openTab('List');
    await projectDetailPage.expectCurrentTab('List');
    await projectDetailPage.expectList();

    await projectDetailPage.openTab('Milestones');
    await projectDetailPage.expectCurrentTab('Milestones');
    await projectDetailPage.expectMilestones();
  });

  test('navigates the project calendar back to the current month', async ({
    projectDetailPage,
  }) => {
    await projectDetailPage.goto('Calendar');
    await projectDetailPage.expectCurrentTab('Calendar');
    await projectDetailPage.expectCalendar();

    const currentMonth = await projectDetailPage.monthLabelText();

    await projectDetailPage.expectTodayDisabled();

    await projectDetailPage.nextMonth();
    expect(
      await projectDetailPage.monthLabelText(),
      'Next month should advance the project calendar',
    ).not.toBe(currentMonth);
    await projectDetailPage.goToToday(currentMonth);

    await projectDetailPage.previousMonth();
    expect(
      await projectDetailPage.monthLabelText(),
      'Previous month should move the project calendar back',
    ).not.toBe(currentMonth);
    await projectDetailPage.goToToday(currentMonth);
    await projectDetailPage.expectTodayDisabled();

    await projectDetailPage.expectCalendar();
  });

  test('shows the project chat and files surfaces without sending or uploading', async ({
    projectDetailPage,
  }) => {
    await projectDetailPage.goto('Chat');
    await projectDetailPage.expectCurrentTab('Chat');
    await projectDetailPage.expectChat();

    await projectDetailPage.openTab('Files');
    await projectDetailPage.expectCurrentTab('Files');
    await projectDetailPage.expectFiles();
  });

  test('renders project settings with column/rule limits and gated danger actions', async ({
    projectDetailPage,
  }) => {
    await projectDetailPage.goto('Settings');
    await projectDetailPage.expectCurrentTab('Settings');
    await projectDetailPage.expectSettings();
  });

  test('exposes every project tab with its canonical URL', async ({
    projectDetailPage,
  }) => {
    await projectDetailPage.goto('Board');

    for (const tab of PROJECT_TABS) {
      await projectDetailPage.openTab(tab);
      await projectDetailPage.expectCurrentTab(tab);
    }
  });
});
