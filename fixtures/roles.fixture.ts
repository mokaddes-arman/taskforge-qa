import { test as base } from './pages.fixture';
import { RoleAccessPage } from '../pages/RoleAccessPage';
import { AdminConsolePage } from '../pages/AdminConsolePage';
import { TaskForgeApi } from '../utils/api';
import { restoreSessionCookies } from '../utils/auth';
import { ROLE_STATES, SUPER_ADMIN_STATE, type WorkspaceRole } from '../utils/env';

/** Session a test runs with: a workspace role, or the platform (super) admin. */
export type SessionRole = WorkspaceRole | 'platform';
const STATE: Record<SessionRole, string> = { ...ROLE_STATES, platform: SUPER_ADMIN_STATE };

interface RoleFixtures {
  /** Workspace role whose session the test runs with. Set with test.use({ role }). */
  role: SessionRole;
  roleAccess: RoleAccessPage;
  adminConsole: AdminConsolePage;
  api: TaskForgeApi;
}

/**
 * RBAC fixtures. The storage state follows the selected `role` (sessions are
 * written by tests/roles.setup.ts), so `page`, `request` and `api` all act as
 * that role. The page object restores the role's own cookies after a QA-022
 * bounce, never the owner's.
 */
export const test = base.extend<RoleFixtures>({
  role: ['employee', { option: true }],
  storageState: async ({ role }, use) => {
    await use(STATE[role]);
  },
  authStoragePath: async ({ role }, use) => {
    await use(STATE[role]);
  },
  roleAccess: async ({ page, context, role }, use) => {
    await use(new RoleAccessPage(page, { restoreSession: () => restoreSessionCookies(context, STATE[role]) }));
  },
  adminConsole: async ({ page }, use) => {
    await use(new AdminConsolePage(page));
  },
  api: async ({ request }, use) => {
    await use(new TaskForgeApi(request));
  },
});

export { expect } from '@playwright/test';
