import { test, expect } from '../fixtures/roles.fixture';
import { ACCESS_NOTICE } from '../pages/RoleAccessPage';
import { WORKSPACE_NAV } from '../pages/AppShellPage';
import { WS_API, WORKSPACE_SLUG, expectErrorEnvelope, isoDateIn, weekRange } from '../utils/api';
import { ROLE_STATES, STORAGE_STATE, roleEmail, type WorkspaceRole } from '../utils/env';

/**
 * Role-based access control (RBAC) for the workspace roles Admin, Manager and
 * Employee. Sessions come from tests/roles.setup.ts (platform-admin
 * impersonation of the QA role accounts).
 *
 * Expected permissions are the ones the product states in its own UI copy:
 * "Admins manage everything. Managers manage the same, but only see chat
 * channels they belong to." (Add members dialog), "Pay figures are only shown
 * to owners and admins.", "Managers and admins only" (Working now) and "Only
 * Owners and Admins can change these." (Settings).
 *
 * Write probes never change data even if wrongly accepted: they re-send
 * current values, an empty patch, or invite an existing member with the role
 * they already hold. Admin write access is therefore not probed here.
 */

interface Member {
  userId: string;
  email: string;
  role: string;
}

type Expectation = {
  hiddenNav: string[];
  createMenu: string[];
  seesPay: boolean;
  seesWorkingNow: boolean;
  seesDashboardOverview: boolean;
  settingsSections: string[];
  canEditSettings: boolean;
  leaveTabs: string[];
  actions: Record<string, string[]>;
};

const ALL_SETTINGS = ['General', 'Offices', 'HR & Pay', 'Holidays', 'Leave', 'Plan & usage'];
const READ_ONLY_SETTINGS = ['General', 'Offices', 'Holidays', 'Plan & usage'];
const MANAGE_ACTIONS: Record<string, string[]> = {
  '/employees': ['Add employees'],
  '/departments': ['New department'],
  '/announcements': ['New announcement'],
  '/schedule': ['Copy last week', 'Discard drafts'],
  '/projects': ['New project'],
};

const EXPECT: Record<WorkspaceRole, Expectation> = {
  admin: {
    hiddenNav: [],
    createMenu: ['New task', 'New project', 'Add member', 'Keyboard shortcuts'],
    seesPay: true,
    seesWorkingNow: true,
    seesDashboardOverview: true,
    settingsSections: ALL_SETTINGS,
    canEditSettings: true,
    leaveTabs: ['My leave', 'Requests', 'Calendar'],
    actions: { ...MANAGE_ACTIONS, '/employees': ['Export CSV', 'Add employees'] },
  },
  manager: {
    hiddenNav: ['Labor cost', 'Payroll'],
    createMenu: ['New task', 'New project', 'Add member', 'Keyboard shortcuts'],
    seesPay: false,
    seesWorkingNow: true,
    seesDashboardOverview: true,
    settingsSections: READ_ONLY_SETTINGS,
    canEditSettings: false,
    leaveTabs: ['My leave', 'Requests', 'Calendar'],
    actions: MANAGE_ACTIONS,
  },
  employee: {
    hiddenNav: ['Working now', 'Labor cost', 'Payroll'],
    createMenu: ['New task', 'Keyboard shortcuts'],
    seesPay: false,
    seesWorkingNow: false,
    seesDashboardOverview: false,
    settingsSections: READ_ONLY_SETTINGS,
    canEditSettings: false,
    leaveTabs: ['My leave', 'Calendar'],
    actions: Object.fromEntries(Object.keys(MANAGE_ACTIONS).map((page) => [page, []])),
  },
};

const ALL_ACTIONS: Record<string, string[]> = {
  ...MANAGE_ACTIONS,
  '/employees': ['Export CSV', 'Add employees'],
};

