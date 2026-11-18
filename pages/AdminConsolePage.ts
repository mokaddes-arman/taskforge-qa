import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Platform (super) admin console at /admin: dashboard, user list and plans.
 * Only reached with the super admin session; workspace roles are redirected.
 */
export class AdminConsolePage extends BasePage {
  readonly heading: Locator;
  readonly navUsers: Locator;
  readonly navPlans: Locator;
  readonly backToTaskForge: Locator;
  readonly totalUsersCard: Locator;
  readonly usersHeading: Locator;
  readonly usersTable: Locator;
  readonly userRows: Locator;
  readonly plansHeading: Locator;
  readonly menu: Locator;
  readonly stopImpersonatingButton: Locator;
  /** Shown when the platform admin opens a workspace it is not a member of. */
  readonly workspaceNotFound: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: 'Dashboard', level: 1 });
    this.navUsers = page.getByRole('link', { name: 'Users', exact: true });
    this.navPlans = page.getByRole('link', { name: 'Plans', exact: true });
    this.backToTaskForge = page.getByRole('link', { name: 'Back to TaskForge' });
    this.totalUsersCard = page.getByRole('link', { name: /Total users/ });
    this.usersHeading = page.getByRole('heading', { name: 'User list' });
    this.usersTable = page.getByRole('table');
    this.userRows = this.usersTable.locator('tbody tr');
    this.plansHeading = page.getByRole('heading', { name: 'Plans', level: 1 });
    this.menu = page.getByRole('menu');
    this.stopImpersonatingButton = page.getByRole('button', { name: /Stop impersonating/i });
    this.workspaceNotFound = page.getByRole('heading', { name: 'Workspace not found', level: 1 });
  }

  async goto(): Promise<void> {
    await this.navigate('/admin');
    await expect(this.heading).toBeVisible({ timeout: 30_000 });
  }

  async gotoUsers(): Promise<void> {
    await this.navigate('/admin/users');
    await expect(this.usersHeading).toBeVisible({ timeout: 30_000 });
    await expect(this.userRows.first()).toBeVisible();
  }

  async gotoPlans(): Promise<void> {
    await this.navigate('/admin/plans');
    await expect(this.plansHeading).toBeVisible({ timeout: 30_000 });
  }

  /** Number shown on the dashboard's "Total users" card. */
  async totalUsers(): Promise<number> {
    // The count streams in after the card renders.
    await expect(this.totalUsersCard).toContainText(/Total users\s*\d+/);
    const text = await this.totalUsersCard.innerText();
    const match = text.replace(/\s+/g, ' ').match(/Total users\s*(\d+)/);
    expect(match, `Total users card text: ${text}`).not.toBeNull();
    return Number(match![1]);
  }

  async userRowCount(): Promise<number> {
    return this.userRows.count();
  }

  /** Emails shown in the user table (EMAIL column). */
  async userEmails(): Promise<string[]> {
    const headers = (await this.usersTable.locator('th').allInnerTexts()).map((h) => h.trim().toUpperCase());
    const column = headers.indexOf('EMAIL');
    expect(column, 'EMAIL column').toBeGreaterThanOrEqual(0);
    return (await this.userRows.locator(`td:nth-child(${column + 1})`).allInnerTexts()).map((t) => t.trim());
  }

  /** Plan names rendered as card headings. */
  async planNames(): Promise<string[]> {
    // Plan cards render after the page heading, once /admin/plans resolves.
    await expect(this.page.getByRole('main').getByRole('heading', { level: 2 }).first()).toBeVisible();
    return (await this.page.getByRole('main').getByRole('heading', { level: 2 }).allInnerTexts())
      .concat(await this.page.getByRole('main').getByRole('heading', { level: 3 }).allInnerTexts())
      .map((t) => t.trim())
      .filter((t) => t && t !== 'Plans');
  }

  rowActionsButton(name: string): Locator {
    return this.page.getByRole('button', { name: `Actions for ${name}`, exact: true });
  }

  /** Opens a user's action menu, reads the items and closes it without choosing one. */
  async userActions(name: string): Promise<string[]> {
    await this.rowActionsButton(name).click();
    await expect(this.menu).toBeVisible();
    const items = (await this.menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
    await this.page.keyboard.press('Escape');
    await expect(this.menu).toBeHidden();
    return items;
  }

  /** Impersonates a user from the user list (super admin only). */
  async impersonate(name: string): Promise<void> {
    await this.rowActionsButton(name).click();
    await this.menu.getByRole('menuitem', { name: 'Impersonate' }).click();
    const confirm = this.page.getByRole('alertdialog');
    if (await confirm.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await confirm.getByRole('button', { name: /impersonate|continue|confirm/i }).click();
    }
    await this.page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 30_000 });
    await expect(this.stopImpersonatingButton).toBeVisible({ timeout: 30_000 });
  }

  /** Session of this browser context (the page's cookies, not a separate request context). */
  async browserSession(): Promise<{ email: string; platformRole: string; impersonated: boolean }> {
    const response = await this.page.request.get('/api/v1/auth/get-session');
    expect(response.status(), 'get-session').toBe(200);
    const body = (await response.json()) as { user: { email: string; role: string }; session: { impersonatedBy: string | null } };
    return { email: body.user.email, platformRole: body.user.role, impersonated: Boolean(body.session.impersonatedBy) };
  }

  async stopImpersonating(): Promise<void> {
    await this.stopImpersonatingButton.click();
    await this.page.waitForURL((url) => url.pathname.startsWith('/admin'), { timeout: 30_000 });
    await expect(this.stopImpersonatingButton).toBeHidden();
  }
}
