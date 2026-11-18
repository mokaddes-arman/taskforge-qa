import { expect, type Locator, type Page } from '@playwright/test';
import { AppShellPage, type ShellPageOptions } from './AppShellPage';

export const DEMO_PROJECT = {
  name: 'Global Softel',
  slug: 'global-softel',
  key: 'GS',
} as const;

export const PROJECT_TABS = [
  'Board',
  'List',
  'Milestones',
  'Calendar',
  'Chat',
  'Files',
  'Settings',
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number];

export const BOARD_COLUMNS = [
  'To Do',
  'In Queue',
  'In Progress',
  'In Review',
  'Done',
] as const;

export const PROJECT_LIST_COLUMNS = [
  'Name',
  'Assignee',
  'Labels',
  'Milestone',
  'Due date',
  'Priority',
  'Comments',
] as const;

const PROJECT_TAB_PATH: Readonly<Record<ProjectTab, string>> = {
  Board: 'board',
  List: 'list',
  Milestones: 'milestones',
  Calendar: 'calendar',
  Chat: 'chat',
  Files: 'files',
  Settings: 'settings',
};

const MONTH_LABEL = /^[A-Z][a-z]+ \d{4}$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A single project workspace (Module 14). Read-only coverage for the project
 * header, Board/List/Milestones/Calendar/Chat/Files tabs and the project
 * Settings page. Archive, delete, owner/department changes and task creation
 * are never submitted because they mutate shared workspace data.
 */
export class ProjectDetailPage extends AppShellPage {
  readonly heading: Locator;
  readonly starButton: Locator;
  readonly seeMoreButton: Locator;
  readonly progressSummary: Locator;
  readonly progressPercent: Locator;
  readonly newTaskButton: Locator;
  readonly searchTasksInput: Locator;
  readonly addTaskButtons: Locator;
  readonly addColumnButton: Locator;
  readonly listSection: Locator;
  readonly milestonesEmptyState: Locator;
  readonly newMilestoneButton: Locator;
  readonly noMilestoneHeading: Locator;
  readonly calendarMonthLabel: Locator;
  readonly previousMonthButton: Locator;
  readonly todayButton: Locator;
  readonly nextMonthButton: Locator;
  readonly chatEmptyState: Locator;
  readonly chatMemberSummary: Locator;
  readonly chatComposer: Locator;
  readonly chatSendButton: Locator;
  readonly filesHeading: Locator;
  readonly filesSummary: Locator;
  readonly filesEmptyState: Locator;
  readonly uploadFilesButton: Locator;
  readonly saveChangesButton: Locator;
  readonly nameInput: Locator;
  readonly descriptionInput: Locator;
  readonly keyNote: Locator;
  readonly ownerCombobox: Locator;
  readonly changeOwnerButton: Locator;
  readonly departmentCombobox: Locator;
  readonly moveProjectButton: Locator;
  readonly columnsNote: Locator;
  readonly addColumnSettingsButton: Locator;
  readonly assignmentRulesNote: Locator;
  readonly addRuleButton: Locator;
  readonly archiveButton: Locator;
  readonly deleteButton: Locator;

