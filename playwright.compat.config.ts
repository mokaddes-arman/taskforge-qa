import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';
import { STORAGE_STATE } from './utils/env';

/**
 * Compatibility matrix (COMP-04 … COMP-06): Microsoft Edge plus phone and
 * tablet emulation. Kept out of the default config so `npm test` keeps its
 * existing projects and runtime. Reuses the same reporters (Playwright HTML,
 * dashboard, bug report) and trace/screenshot/video settings.
 *
 * Run: npm run test:compat
 *
 * Device emulation covers viewport, DPR, touch, user agent and the browser
 * engine. It does not replace testing on real iOS/Android hardware.
 */
const COMPAT_TEST = /compat[\\/].*\.spec\.ts$/;
const EMPTY_STATE = { cookies: [], origins: [] };

export default defineConfig({
  ...base,
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: {
        browserName: 'chromium',
        channel: 'chrome',
        storageState: EMPTY_STATE,
        trace: 'off',
      },
    },
    {
      name: 'compat-edge',
      testMatch: COMPAT_TEST,
      dependencies: ['setup'],
      use: { ...devices['Desktop Edge'], channel: 'msedge', viewport: { width: 1440, height: 900 }, storageState: STORAGE_STATE },
    },
    {
      name: 'compat-pixel-7',
      testMatch: COMPAT_TEST,
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: STORAGE_STATE },
    },
    {
      name: 'compat-galaxy-s9-320px',
      testMatch: COMPAT_TEST,
      dependencies: ['setup'],
      use: { ...devices['Galaxy S9+'], storageState: STORAGE_STATE },
    },
    {
      name: 'compat-iphone-15',
      testMatch: COMPAT_TEST,
      dependencies: ['setup'],
      use: { ...devices['iPhone 15'], storageState: STORAGE_STATE },
    },
    {
      name: 'compat-ipad-pro-11',
      testMatch: COMPAT_TEST,
      dependencies: ['setup'],
      use: { ...devices['iPad Pro 11'], storageState: STORAGE_STATE },
    },
  ],
});
