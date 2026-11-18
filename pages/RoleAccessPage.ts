import { expect, type Locator } from '@playwright/test';
import { AppShellPage } from './AppShellPage';

/** Restricted-content notices the app shows instead of a module's data. */
export const ACCESS_NOTICE = {
  ownersAndAdmins: 'Owners and admins only',
  managersAndAdmins: 'Managers and admins only',
  settingsReadOnly: 'Only Owners and Admins can change these.',
} as const;

/**
 * Role-based view of the workspace shell: which navigation, menus, actions and
 * notices a signed-in role gets. Used by the RBAC suite with role sessions.
 */
export class RoleAccessPage extends AppShellPage {
  /** Opens a workspace page and waits for its heading (no owner-only readiness checks). */
  async open(segment: string): Promise<void> {
    await this.navigateRecovering(segment);
    await expect(this.page).toHaveURL(new RegExp(`${this.workspaceHref(segment).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[?#].*)?$`));
    await expect(this.main.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 30_000 });
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  }

  /** Visible sidebar destinations (badges stripped). */
  async sidebarLabels(): Promise<string[]> {
    await expect(this.workspaceNavLink('Home')).toBeVisible();
    const labels = await this.workspaceNav.getByRole('link').allInnerTexts();
    return labels.map((label) => label.split('\n')[0].trim()).filter(Boolean);
  }

  /** Items of the header "Create" menu, read and closed without choosing one. */
  async createMenuItems(): Promise<string[]> {
    await this.createButton.click();
    const items = this.page.getByRole('menuitem');
    await expect(items.first()).toBeVisible();
    const labels = (await items.allInnerTexts()).map((t) => t.split('\n')[0].trim());
    await this.page.keyboard.press('Escape');
    await expect(items.first()).toBeHidden();
    return labels;
  }

  notice(text: string): Locator {
    // Some notices repeat per card (e.g. settings); the first instance is enough.
    return this.main.getByText(text, { exact: true }).first();
  }

  get dialog(): Locator {
    return this.page.getByRole('dialog');
  }

  mainButton(name: string): Locator {
    return this.main.getByRole('button', { name, exact: true });
  }

  mainLink(name: string): Locator {
    return this.main.getByRole('link', { name, exact: true });
  }

  /** Names of main-area buttons/links that start a write action, among `candidates`. */
  async visibleActions(candidates: readonly string[]): Promise<string[]> {
    const visible: string[] = [];
    for (const name of candidates) {
      const control = this.mainButton(name).or(this.mainLink(name)).first();
      if (await control.isVisible()) visible.push(name);
    }
    return visible;
  }

  async tabLabels(): Promise<string[]> {
    return (await this.main.getByRole('tab').allInnerTexts()).map((t) => t.trim());
  }

  /** Section links of the settings page (General, Offices, HR & Pay, ...). */
  async settingsSections(): Promise<string[]> {
    const candidates = ['General', 'Offices', 'HR & Pay', 'Holidays', 'Leave', 'Plan & usage'];
    const visible: string[] = [];
    for (const name of candidates) {
      if (await this.main.getByRole('link', { name, exact: true }).first().isVisible()) visible.push(name);
    }
    return visible;
  }
}