  constructor(page: Page, options: ShellPageOptions = {}) {
    super(page, options);
    this.heading = this.main.getByRole('heading', {
      name: DEMO_PROJECT.name,
      level: 1,
      exact: true,
    });
    this.starButton = this.main.getByRole('button', {
      name: 'Star project',
      exact: true,
    });
    this.seeMoreButton = this.main.getByRole('button', {
      name: 'See more',
      exact: true,
    });
    this.progressSummary = this.main.getByText(/^\d+ of \d+ done$/).first();
    this.progressPercent = this.main.getByText(/^\d+%$/).first();
    this.newTaskButton = this.main.getByRole('button', {
      name: 'New task',
      exact: true,
    });
    this.searchTasksInput = this.main.getByRole('textbox', {
      name: 'Search tasks',
    });
    this.addTaskButtons = this.main.getByRole('button', {
      name: 'Add task',
      exact: true,
    });
    this.addColumnButton = this.main.getByRole('button', {
      name: 'Add column',
      exact: true,
    });
    this.listSection = this.main.locator('section[aria-label="To Do"]');
    this.milestonesEmptyState = this.main.getByText('No milestones yet', {
      exact: true,
    });
    this.newMilestoneButton = this.main
      .getByRole('button', { name: 'New milestone', exact: true })
      .first();
    this.noMilestoneHeading = this.main.getByRole('heading', {
      name: 'No milestone',
      exact: true,
    });
    this.calendarMonthLabel = this.main.getByText(MONTH_LABEL).first();
    this.previousMonthButton = this.main.getByRole('button', {
      name: 'Previous month',
      exact: true,
    });
    this.todayButton = this.main.getByRole('button', {
      name: 'Today',
      exact: true,
    });
    this.nextMonthButton = this.main.getByRole('button', {
      name: 'Next month',
      exact: true,
    });
    this.chatEmptyState = this.main.getByText(
      `This is the start of ${DEMO_PROJECT.name}'s chat`,
      { exact: true },
    );
    this.chatMemberSummary = this.main.getByText(/^\d+ members?$/).first();
    this.chatComposer = this.main.getByRole('textbox', { name: 'Message' });
    this.chatSendButton = this.main.getByRole('button', {
      name: 'Send message',
      exact: true,
    });
    this.filesHeading = this.main.getByRole('heading', {
      name: 'Attachments',
      level: 2,
      exact: true,
    });
    this.filesSummary = this.main.getByText(
      /^\d+ files? · [\d.,]+ ?[KMGTP]?B across the project and its tasks\.$/,
    );
    this.filesEmptyState = this.main.getByText('No files yet', { exact: true });
    this.uploadFilesButton = this.main
      .getByRole('button', { name: 'Upload files', exact: true })
      .first();
    this.saveChangesButton = this.main.getByRole('button', {
      name: 'Save changes',
      exact: true,
    });
    this.nameInput = this.main.getByLabel('Name', { exact: true });
    this.descriptionInput = this.main.getByLabel(/^Description/);
    this.keyNote = this.main.getByText(
      new RegExp(
        `The key ${escapeRegExp(DEMO_PROJECT.key)} is used in task keys and can't be changed\\.`,
      ),
    );
    this.ownerCombobox = this.main.getByRole('combobox', {
      name: 'Project Owner',
    });
    this.changeOwnerButton = this.main.getByRole('button', {
      name: 'Change owner',
      exact: true,
    });
    this.departmentCombobox = this.main.getByRole('combobox', {
      name: 'Department',
    });
    this.moveProjectButton = this.main.getByRole('button', {
      name: 'Move project',
      exact: true,
    });
    this.columnsNote = this.main.getByText(
      /Columns are your task statuses \(\d+\/\d+\)\. Drag to reorder\./,
    );
    this.addColumnSettingsButton = this.main
      .getByRole('button', { name: 'Add column', exact: true })
      .last();
    this.assignmentRulesNote = this.main.getByText(
      /New tasks created without an assignee go to whoever the first matching rule picks \(\d+\/\d+\)\./,
    );
    this.addRuleButton = this.main.getByRole('button', {
      name: 'Add rule',
      exact: true,
    });
    this.archiveButton = this.main.getByRole('button', {
      name: 'Archive',
      exact: true,
    });
    this.deleteButton = this.main.getByRole('button', {
      name: 'Delete',
      exact: true,
    });
  }

  projectHref(tab: ProjectTab = 'Board'): string {
    return this.workspaceHref(
      `/projects/${DEMO_PROJECT.slug}/${PROJECT_TAB_PATH[tab]}`,
    );
  }

  tabLink(tab: ProjectTab): Locator {
    return this.main.getByRole('link', { name: tab, exact: true });
  }

  async goto(tab: ProjectTab = 'Board'): Promise<void> {
    await this.gotoAuthenticated(this.projectHref(tab));
    await this.waitForShell();

    const heading = tab === 'Settings' ? this.main.getByRole('heading', { level: 1 }) : this.heading;

    await expect(heading).toBeVisible();
    await expect(this.tabLink(tab)).toHaveAttribute('aria-current', 'page');
    await this.waitForSkeletonsToClear();
  }

