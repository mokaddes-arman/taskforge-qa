import fs from 'node:fs';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { AdminConsolePage } from '../pages/AdminConsolePage';
import { TaskForgeApi, WS_API } from '../utils/api';
import {
  ROLE_STATES,
  SUPER_ADMIN_STATE,
  roleEmail,
  superAdminCredentials,
  type WorkspaceRole,
} from '../utils/env';

setup.setTimeout(180_000);

interface AdminUser {
  id: string;
  email: string;
  role: string;
}

/**
 * Builds one storage state per workspace role for the RBAC suite.
 *
 * The Admin/Manager QA accounts may still be awaiting e-mail verification, so
 * sessions come from the platform admin's "Impersonate" feature: the server
 * then treats every request as that user (session.impersonatedBy is set).
 * The super admin logs in through the UI at most once per run; a still-valid
 * saved session is reused to stay clear of the sign-in rate limit.
 */
setup('create super admin and role sessions', async ({ browser, baseURL }) => {
  const expectedRole: Record<WorkspaceRole, string> = { admin: 'ADMIN', manager: 'MANAGER', employee: 'EMPLOYEE' };
  fs.mkdirSync(path.dirname(SUPER_ADMIN_STATE), { recursive: true });

  const savedSessionValid = async (): Promise<boolean> => {
    if (!fs.existsSync(SUPER_ADMIN_STATE)) return false;
    const context = await browser.newContext({ baseURL, storageState: SUPER_ADMIN_STATE });
    try {
      const response = await context.request.get('/api/v1/admin/users?limit=1', { failOnStatusCode: false });
      return response.status() === 200;
    } finally {
      await context.close();
    }
  };

  if (!(await savedSessionValid())) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.fillCredentials(superAdminCredentials());
    await loginPage.submit();
    await new AdminConsolePage(page).heading.waitFor({ state: 'visible', timeout: 45_000 });
    await context.storageState({ path: SUPER_ADMIN_STATE });
    await context.close();
  }

  const lookup = await browser.newContext({ baseURL, storageState: SUPER_ADMIN_STATE });
  const users = (await new TaskForgeApi(lookup.request).data<{ users: AdminUser[] }>('/api/v1/admin/users?limit=100')).users;
  await lookup.close();

  for (const role of Object.keys(ROLE_STATES) as WorkspaceRole[]) {
    const email = roleEmail(role);
    const user = users.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
    expect(user, `QA ${role} account exists on the platform`).toBeTruthy();

    const context = await browser.newContext({ baseURL, storageState: SUPER_ADMIN_STATE });
    const impersonation = await context.request.post(`/api/v1/admin/users/${user!.id}/impersonate`, { failOnStatusCode: false });
    expect(impersonation.status(), `impersonate ${role}`).toBe(201);

    const api = new TaskForgeApi(context.request);
    const workspace = await api.data<{ role: string }>(WS_API);
    expect(workspace.role, `${role} account's role in the workspace`).toBe(expectedRole[role]);

    await context.storageState({ path: ROLE_STATES[role] });
    await context.close();
  }
});