for (const role of Object.keys(EXPECT) as WorkspaceRole[]) {
  const expected = EXPECT[role];

  test.describe(`RBAC: ${role}`, () => {
    test.use({ role });

    test(`RBAC-01 ${role}: sidebar shows only the destinations the role may use`, async ({ roleAccess }) => {
      await roleAccess.open('');
      const labels = (await roleAccess.sidebarLabels()).filter((label) => WORKSPACE_NAV.some((item) => item.label === label));
      const wanted = WORKSPACE_NAV.map((item) => item.label).filter((label) => !expected.hiddenNav.includes(label));
      expect(labels).toEqual(wanted);
    });

    test(`RBAC-02 ${role}: header Create menu offers only permitted actions`, async ({ roleAccess }) => {
      await roleAccess.open('');
      expect(await roleAccess.createMenuItems()).toEqual(expected.createMenu);
    });

    test(`RBAC-03 ${role}: payroll and labor cost are ${expected.seesPay ? 'available' : 'withheld'} in UI and API`, async ({ roleAccess, api }) => {
      const week = weekRange(isoDateIn('Asia/Dhaka'));
      for (const [segment, path] of [
        ['/reports/payroll', `${WS_API}/reports/payroll`],
        ['/reports/labor-cost', `${WS_API}/reports/labor-cost?from=${week.from}&to=${week.to}&groupBy=EMPLOYEE`],
      ]) {
        await roleAccess.open(segment);
        const notice = roleAccess.notice(ACCESS_NOTICE.ownersAndAdmins);
        if (expected.seesPay) {
          await expect(notice, `${segment}: no restriction notice`).toBeHidden();
          expect(await roleAccess.visibleActions(['Export CSV']), `${segment}: export offered`).toEqual(['Export CSV']);
          expect((await api.get(path)).status, `${path} readable`).toBe(200);
        } else {
          await expect(notice, `${segment}: restriction notice`).toBeVisible();
          expect(await roleAccess.visibleActions(['Export CSV', 'Export detail CSV']), `${segment}: no export`).toEqual([]);
          expectErrorEnvelope(path, await api.get(path), 403, 'FORBIDDEN');
        }
      }
    });

    test(`RBAC-04 ${role}: Working now and the business overview follow the role`, async ({ roleAccess, api }) => {
      await roleAccess.open('/working-now');
      const notice = roleAccess.notice(ACCESS_NOTICE.managersAndAdmins);
      const workingNow = `${WS_API}/time-clock/working-now`;
      const overview = `${WS_API}/dashboard/overview`;
      if (expected.seesWorkingNow) {
        await expect(notice).toBeHidden();
        expect((await api.get(workingNow)).status).toBe(200);
      } else {
        await expect(notice).toBeVisible();
        expectErrorEnvelope(workingNow, await api.get(workingNow), 403, 'FORBIDDEN');
      }
      if (expected.seesDashboardOverview) {
        expect((await api.get(overview)).status).toBe(200);
      } else {
        expectErrorEnvelope(overview, await api.get(overview), 403, 'FORBIDDEN');
      }
    });

    test(`RBAC-05 ${role}: settings sections and controls match the role`, async ({ roleAccess }) => {
      await roleAccess.open('/settings');
      expect(await roleAccess.settingsSections()).toEqual(expected.settingsSections);
      const readOnly = roleAccess.notice(ACCESS_NOTICE.settingsReadOnly);
      if (expected.canEditSettings) {
        await expect(readOnly).toBeHidden();
        expect(await roleAccess.visibleActions(['Save changes'])).toEqual(['Save changes']);
      } else {
        await expect(readOnly).toBeVisible();
        expect(await roleAccess.visibleActions(['Save changes'])).toEqual([]);
      }
      // Only the owner can delete the workspace; every other role can leave it.
      expect(await roleAccess.visibleActions(['Delete workspace', 'Leave workspace'])).toEqual(['Leave workspace']);

      if (!expected.canEditSettings) {
        // Typing the HR & Pay URL must not reveal the pay rules form.
        await roleAccess.open('/settings/hr');
        expect(await roleAccess.settingsSections()).not.toContain('HR & Pay');
        await expect(roleAccess.main).not.toContainText(/overtime/i);
      }
    });

    test(`RBAC-06 ${role}: management actions in modules match the role`, async ({ roleAccess }) => {
      for (const [segment, candidates] of Object.entries(ALL_ACTIONS)) {
        await roleAccess.open(segment);
        expect(await roleAccess.visibleActions(candidates), `${segment} actions`).toEqual(expected.actions[segment]);
      }
      await roleAccess.open('/leave');
      expect(await roleAccess.tabLabels(), 'Leave tabs').toEqual(expected.leaveTabs);
    });

    test(`RBAC-07 ${role}: another member's pay rates and pay fields are protected`, async ({ api }) => {
      const members = await api.data<Member[]>(`${WS_API}/members`);
      const owner = members.find((member) => member.role === 'OWNER')!;
      const path = `${WS_API}/members/${owner.userId}/pay-rates`;
      if (expected.seesPay) {
        expect((await api.get(path)).status).toBe(200);
      } else {
        expectErrorEnvelope(path, await api.get(path), 403, 'FORBIDDEN');
      }
      const payKeys = members.flatMap((member) => Object.keys(member).filter((key) => /pay|wage|salary|rate/i.test(key)));
      expect(payKeys, 'member directory carries no pay data').toEqual([]);
    });

    if (role !== 'admin') {
      test(`RBAC-08 ${role}: the API refuses management writes (no-op probes)`, async ({ api }) => {
        const members = await api.data<Member[]>(`${WS_API}/members`);
        const byRole = (wanted: string) => members.find((member) => member.role === wanted)!;
        const hr = await api.data<Record<string, unknown>>(`${WS_API}/hr-settings`);
        const workspace = await api.data<{ name: string }>(WS_API);

        const probes: Array<[string, 'POST' | 'PATCH', string, unknown]> = [
          ['change a role (same value)', 'PATCH', `${WS_API}/members/${byRole('MANAGER').userId}/role`, { role: 'MANAGER' }],
          ["edit the owner's profile (empty patch)", 'PATCH', `${WS_API}/members/${byRole('OWNER').userId}/profile`, {}],
          ['save HR & pay rules (same values)', 'PATCH', `${WS_API}/hr-settings`, hr],
          ['rename the workspace (same name)', 'PATCH', WS_API, { name: workspace.name }],
          // Manager may invite, but only as Employee; Employee may not invite at all.
          ['invite as Manager (existing member)', 'POST', `${WS_API}/invites/batch`, { emails: [roleEmail('manager')], role: 'MANAGER' }],
        ];
        for (const [label, method, path, data] of probes) {
          const result = await api.send(method, path, data);
          expect.soft(result.status, `${label}: ${method} ${path}`).toBe(403);
          expect.soft(result.body?.error?.code, `${label}: error code`).toBe('FORBIDDEN');
        }
      });
    }
  });
}

