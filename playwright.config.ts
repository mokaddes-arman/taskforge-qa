import { defineConfig, type Project } from '@playwright/test';
import { env, STORAGE_STATE } from './utils/env';

const AUTH_TEST = /00-auth\.spec\.ts/;
const SETUP_TEST = /auth\.setup\.ts/;
const MODULE_TEST = /(?:0[1-9]|1[0-9])-.*\.spec\.ts/;
const ROLES_SETUP_TEST = /roles\.setup\.ts/;
const RBAC_TEST = /2[0-9]-.*\.spec\.ts/;
const EMPTY_STATE = { cookies: [], origins: [] };

type BrowserName = 'chromium' | 'firefox' | 'webkit';
type ExtraUse = { channel?: 'chrome' };

function authProject(
  name: string,
  browserName: BrowserName,
  extraUse: ExtraUse = {},
): Project {
  return {
    name,
    testMatch: AUTH_TEST,
    use: {
      browserName,
      storageState: EMPTY_STATE,
      ...extraUse,
    },
  };
}

function moduleProject(
  name: string,
  browserName: BrowserName,
  extraUse: ExtraUse = {},
): Project {
  return {
    name,
    testMatch: MODULE_TEST,
    dependencies: ['setup'],
    use: {
      browserName,
      storageState: STORAGE_STATE,
      ...extraUse,
    },
  };
}

function intFromEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * TaskForge QA configuration.
 *
 * Auth projects start with an empty storage state and run the same spec in
 * Chrome, Firefox and WebKit. The setup project logs in once and writes the
 * shared storage state used by the module projects.
 *
 * Parallelism: module specs are read-only and share no state between tests, so
 * every test runs in its own worker slot (`fullyParallel`). Only 00-auth stays
 * sequential inside its file because each test submits the real sign-in form
 * and the app rate-limits /sign-in/email (QA-003). Session redirects caused by
 * the get-session limiter are recovered by AppShellPage.retryOnLoginRedirect.
 *
 * Defaults: 4 workers locally, 2 on CI. Override with WORKERS=<n> (WORKERS=1
 * reproduces the old serial run for diagnostics) and RETRIES=<n>.
 */
export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: intFromEnv('RETRIES') ?? (process.env.CI ? 1 : 0),
  workers: intFromEnv('WORKERS') || (process.env.CI ? 2 : 4),
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
    // Inline failure annotations on GitHub pull requests.
    ...(process.env.CI ? ([['github']] as const) : []),
    [
      './reporters/dashboard-reporter.js',
      { outputFile: 'dashboard-report/index.html', projectName: 'TaskForge QA' },
    ],
  ],
  use: {
    baseURL: env.baseURL,
    headless: process.env.HEADED !== '1',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    authProject('auth-chrome', 'chromium', { channel: 'chrome' }),
    authProject('auth-firefox', 'firefox'),
    authProject('auth-webkit', 'webkit'),
    {
      name: 'setup',
      testMatch: SETUP_TEST,
      use: {
        browserName: 'chromium',
        channel: 'chrome',
        storageState: EMPTY_STATE,
        // Setup types the real password; keep it out of traces.
        trace: 'off',
      },
    },
    {
      // Platform-admin login + impersonated Admin/Manager/Employee sessions.
      name: 'setup-roles',
      testMatch: ROLES_SETUP_TEST,
      use: {
        browserName: 'chromium',
        channel: 'chrome',
        storageState: EMPTY_STATE,
        // Setup types the platform admin password; keep it out of traces.
        trace: 'off',
      },
    },
    {
      // RBAC and platform-admin specs (20-*). Permission rules are server-side,
      // so one browser is enough; storageState comes from fixtures/roles.fixture.
      name: 'roles-chrome',
      testMatch: RBAC_TEST,
      dependencies: ['setup', 'setup-roles'],
      use: { browserName: 'chromium', channel: 'chrome' },
    },
    moduleProject('modules-chrome', 'chromium', { channel: 'chrome' }),
    moduleProject('modules-firefox', 'firefox'),
    moduleProject('modules-webkit', 'webkit'),
  ],
});
