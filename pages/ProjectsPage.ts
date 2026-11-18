import { expect, type Locator, type Page } from '@playwright/test';
import { AppShellPage, type ShellPageOptions } from './AppShellPage';

export const PROJECT_TABLE_COLUMNS = [
  'Project',
  'Due',
  'Progress',
  'Next milestone',
  'Logged',
  'Labor budget',
  'Owner',
  'Actions',
] as const;

export class ProjectsPage extends AppShellPage {  readonly title: Locator;
  readonly subtitle: Locator;
  readonly newProjectButton: Locator;
  readonly activeTab: Locator;
  readonly overdueTab: Locator;
  readonly archivedTab: Locator;
  readonly departmentFilter: Locator;
  readonly ownerFilter: Locator;
  readonly onlyMyDepartments: Locator;
  readonly tableLayout: Locator;
  readonly cardsLayout: Locator;
  readonly projectsTable: Locator;
  readonly dialog: Locator;

  constructor(page: Page, options: ShellPageOptions = {}) {
    super(page, options);
    this.title = this.main.getByRole('heading', {
      name: 'Projects',
      level: 1,
      exact: true,
    });
    this.subtitle = this.main.getByText(
      'Everything your departments are working on.',
      { exact: true },
    );
    this.newProjectButton = this.main
      .getByRole('button')
      .filter({ hasText: 'New project' })
      .first();
    this.activeTab = this.main.getByRole('tab', {
      name: 'Active',
      exact: true,
    });
    this.overdueTab = this.main.getByRole('tab', {
      name: 'Overdue',
      exact: true,
    });
    this.archivedTab = this.main.getByRole('tab', {
      name: 'Archived',
      exact: true,
    });
    this.departmentFilter = this.main.getByRole('combobox', {
      name: 'Filter by department',
    });
    this.ownerFilter = this.main.getByRole('combobox', {
      name: 'Filter by Project Owner',
    });
    this.onlyMyDepartments = this.main.getByRole('switch', {
      name: 'Only my departments',
    });
    this.tableLayout = this.main.getByRole('radio', {
      name: 'Table',
      exact: true,
    });
    this.cardsLayout = this.main.getByRole('radio', {
      name: 'Cards',
      exact: true,
    });
    this.projectsTable = this.main.getByRole('table', {
      name: 'Projects',
    });
    this.dialog = page.getByRole('dialog', { name: 'New project' });
  }

  async goto(): Promise<void> {
    await this.gotoAuthenticated(this.workspaceHref('/projects'));
    await this.waitForShell();
    await expect(this.title).toBeVisible();
    await expect(this.activeTab).toBeVisible();
  }

  async expectLoaded(): Promise<void> {
    await expect(this.title).toBeVisible();
    await expect(this.subtitle).toBeVisible();
    await expect(this.newProjectButton).toBeVisible();
    await expect(this.activeTab).toBeVisible();
    await expect(this.overdueTab).toBeVisible();
    await expect(this.archivedTab).toBeVisible();
    await expect(this.departmentFilter).toBeVisible();
    await expect(this.ownerFilter).toBeVisible();
    await expect(this.onlyMyDepartments).toBeVisible();
    await expect(this.tableLayout).toBeVisible();
    await expect(this.cardsLayout).toBeVisible();
    await expect(this.activeTab).toHaveAttribute('aria-selected', 'true');
    await expect(this.tableLayout).toHaveAttribute('aria-checked', 'true');
    await this.expectNoBrokenValues();
  }

  async openNewProjectDialog(): Promise<void> {
    await this.newProjectButton.click();
    await expect(this.dialog).toBeVisible();
  }

  async expectNewProjectDialog(): Promise<void> {
    await expect(this.dialog).toBeVisible();
    await expect(
      this.dialog.getByRole('heading', { name: 'New project', exact: true }),
    ).toBeVisible();
    await expect(this.dialog.getByLabel('Name')).toBeVisible();
    await expect(this.dialog.getByLabel('Key')).toBeVisible();
    await expect(this.dialog.getByLabel('Department')).toBeVisible();
    await expect(this.dialog.getByLabel('Project Owner')).toBeVisible();
    await expect(
      this.dialog.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeVisible();
    await expect(
      this.dialog.getByRole('button', { name: 'Create project', exact: true }),
    ).toBeVisible();
  }

  async cancelNewProjectDialog(): Promise<void> {
    await this.dialog
      .getByRole('button', { name: 'Cancel', exact: true })
      .click();
    await expect(this.dialog).toBeHidden();
  }

  async tableColumns(): Promise<string[]> {
    return (
      await this.projectsTable
        .locator('[role="columnheader"]')
        .allInnerTexts()
    ).map((column) => column.replace(/\s+/g, ' ').trim());
  }

  async expectTableColumns(): Promise<void> {
    await expect
      .poll(async () => this.tableColumns(), {
        message: 'Projects table should render its column headers',
      })
      .toEqual([...PROJECT_TABLE_COLUMNS]);
  }

  /**
   * Switches the list layout. A click that lands during the re-render of the
   * previous layout can be dropped (seen in Firefox), so retry until the radio
   * reports checked. Clicking an unchecked radio is idempotent.
   */
  async selectLayout(layout: 'Table' | 'Cards'): Promise<void> {
    const radio = layout === 'Table' ? this.tableLayout : this.cardsLayout;

    await expect(async () => {
      if ((await radio.getAttribute('aria-checked')) !== 'true') {
        await radio.click();
      }
      await expect(radio).toHaveAttribute('aria-checked', 'true', {
        timeout: 3_000,
      });
    }).toPass({ timeout: 15_000 });
  }

  projectRow(name: string): Locator {
    return this.projectsTable.getByRole('row').filter({ hasText: name });
  }

  async expectSingleProjectRow(name: string): Promise<void> {
    await expect(
      this.projectRow(name),
      `Projects table row for "${name}"`,
    ).toHaveCount(1);
  }

  async expectProjectRow(name: string): Promise<void> {
    const row = this.projectRow(name);

    await expect(row, `Projects table row for "${name}"`).toHaveCount(1);
    await expect(row).toContainText(/\d+ of \d+ tasks done/);
    await expect(row).toContainText(/Labor \$[\d,.]+ of \$[\d,.]+/);
    await expect(row).toContainText(/\d+%/);
    await expect(row).toContainText(/\d+(?:\.\d+)?\s*[hm](?:\s*\d+m)?/);
  }

  /** INT-01: number of project rows in the Projects table (header excluded). */
  async projectCount(): Promise<number> {
    await expect(this.projectsTable).toBeVisible();
    return (await this.projectsTable.getByRole('row').count()) - 1;
  }

  async expectNoBrokenValues(): Promise<void> {
    await expect(this.main).not.toContainText(/NaN|undefined|Invalid Date/);
  }
}