  async openTab(tab: ProjectTab): Promise<void> {
    await this.retryOnLoginRedirect(this.projectHref(tab), async () => {
      await this.tabLink(tab).click();
      await expect(this.page).toHaveURL(
        new RegExp(`${escapeRegExp(this.projectHref(tab))}$`),
      );
      await expect(this.heading).toBeVisible();
      await expect(this.tabLink(tab)).toHaveAttribute('aria-current', 'page');
      await this.waitForSkeletonsToClear();
    });
  }

  /**
   * Reads the stored project description from the Settings form without
   * editing it (SEC-04 / QA-002). Call after `goto('Settings')`.
   */
  async storedDescription(): Promise<string> {
    await expect(this.descriptionInput).toBeVisible();
    return this.descriptionInput.inputValue();
  }

  async expectCurrentTab(tab: ProjectTab): Promise<void> {
    await expect(this.tabLink(tab)).toHaveAttribute('aria-current', 'page');
  }

  async expectTabs(): Promise<void> {
    for (const tab of PROJECT_TABS) {
      await expect(
        this.tabLink(tab),
        `Project tab "${tab}"`,
      ).toBeVisible();
      await expect(this.tabLink(tab)).toHaveAttribute(
        'href',
        this.projectHref(tab),
      );
    }
  }

