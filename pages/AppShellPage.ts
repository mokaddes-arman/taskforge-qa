import {
  expect,
  type Locator,
  type Page,
  type Response,
} from '@playwright/test';
import { env } from '../utils/env';
import { BasePage } from './BasePage';

const GET_SESSION_ENDPOINT = '/api/v1/auth/get-session';
const LOGIN_RATE_LIMIT_WAIT_MS = 10_000;

export interface NavItem {
  label: string;
  segment: string;
}

export interface ShellPageOptions {
  /** Re-applies saved auth cookies after a transient /login redirect. */
  restoreSession?: () => Promise<void>;
}

/**
 * Workspace destinations in the order rendered by the sidebar.
 *
 * The 16 Nov 2026 release regrouped the sidebar into Work / Team time / People /
 * Costs sections and moved Notifications, Employees and Departments into the
 * workspace tree. The project link below the Projects entry is data-driven and
 * is checked separately in `expectSidebarNavigation`.
 */
export const WORKSPACE_NAV: readonly NavItem[] = [
  { label: 'Home', segment: '' },
  { label: 'Tasks', segment: '/tasks' },
  { label: 'Notifications', segment: '/notifications' },
  { label: 'Projects', segment: '/projects' },
  { label: 'Calendar', segment: '/calendar' },
  { label: 'Schedule', segment: '/schedule' },
  { label: 'Time clock', segment: '/time-clock' },
  { label: 'Timesheets', segment: '/timesheets' },
  { label: 'Leave', segment: '/leave' },
  { label: 'Working now', segment: '/working-now' },
  { label: 'Employees', segment: '/employees' },
  { label: 'Departments', segment: '/departments' },
  { label: 'Chat', segment: '/chat' },
  { label: 'Announcements', segment: '/announcements' },
  { label: 'Labor cost', segment: '/reports/labor-cost' },
  { label: 'Payroll', segment: '/reports/payroll' },
] as const;

/** The workspaces-settings footer navigation now only contains Settings. */
export const SETTINGS_NAV: readonly NavItem[] = [
  { label: 'Settings', segment: '/settings' },
] as const;

/**
 * The authenticated application shell: sidebar, header, status strip and main
 * content. Every module page object extends this so navigation and readiness
 * checks stay in one place.
 */
export class AppShellPage extends BasePage {
  readonly main: Locator;
  readonly workspaceNav: Locator;
  readonly settingsNav: Locator;
  readonly searchButton: Locator;
  readonly createButton: Locator;
  readonly notificationsButton: Locator;
  readonly accountMenuButton: Locator;
  readonly headerClockInLink: Locator;
  protected readonly restoreSession?: () => Promise<void>;

  constructor(page: Page, options: ShellPageOptions = {}) {
    super(page);
    this.restoreSession = options.restoreSession;
    this.main = page.getByRole('main');
    this.workspaceNav = page
      .getByRole('navigation', { name: 'Workspace', exact: true })
      .first();
    this.settingsNav = page.getByRole('navigation', {
      name: 'Workspace settings',
      exact: true,
    });
    this.searchButton = page
      .getByRole('button', { name: 'Search', exact: true })
      .filter({ visible: true })
      .first();
    this.createButton = page.getByRole('button', {
      name: 'Create',
      exact: true,
    });
    this.notificationsButton = page.getByRole('button', {
      name: 'Notifications',
      exact: true,
    });
    this.accountMenuButton = page.getByRole('button', {
      name: 'Account menu',
    });
    this.headerClockInLink = page
      .getByRole('banner')
      .getByRole('link', { name: 'Clock in' });
  }

  /** Absolute href for a workspace segment (e.g. `/tasks`). */
  workspaceHref(segment: string): string {
    return `${env.workspacePath}${segment}`;
  }

  workspaceNavLink(label: string): Locator {
    return this.workspaceNav.getByRole('link', { name: label, exact: true });
  }

  settingsNavLink(label: string): Locator {
    return this.settingsNav.getByRole('link', { name: label, exact: true });
  }

