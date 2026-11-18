import { test, expect } from '../fixtures/pages.fixture';

/**
 * Module 16 — Employees.
 *
 * Read-only coverage for the employee list, filters, search and the add-members
 * dialog. No employee is added, removed or reassigned.
 *
 * Run: npm run test:modules:chrome -- tests/16-employees.spec.ts
 */
test.describe('Employees (Module 16)', () => {
  test('loads the employee list with its controls', async ({ employeesPage }) => {
    await employeesPage.goto();
    await employeesPage.expectTitle(/Employees .+ TaskForge/i);
    await employeesPage.expectPath(employeesPage.workspaceHref('/employees'));
    await employeesPage.expectLoaded();
  });

  test('search shows no match and clears back to the list', async ({
    employeesPage,
  }) => {
    await employeesPage.goto();
    await employeesPage.expectLoaded();
    // Read the live total: membership changes (e.g. the RBAC role accounts).
    const total = await employeesPage.employeeCount();

    await employeesPage.searchInput.fill('zzzz-no-match');
    await expect(employeesPage.count).toContainText(`0 of ${total} employees`);

    await employeesPage.searchInput.fill('');
    await expect(employeesPage.count).toContainText(`${total} employees`);
  });

  test('E-04: search finds employees by name and email, case-insensitively', async ({
    employeesPage,
    credentials,
  }) => {
    await employeesPage.goto();
    await employeesPage.expectLoaded();
    const total = await employeesPage.employeeCount();

    for (const term of ['ABDUL MOKADDES', 'abdul mokaddes', credentials.email.toUpperCase()]) {
      await employeesPage.search(term);
      const result = await employeesPage.searchResultCount();
      expect(result.total, `"${term}": total stays the directory size`).toBe(total);
      expect(result.shown, `"${term}" matches at least one employee`).toBeGreaterThanOrEqual(1);
      expect(result.shown, `"${term}" narrows the list`).toBeLessThan(total);
      await expect(employeesPage.employeeLink('Abdul Mokaddes Arman')).toBeVisible();
    }

    await employeesPage.search('');
    await expect(employeesPage.count).toContainText(`${total} employees`);
  });

  test('opens the add-members dialog and cancels without adding', async ({
    employeesPage,
  }) => {
    await employeesPage.goto();
    await employeesPage.expectLoaded();

    await employeesPage.openAddEmployeesDialog();
    await employeesPage.expectAddEmployeesDialog();
    await employeesPage.cancelAddEmployeesDialog();
  });

  test('E-06: employee deep page exposes the Profile/Schedule/Time/Leave/Pay tabs', async ({
    employeesPage,
  }) => {
    await employeesPage.goto();
    await employeesPage.expectLoaded();

    await employeesPage.openEmployeeProfile('Abdul Mokaddes Arman');
    await employeesPage.expectProfileLoaded();

    // The Profile tab is the default landing tab of the deep page.
    await employeesPage.expectProfileTab('Profile', true);

    for (const tabName of ['Schedule', 'Time', 'Leave', 'Pay']) {
      await employeesPage.selectProfileTab(tabName);
      await employeesPage.expectProfileTab(tabName, true);
    }

    await employeesPage.selectProfileTab('Profile');
    await employeesPage.expectProfileTab('Profile', true);
  });
});