  async expectHeader(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.starButton).toBeVisible();
    await expect(this.seeMoreButton).toBeVisible();
    await expect(this.progressSummary).toHaveText(/^\d+ of \d+ done$/);
    await expect(this.progressPercent).toHaveText(/^\d+%$/);
    await this.expectTabs();
    await this.expectNoBrokenValues();
  }

  async expectBoard(): Promise<void> {
    await this.expectHeader();
    await expect(this.newTaskButton).toBeVisible();
    await expect(this.searchTasksInput).toBeVisible();

    for (const filter of [
      'Assigned to',
      'Priority',
      'Tags',
      'Status',
      'Due',
      'Date range',
      'Only mine',
      'Milestone',
    ]) {
      await expect(
        this.main.getByRole('button', { name: filter, exact: true }),
        `Board filter "${filter}"`,
      ).toBeVisible();
    }

    for (const column of BOARD_COLUMNS) {
      await expect(
        this.main.getByRole('heading', {
          name: column,
          level: 2,
          exact: true,
        }),
        `Board column "${column}"`,
      ).toBeVisible();
    }

    await expect(
      this.addTaskButtons,
      'Every board column should expose an add-task action',
    ).toHaveCount(BOARD_COLUMNS.length);
    await expect(this.addColumnButton).toBeVisible();
    await this.expectNoBrokenValues();
  }

  async expectList(): Promise<void> {
    await this.expectHeader();
    await expect(this.newTaskButton).toBeVisible();

    for (const tab of ['All tasks', ...BOARD_COLUMNS]) {
      await expect(
        this.main.getByRole('tab', {
          name: new RegExp(`^${escapeRegExp(tab)}\\s*\\d*$`),
        }),
        `List status tab "${tab}"`,
      ).toBeVisible();
    }

    for (const column of PROJECT_LIST_COLUMNS) {
      await expect(
        this.listSection.getByText(column, { exact: true }).first(),
        `List column "${column}"`,
      ).toBeVisible();
    }

    await expect(this.listSection).toBeVisible();
    await this.expectNoBrokenValues();
  }

  async expectMilestones(): Promise<void> {
    await this.expectHeader();
    await expect(this.newMilestoneButton).toBeVisible();
    await expect(this.noMilestoneHeading).toBeVisible();

    if (await this.milestonesEmptyState.isVisible()) {
      await expect(this.milestonesEmptyState).toBeVisible();
      await expect(
        this.main.getByText(
          'Split the work into stages, like material delivery, installation and inspection, each with its own due date and tasks.',
          { exact: true },
        ),
      ).toBeVisible();
    }

    await this.expectNoBrokenValues();
  }

  async expectCalendar(): Promise<void> {
    await this.expectHeader();
    await expect(this.calendarMonthLabel).toHaveText(MONTH_LABEL);
    await expect(this.previousMonthButton).toBeVisible();
    await expect(this.todayButton).toBeVisible();
    await expect(this.nextMonthButton).toBeVisible();

    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      await expect(
        this.main.getByText(day, { exact: true }).first(),
        `Calendar weekday "${day}"`,
      ).toBeVisible();
    }

    await expect(
      this.main.getByText(/^No due date/),
    ).toBeVisible();
    await expect(
      this.main.getByText('Every task has a due date.', { exact: true }),
    ).toBeVisible();
    await this.expectNoBrokenValues();
  }

  async monthLabelText(): Promise<string> {
    return ((await this.calendarMonthLabel.textContent()) ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async nextMonth(): Promise<void> {
    const before = await this.monthLabelText();

    await this.nextMonthButton.click();
    await expect
      .poll(() => this.monthLabelText(), {
        message: 'Expected Next month to advance the project calendar',
      })
      .not.toBe(before);
  }

  async previousMonth(): Promise<void> {
    const before = await this.monthLabelText();

    await this.previousMonthButton.click();
    await expect
      .poll(() => this.monthLabelText(), {
        message: 'Expected Previous month to move the project calendar back',
      })
      .not.toBe(before);
  }

  async goToToday(expectedLabel: string): Promise<void> {
    await expect(this.todayButton).toBeEnabled();
    await this.todayButton.click();
    await expect
      .poll(() => this.monthLabelText(), {
        message: `Expected Today to restore "${expectedLabel}"`,
      })
      .toBe(expectedLabel);
  }

  async expectTodayDisabled(): Promise<void> {
    await expect(this.todayButton).toBeDisabled();
  }

  async expectChat(): Promise<void> {
    await this.expectHeader();

    if (await this.chatEmptyState.isVisible()) {
      await expect(this.chatEmptyState).toBeVisible();
    }

    await expect(this.chatMemberSummary).toHaveText(/^\d+ members?$/);
    await expect(this.chatComposer).toBeVisible();
    await expect(this.chatSendButton).toBeDisabled();
    await this.expectNoBrokenValues();
  }

  async expectFiles(): Promise<void> {
    await this.expectHeader();
    await expect(this.filesHeading).toBeVisible();
    await expect(this.filesSummary).toHaveText(
      /^\d+ files? · [\d.,]+ ?[KMGTP]?B across the project and its tasks\.$/,
    );

    if (await this.filesEmptyState.isVisible()) {
      await expect(this.filesEmptyState).toBeVisible();
      await expect(
        this.main.getByText(
          'Drop files anywhere on this page, or upload briefs, specs and designs for the whole project.',
          { exact: true },
        ),
      ).toBeVisible();
    }

    await expect(this.uploadFilesButton).toBeVisible();
    await this.expectNoBrokenValues();
  }

  async expectSettings(): Promise<void> {
    await this.expectHeader();
    await expect(this.keyNote).toBeVisible();
    await expect(this.nameInput).toHaveValue(DEMO_PROJECT.name);
    await expect(this.descriptionInput).toBeVisible();
    await expect(this.saveChangesButton).toBeVisible();
    await expect(this.saveChangesButton).toBeDisabled();

    await expect(this.ownerCombobox).toBeVisible();
    await expect(this.changeOwnerButton).toBeVisible();
    await expect(this.changeOwnerButton).toBeDisabled();
    await expect(this.departmentCombobox).toBeVisible();
    await expect(this.moveProjectButton).toBeVisible();
    await expect(this.moveProjectButton).toBeDisabled();

    await expect(this.columnsNote).toBeVisible();
    await expect(this.addColumnSettingsButton).toBeVisible();

    for (const column of BOARD_COLUMNS) {
      await expect(
        this.main.getByRole('button', {
          name: `Reorder ${column}`,
          exact: true,
        }),
        `Settings column "${column}"`,
      ).toBeVisible();
    }

    await expect(this.assignmentRulesNote).toBeVisible();
    await expect(this.addRuleButton).toBeVisible();

    await expect(
      this.main.getByText('Danger zone', { exact: true }),
    ).toBeVisible();
    await expect(this.archiveButton).toBeEnabled();
    await expect(this.deleteButton).toBeDisabled();
    await this.expectNoBrokenValues();
  }

  async expectNoBrokenValues(): Promise<void> {
    await expect(this.main).not.toContainText(/NaN|undefined|Invalid Date/);
  }
}