  async goto(path: string = env.workspacePath): Promise<void> {
    await this.gotoAuthenticated(path);
  }

  /**
   * Navigates to an authenticated route. A valid stored session is
   * occasionally dropped on a single navigation (observed across browsers and
   * related to the transient auth behaviour in QA-003), so restore the saved
   * cookies and retry with backoff. When the app rate-limits its get-session
   * endpoint it redirects to /login with a 429, so honour X-Retry-After
   * instead of retrying inside the same limiter window. A genuinely invalid
   * session still fails every attempt.
   */
  protected async gotoAuthenticated(
    path: string,
    attempts = 4,
  ): Promise<void> {
    const backoffMs = [2_000, 10_000, 15_000];
    let lastError: unknown;

    for (let current = 1; current <= attempts; current += 1) {
      let rateLimitWaitMs = 0;
      const recordRateLimit = (response: Response) => {
        if (
          response.status() === 429 &&
          response.url().includes(GET_SESSION_ENDPOINT)
        ) {
          const retryAfterSeconds = Number(
            response.headers()['x-retry-after'] ?? 0,
          );

          if (Number.isFinite(retryAfterSeconds)) {
            rateLimitWaitMs = Math.max(
              rateLimitWaitMs,
              retryAfterSeconds * 1_000,
            );
          }
        }
      };

      this.page.on('response', recordRateLimit);

      try {
        await this.navigate(path);

        if (this.currentPath() === '/login') {
          // The client-side get-session response can land just after the
          // redirect, so give it a moment to report a 429 wait.
          await this.page.waitForTimeout(1_000);
          throw new Error(`Redirected to /login while opening ${path}`);
        }

        await this.waitForShell();
        return;
      } catch (cause) {
        lastError = cause;

        if (current < attempts) {
          await this.restoreSession?.();
          await this.page.waitForTimeout(
            Math.max(backoffMs[current - 1] ?? 10_000, rateLimitWaitMs + 1_000),
          );
        }
      } finally {
        this.page.off('response', recordRateLimit);
      }
    }

    throw lastError;
  }

  /**
   * Runs an in-page interaction and recovers once if the app redirects to
   * /login because its get-session endpoint was rate-limited. Reopen the
   * module after the limiter window, then retry the interaction.
   */
  protected async retryOnLoginRedirect<T>(
    recoveryPath: string,
    action: () => Promise<T>,
    attempts = 2,
  ): Promise<T> {
    let lastError: unknown;

    for (let current = 1; current <= attempts; current += 1) {
      try {
        return await action();
      } catch (cause) {
        lastError = cause;

        if (current >= attempts || this.currentPath() !== '/login') {
          throw cause;
        }

        await this.restoreSession?.();
        await this.page.waitForTimeout(LOGIN_RATE_LIMIT_WAIT_MS);
        await this.gotoAuthenticated(recoveryPath);
      }
    }

    throw lastError;
  }