test.describe('RBAC: cross-role and cross-tenant', () => {
  test.use({ role: 'admin' });

  test('RBAC-09 workspace members cannot read another tenant\'s workspace', async ({ api, browser, baseURL }) => {
    // The QA Admin account owns a personal workspace created at sign-up: a real second tenant.
    const workspaces = await api.data<Array<{ slug: string; role: string }>>('/api/v1/workspaces');
    const foreign = workspaces.find((workspace) => workspace.slug !== WORKSPACE_SLUG && workspace.role === 'OWNER');
    test.skip(!foreign, 'QA Admin owns no second workspace to use as the foreign tenant');

    const paths = ['', '/members', '/hr-settings', '/reports/payroll', '/projects'].map((suffix) => `/api/v1/workspaces/${foreign!.slug}${suffix}`);
    for (const [who, state] of [['owner', STORAGE_STATE], ['manager', ROLE_STATES.manager], ['employee', ROLE_STATES.employee]]) {
      const context = await browser.newContext({ baseURL, storageState: state });
      try {
        for (const path of paths) {
          const status = (await context.request.get(path, { failOnStatusCode: false })).status();
          expect.soft([403, 404], `${who}: GET ${path}`).toContain(status);
        }
      } finally {
        await context.close();
      }
    }
  });
});

test.describe('RBAC: employee usability', () => {
  test.use({ role: 'employee' });

  test('RBAC-10 an empty Projects page offers employees no dead "Create project" button', async ({ roleAccess }) => {
    test.fail(true, 'QA-030: employees see an enabled "Create project" button that does nothing when clicked');
    await roleAccess.open('/projects');
    const cta = roleAccess.mainButton('Create project');
    test.skip(!(await cta.isVisible()), 'Employee sees projects, so the empty state is not shown');
    await cta.click();
    await expect(roleAccess.dialog, 'clicking Create project opens the project form').toBeVisible({ timeout: 5_000 });
  });
});
