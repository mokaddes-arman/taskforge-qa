import { test, expect } from '../fixtures/roles.fixture';
import { WS_API, expectErrorEnvelope } from '../utils/api';
import { ROLE_STATES, STORAGE_STATE, env, roleEmail } from '../utils/env';

/**
 * Platform (super) admin console at /admin. Read-only apart from PA-05, which
 * starts and stops an impersonation session (no data changes).
 */

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
}
interface AdminPlan {
  name: string;
  archivedAt: string | null;
}

test.describe('Platform admin console', () => {
  test.use({ role: 'platform' });

  test('PA-01 dashboard, user list and plans match the admin API', async ({ adminConsole, api }) => {
    const all = await api.data<{ users: AdminUser[]; total: number }>('/api/v1/admin/users?limit=100');
    await adminConsole.goto();
    expect(await adminConsole.totalUsers(), 'Total users card').toBe(all.total);

    const firstPage = await api.data<{ users: AdminUser[] }>('/api/v1/admin/users?sortBy=createdAt&sortDirection=desc&limit=20&offset=0');
    await adminConsole.gotoUsers();
    expect(await adminConsole.userRowCount(), 'rows on the first page').toBe(firstPage.users.length);
    // Compare without printing addresses: CI reports of this public repo must not list platform users.
    const sameEmails = (await adminConsole.userEmails()).join('|') === firstPage.users.map((user) => user.email).join('|');
    expect(sameEmails, 'table emails equal the API list, newest first').toBe(true);

    const plans = await api.data<AdminPlan[]>('/api/v1/admin/plans');
    await adminConsole.gotoPlans();
    const shown = await adminConsole.planNames();
    for (const plan of plans.filter((candidate) => !candidate.archivedAt)) {
      expect(shown, `plan card "${plan.name}"`).toContain(plan.name);
    }
  });

  test('PA-03 the platform admin has no workspace access of its own', async ({ adminConsole, api }) => {
    expect(await api.data<unknown[]>('/api/v1/workspaces'), 'workspace memberships').toEqual([]);
    expect([403, 404], `GET ${WS_API}`).toContain((await api.get(WS_API)).status);
    await adminConsole.navigate(env.workspacePath);
    await expect(adminConsole.workspaceNotFound, 'workspace URL shows "not a member" to the platform admin').toBeVisible();
  });

  test('PA-04 row actions: other users can be impersonated or banned, the admin itself cannot', async ({ adminConsole, api }) => {
    const users = (await api.data<{ users: AdminUser[] }>('/api/v1/admin/users?limit=100')).users;
    const self = users.find((user) => user.role === 'admin')!;
    const other = users.find((user) => user.role !== 'admin' && /^QA /.test(user.name)) ?? users.find((user) => user.role !== 'admin')!;

    await adminConsole.gotoUsers();
    expect(await adminConsole.userActions(other.name)).toEqual(['Change plan', 'Sessions', 'Impersonate', 'Ban user']);
    expect(await adminConsole.userActions(self.name)).toEqual(['Change plan', 'Sessions']);
  });

  test('PA-05 impersonation shows a banner, acts as the user and can be stopped', async ({ adminConsole }) => {
    await adminConsole.gotoUsers();
    await adminConsole.impersonate('QA Manager');
    const impersonated = await adminConsole.browserSession();
    expect(impersonated.email === roleEmail('manager'), 'session belongs to the impersonated user').toBe(true);
    expect(impersonated.impersonated, 'session is marked as impersonated').toBe(true);

    await adminConsole.stopImpersonating();
    await expect(adminConsole.heading).toBeVisible();
    const restored = await adminConsole.browserSession();
    expect(restored.impersonated, 'admin session restored').toBe(false);
    expect(restored.platformRole).toBe('admin');
  });
});

test.describe('Platform admin console: access control', () => {
  test.use({ role: 'admin' });

  test('PA-02 workspace roles cannot reach the admin console or its API', async ({ browser, baseURL }) => {
    const states: Array<[string, string]> = [
      ['owner', STORAGE_STATE],
      ['admin', ROLE_STATES.admin],
      ['manager', ROLE_STATES.manager],
      ['employee', ROLE_STATES.employee],
    ];
    for (const [who, storageState] of states) {
      const context = await browser.newContext({ baseURL, storageState });
      try {
        for (const path of ['/api/v1/admin/users', '/api/v1/admin/plans']) {
          const response = await context.request.get(path, { failOnStatusCode: false });
          const body = await response.json().catch(() => null);
          expectErrorEnvelope(`${who}: ${path}`, { status: response.status(), contentType: response.headers()['content-type'] ?? '', body }, 403, 'FORBIDDEN');
        }
        const page = await context.newPage();
        await page.goto('/admin');
        await expect.poll(() => new URL(page.url()).pathname, { message: `${who}: /admin redirects away` }).not.toMatch(/^\/admin/);
      } finally {
        await context.close();
      }
    }
  });
});
