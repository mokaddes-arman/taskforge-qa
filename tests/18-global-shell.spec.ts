import { test, expect } from '../fixtures/pages.fixture';
import { SETTINGS_NAV, WORKSPACE_NAV } from '../pages/AppShellPage';

/**
 * Global shell (GEN-02/03/04/05).
 *
 * Read-only: navigation, search and popovers only. The theme test switches the
 * Light/Dark preference and always restores the original value.
 *
 * Run: npm run test:modules:chrome -- tests/18-global-shell.spec.ts
 */
test.describe('Global shell', () => {
  test('GEN-02: every sidebar link opens its module with the active state', async ({ tasksPage }) => {
    await tasksPage.goto();

    for (const item of WORKSPACE_NAV) {
      await tasksPage.openSidebarItemAndExpectActive(item);
    }
    for (const item of SETTINGS_NAV) {
      await tasksPage.openSidebarItemAndExpectActive(item, true);
    }
    await expect(tasksPage.main).not.toContainText(/NaN|undefined|Invalid Date/);
  });

  test('GEN-03: global search finds a page and navigates to it', async ({ tasksPage, settingsPage }) => {
    await tasksPage.goto();
    await tasksPage.openGlobalSearch();

    const options = await tasksPage.globalSearchOptions('Settings');
    expect(options, 'Searching "Settings" offers the settings page').toContain('Workspace settings');

    await tasksPage.chooseGlobalSearchOption('Workspace settings');
    if (await tasksPage.expectNavigatedTo(settingsPage.workspaceHref('/settings'))) {
      test.info().annotations.push({ type: 'qa-022', description: 'Valid session bounced to /login after selecting the search result (get-session 429); recovered.' });
    }
    await settingsPage.expectLoaded();
  });

  test('GEN-03: global search shows a no-results state for unknown terms', async ({ tasksPage }) => {
    await tasksPage.goto();
    await tasksPage.openGlobalSearch();
    await tasksPage.globalSearchOptions('zzqx-no-such-thing');
    await tasksPage.expectGlobalSearchEmpty();
    await tasksPage.closeGlobalSearch();
  });

  test('GEN-03 (QA-023): global search finds every sidebar module by name', async ({ tasksPage }) => {
    test.fail(true, 'QA-023: Ctrl+K search returns "Nothing found" for Schedule, Timesheets, Leave, Labor cost, Payroll and other modules.');

    await tasksPage.goto();
    const missing: string[] = [];
    for (const item of WORKSPACE_NAV) {
      await tasksPage.openGlobalSearch();
      const options = await tasksPage.globalSearchOptions(item.label);
      if (!options.some((option) => option.toLowerCase().includes(item.label.toLowerCase()))) missing.push(item.label);
      await tasksPage.closeGlobalSearch();
    }

    test.info().annotations.push({ type: 'not-searchable', description: missing.join(', ') || 'none' });
    expect(missing, 'Modules that global search cannot find').toEqual([]);
  });

  test('GEN-04: workspace switcher marks the current workspace and gates creation at the plan limit', async ({ tasksPage }) => {
    await tasksPage.goto();
    const items = await tasksPage.openWorkspaceSwitcher();

    expect(items.some((item) => /Abdul's Workspace/.test(item) && /Owner/.test(item)), `Current workspace with role (got ${items.join(' | ')})`).toBe(true);
    // Workspaces 1/1 on the Free plan (QA-005): creation must be disabled, not fail later.
    await expect(tasksPage.workspaceSwitcherItem(/Create workspace/)).toBeDisabled();
    await expect(tasksPage.workspaceSwitcherItem(/Create workspace/)).toContainText(/limit reached/i);
    await tasksPage.closeMenu();
  });

  test('GEN-05: theme switch applies dark mode, persists on reload and is restored', async ({ tasksPage }) => {
    await tasksPage.goto();
    const original = await tasksPage.checkedTheme();

    try {
      await tasksPage.selectTheme('Dark');
      await expect.poll(() => tasksPage.appliedTheme()).toBe('dark');

      await tasksPage.reload();
      await expect.poll(() => tasksPage.appliedTheme(), { message: 'Dark theme persists after reload' }).toBe('dark');
      expect(await tasksPage.checkedTheme()).toBe('Dark');

      await tasksPage.selectTheme('Light');
      await expect.poll(() => tasksPage.appliedTheme()).toBe('light');
    } finally {
      await tasksPage.selectTheme(original as 'Light' | 'Dark' | 'System');
    }
  });
});