  // ------------------------------------------------ resilience (NFR-08)
  /** Navigates without the module's readiness assertions (failure simulations). */
  async openRaw(segment: string): Promise<void> {
    await this.navigate(this.workspaceHref(segment));
    await this.main.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /**
   * Plain navigation (no readiness checks) that recovers from a QA-022 bounce
   * to /login by restoring the saved session once.
   */
  async navigateRecovering(segment: string): Promise<void> {
    const target = this.workspaceHref(segment);
    await this.navigate(target);
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    if (this.currentPath() === '/login') {
      await this.restoreSession?.();
      await this.page.waitForTimeout(LOGIN_RATE_LIMIT_WAIT_MS);
      await this.navigate(target);
    }
  }

  /** User-facing copy shown when data could not be loaded. */
  get errorState(): Locator {
    return this.page
      .getByText(/something went wrong|couldn['’]t load|could not load|failed to load|unable to load|try again|error loading|went wrong/i)
      .first();
  }

  get tryAgainButton(): Locator {
    return this.page.getByRole('button', { name: /try again/i }).first();
  }

  async expectErrorStateShown(): Promise<void> {
    await expect(this.errorState, 'A friendly error/retry message is shown').toBeVisible({ timeout: 20_000 });
  }

  // ------------------------------------------------ global search (GEN-03)
  get searchDialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Search' });
  }

  get searchSuggestions(): Locator {
    return this.searchDialog.getByRole('listbox', { name: 'Suggestions' });
  }

  async openGlobalSearch(): Promise<void> {
    await this.page.keyboard.press('Control+K');
    await expect(this.searchDialog).toBeVisible();
  }

  /** Types a term into the open search dialog and returns the option labels. */
  async globalSearchOptions(term: string): Promise<string[]> {
    const input = this.searchDialog.getByRole('combobox');
    await input.fill(term);
    // cmdk filters synchronously, but give React a frame to re-render.
    await expect(input).toHaveValue(term);
    await this.page.waitForTimeout(300);
    return (await this.searchSuggestions.getByRole('option').allTextContents()).map((t) => t.trim());
  }

  async expectGlobalSearchEmpty(): Promise<void> {
    await expect(this.searchSuggestions).toContainText(/nothing found/i);
  }

  async chooseGlobalSearchOption(name: string): Promise<void> {
    await this.searchSuggestions.getByRole('option', { name }).first().click();
    await expect(this.searchDialog).toBeHidden();
  }

  async closeGlobalSearch(): Promise<void> {
    await this.page.keyboard.press('Escape');
    await expect(this.searchDialog).toBeHidden();
  }

  // ------------------------------------------- workspace switcher (GEN-04)
  get workspaceSwitcherButton(): Locator {
    return this.page.getByRole('button', { name: 'Switch workspace' });
  }

  get workspaceSwitcherMenu(): Locator {
    return this.page.getByRole('menu', { name: 'Switch workspace' });
  }

  async openWorkspaceSwitcher(): Promise<string[]> {
    await this.workspaceSwitcherButton.click();
    await expect(this.workspaceSwitcherMenu).toBeVisible();
    return (await this.workspaceSwitcherMenu.getByRole('menuitem').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
  }

  workspaceSwitcherItem(name: RegExp): Locator {
    return this.workspaceSwitcherMenu.getByRole('menuitem', { name });
  }

  async closeMenu(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }

  // -------------------------------------------------------- theme (GEN-05)
  async selectTheme(theme: 'Light' | 'Dark' | 'System'): Promise<void> {
    await this.accountMenuButton.click();
    await this.page.getByRole('menuitemradio', { name: theme, exact: true }).click();
    await this.page.keyboard.press('Escape').catch(() => undefined);
  }

  async checkedTheme(): Promise<string> {
    await this.accountMenuButton.click();
    const checked = this.page.getByRole('menuitemradio', { checked: true });
    await expect(checked).toHaveCount(1);
    const name = ((await checked.textContent()) ?? '').trim();
    await this.page.keyboard.press('Escape');
    return name;
  }

  /** 'dark' or 'light' from the class applied to <html>. */
  async appliedTheme(): Promise<'dark' | 'light'> {
    return this.page.evaluate(() => (document.documentElement.classList.contains('dark') ? 'dark' : 'light'));
  }

  async reload(): Promise<void> {
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.waitForShell();
  }

  /**
   * GEN-02: clicks a sidebar entry (client-side navigation) and verifies the
   * route, a rendered page heading and the link's active state.
   */
  async openSidebarItemAndExpectActive(item: NavItem, settings = false): Promise<void> {
    const link = settings ? this.settingsNavLink(item.label) : this.workspaceNavLink(item.label);
    const target = this.workspaceHref(item.segment);

    // A get-session 429 can bounce a valid session to /login (QA-022); recover
    // through the saved session, as every other navigation in the suite does.
    await this.retryOnLoginRedirect(target, async () => {
      if (this.currentPath() !== target) {
        await link.click();
      }
      await expect(this.page).toHaveURL(new RegExp(`${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[?#].*)?$`));
      await expect(this.main.getByRole('heading').first(), `${item.label}: page heading`).toBeVisible();
      await expect(link, `${item.label}: sidebar link marked current`).toHaveAttribute('aria-current', 'page');
    }, 3);
  }

  /**
   * Asserts a client-side navigation reached `target`. If the app bounced the
   * valid session to /login?next=<target> (QA-022), records it and recovers.
   */
  async expectNavigatedTo(target: string): Promise<boolean> {
    const pattern = new RegExp(`${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[?#].*)?$`);
    await this.page.waitForURL((url) => pattern.test(url.pathname) || url.pathname === '/login', { timeout: 15_000 });
    const url = new URL(this.page.url());
    if (url.pathname === '/login') {
      expect(url.searchParams.get('next'), 'The navigation targeted the expected page before the session bounce').toBe(target);
      await this.restoreSession?.();
      await this.gotoAuthenticated(target);
      await expect(this.page).toHaveURL(pattern);
      return true;
    }
    return false;
  }

  /**
   * True when the page renders a not-found / access-denied state instead of
   * workspace content (SEC-02 / GEN-07).
   */
  async showsNotFoundOrDenied(): Promise<boolean> {
    const message = this.page
      .getByText(
        /not found|404|could not be found|doesn['’]t exist|does not exist|no access|don['’]t have access|not a member|access denied|forbidden/i,
      )
      .first();

    return message.isVisible({ timeout: 5_000 }).catch(() => false);
  }

  async waitForShell(timeout = 30_000): Promise<void> {
    await this.main.waitFor({ state: 'visible', timeout });
    await this.accountMenuButton.waitFor({ state: 'visible', timeout });
  }

  async expectSidebarNavigation(): Promise<void> {
    for (const item of WORKSPACE_NAV) {
      const link = this.workspaceNavLink(item.label);

      await expect(link, `Sidebar link "${item.label}"`).toBeVisible();
      await expect(link).toHaveAttribute(
        'href',
        this.workspaceHref(item.segment),
      );
    }

    for (const item of SETTINGS_NAV) {
      const link = this.settingsNavLink(item.label);

      await expect(link, `Settings link "${item.label}"`).toBeVisible();
      await expect(link).toHaveAttribute(
        'href',
        this.workspaceHref(item.segment),
      );
    }

    for (const section of ['Work', 'Team time', 'People', 'Costs']) {
      await expect(
        this.workspaceNav.getByText(section, { exact: true }),
        `Sidebar section "${section}"`,
      ).toBeVisible();
    }

    // The active project shortcut is data-driven; assert the pattern instead
    // of a project name so the shell check survives data changes.
    await expect(
      this.workspaceNav
        .locator('a[href*="/projects/"][href$="/board"]')
        .first(),
      'Sidebar project shortcut',
    ).toBeVisible();
  }

  /**
   * Returns the realtime status copy, or an empty string when no banner is
   * present. QA-001 currently keeps the paused banner on every page.
   */
  async readRealtimeStatus(): Promise<string> {
    const status = this.page.getByRole('status');
    const count = await status.count();
    const texts: string[] = [];

    for (let index = 0; index < count; index += 1) {
      const text =
        (await status
          .nth(index)
          .textContent()
          .catch(() => '')) ?? '';
      const clean = text.replace(/\s+/g, ' ').trim();

      if (clean) {
        texts.push(clean);
      }
    }

    return (
      texts.find((text) =>
        /reconnecting|live updates|paused|offline|connected/i.test(text),
      ) ??
      texts[0] ??
      ''
    );
  }

  async expectRealtimeStatusReported(): Promise<string> {
    let status = '';

    await expect
      .poll(async () => {
        status = await this.readRealtimeStatus();
        return status;
      }, {
        message:
          'Realtime status should report the paused/reconnecting transport',
        timeout: 20_000,
      })
      .toMatch(/reconnecting|live updates|paused|offline|connected/i);

    return status;
  }
}
