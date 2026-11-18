import type { Page, Route } from '@playwright/test';
import { test, expect } from '../fixtures/pages.fixture';

/**
 * Resilience — error handling and recovery (NFR-08, PERF-06).
 *
 * Server failures, slow responses and network loss are SIMULATED in the
 * browser with page.route / context.setOffline; nothing reaches or changes the
 * server. Auth endpoints are never intercepted, so the session stays valid.
 */

const DATA_API = /\/api\/v1\/(?!auth\/)/;

// WebKit reports aborted Next.js prefetches as page errors; they are router noise.
const ROUTER_NOISE = /[?&]_rsc=|Load failed|Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED|access control checks/i;

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => {
    if (!ROUTER_NOISE.test(error.message)) errors.push(error.message);
  });
  return errors;
}

test.describe('Resilience — failures and recovery', () => {
  test('NFR-08: API 500 responses show a friendly error with a working Try again', async ({ page, tasksPage }) => {
    const errors = trackPageErrors(page);
    await page.route(DATA_API, (route: Route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: { code: 'INTERNAL' }, message: 'Simulated failure' }) }),
    );

    await tasksPage.navigateRecovering('/tasks');
    await tasksPage.expectErrorStateShown();
    await expect(tasksPage.tryAgainButton, 'The error state offers a retry').toBeVisible();
    expect(errors, 'No unhandled exceptions while the API fails').toEqual([]);

    // Recovery: once the backend is healthy, "Try again" restores the module.
    await page.unroute(DATA_API);
    await tasksPage.tryAgainButton.click();
    await tasksPage.waitForShell();
    await tasksPage.expectLoaded();
  });

  test('NFR-08 (QA-027): navigating while offline keeps the app with a friendly message', async ({ page, context, tasksPage, browserName }) => {
    // Reproduced in Chromium and Firefox; Playwright WebKit keeps the shell rendered.
    test.fail(browserName !== 'webkit', 'QA-027: a client-side navigation while offline falls back to a full page load and shows the browser ERR_INTERNET_DISCONNECTED page.');

    await tasksPage.goto();
    await tasksPage.expectLoaded();
    await context.setOffline(true);
    try {
      await tasksPage.workspaceNavLink('Schedule').click();
      await page.waitForTimeout(3_000);
      await expect(tasksPage.main, 'The application shell stays rendered while offline').toBeVisible({ timeout: 5_000 });
    } finally {
      await context.setOffline(false);
    }
  });

  test('PERF-06: the app recovers after a network outage', async ({ page, context, tasksPage, schedulePage }) => {
    const errors = trackPageErrors(page);
    await tasksPage.goto();
    await tasksPage.expectLoaded();

    await context.setOffline(true);
    await page.waitForTimeout(3_000);
    await context.setOffline(false);

    await schedulePage.goto();
    await schedulePage.expectLoaded();
    expect(errors, 'No unhandled exceptions across the offline/online cycle').toEqual([]);
  });

  test('NFR-08: slow API responses keep a loading state and then render', async ({ page, tasksPage }) => {
    const errors = trackPageErrors(page);
    await page.route(DATA_API, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue().catch(() => undefined);
    });

    await tasksPage.goto();
    await tasksPage.expectLoaded();
    expect(errors, 'No unhandled exceptions on a slow network').toEqual([]);
  });
});
