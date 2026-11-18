import type { Page, Request } from '@playwright/test';
import { test, expect } from '../fixtures/pages.fixture';
import { env } from '../utils/env';

/**
 * Performance — single-user timings (NFR-01, PERF-02, PERF-05).
 *
 * Measured from the QA workstation against production with a cold browser
 * cache (each test gets a fresh context). This is NOT a load test: one user,
 * no concurrency. Load/stress testing (PERF-03/04) needs authorization and a
 * staging environment.
 *
 * Budgets:
 *  - NFR-01 (test plan): meaningful content < 3 s on broadband.
 *  - PERF-02 (QA proposal, pending product sign-off): data API p95 < 1 s.
 *  - PERF-05 (QA proposal): < 4 MB transferred and < 150 requests per cold page load.
 * Run: npm run test:perf  (skipped in parallel runs; see beforeEach).
 * Every measurement is attached to the test as `perf-*` annotations so the
 * numbers reach the dashboard even when the budget is met.
 */

const CONTENT_BUDGET_MS = 3_000;
const API_P95_BUDGET_MS = 1_000;
const PAGE_WEIGHT_BUDGET_BYTES = 4 * 1024 * 1024;
const REQUEST_COUNT_BUDGET = 150;
const ORIGIN = new URL(env.baseURL).origin;

type Loadable = { goto(): Promise<void>; expectLoaded(): Promise<void> };

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function recordApiTimings(page: Page): { durations: Array<{ path: string; ms: number }> } {
  const store = { durations: [] as Array<{ path: string; ms: number }> };
  page.on('requestfinished', (req: Request) => {
    const url = new URL(req.url());
    if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/')) return;
    const timing = req.timing();
    if (timing.responseEnd > 0) store.durations.push({ path: url.pathname, ms: Math.round(timing.responseEnd - Math.max(0, timing.requestStart)) });
  });
  return store;
}

test.describe('Performance — single-user timings', () => {
  // Timings are only meaningful without other tests competing for the network
  // and the app's session limiter (parallel runs inflated Projects to 11.6 s and
  // Payroll to 13.5 s vs 2.5 s / 3.0 s in isolation on 17 Nov 2026).
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.config.workers > 1, 'Performance timings run in isolation only: npm run test:perf (1 worker).');
  });

  const PAGES: ReadonlyArray<{ name: string; fixture: 'homePage' | 'laborCostPage' | 'payrollPage' | 'projectsPage' | 'tasksPage' }> = [
    { name: 'Home', fixture: 'homePage' },
    { name: 'Labor cost', fixture: 'laborCostPage' },
    { name: 'Payroll', fixture: 'payrollPage' },
    { name: 'Projects', fixture: 'projectsPage' },
    { name: 'Tasks', fixture: 'tasksPage' },
  ];

  for (const target of PAGES) {
    test(`PERF-01 (NFR-01): ${target.name} shows meaningful content within 3 s`, async ({
      page, homePage, laborCostPage, payrollPage, projectsPage, tasksPage,
    }) => {
      test.fail(target.name === 'Labor cost', 'QA-007: Labor cost needs 4.3–4.8 s to show content (NFR-01 budget 3 s).');
      const pages: Record<string, Loadable> = { homePage, laborCostPage, payrollPage, projectsPage, tasksPage };
      const module = pages[target.fixture];

      // Warm the TLS connection and session once so the timing reflects the
      // page itself, not the first handshake or a session-restore retry.
      await page.request.get('/api/v1/auth/get-session');

      const startedAt = Date.now();
      await module.goto();
      await module.expectLoaded();
      const contentMs = Date.now() - startedAt;

      const nav = await page.evaluate(() => {
        const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        return entry ? { ttfb: Math.round(entry.responseStart), dcl: Math.round(entry.domContentLoadedEventEnd) } : null;
      });

      test.info().annotations.push({
        type: 'perf-content-ms',
        description: `${target.name}: content ${contentMs} ms; TTFB ${nav?.ttfb ?? 'n/a'} ms; DOMContentLoaded ${nav?.dcl ?? 'n/a'} ms (budget ${CONTENT_BUDGET_MS} ms)`,
      });
      expect(contentMs, `${target.name}: meaningful content within ${CONTENT_BUDGET_MS} ms (NFR-01)`).toBeLessThanOrEqual(CONTENT_BUDGET_MS);
    });
  }

  test('PERF-02: module data APIs respond within the p95 budget', async ({
    page, homePage, tasksPage, schedulePage, timesheetsPage, employeesPage, chatPage,
  }) => {
    const timings = recordApiTimings(page);
    for (const module of [homePage, tasksPage, schedulePage, timesheetsPage, employeesPage, chatPage] as Loadable[]) {
      await module.goto();
      await module.expectLoaded();
    }

    const values = timings.durations.map((d) => d.ms);
    const p95 = percentile(values, 95);
    const slowest = [...timings.durations].sort((a, b) => b.ms - a.ms).slice(0, 3);
    test.info().annotations.push({
      type: 'perf-api',
      description: `${values.length} API calls; p50 ${percentile(values, 50)} ms; p95 ${p95} ms; max ${Math.max(0, ...values)} ms; slowest: ${slowest.map((s) => `${s.path} ${s.ms} ms`).join(', ')}`,
    });

    expect(values.length, 'Modules should load data through /api/ calls').toBeGreaterThan(0);
    expect(p95, `API p95 within ${API_P95_BUDGET_MS} ms`).toBeLessThanOrEqual(API_P95_BUDGET_MS);
  });

  test('PERF-05: a cold Home load stays within the page-weight budget', async ({ page, homePage }) => {
    let requests = 0;
    let bytes = 0;
    page.on('requestfinished', async (req) => {
      requests += 1;
      const sizes = await req.sizes().catch(() => null);
      if (sizes) bytes += sizes.responseBodySize + sizes.responseHeadersSize;
    });

    await homePage.goto();
    await homePage.expectLoaded();
    await page.waitForLoadState('networkidle').catch(() => undefined);

    test.info().annotations.push({
      type: 'perf-weight',
      description: `${requests} requests, ${(bytes / 1024 / 1024).toFixed(2)} MB transferred (budgets: ${REQUEST_COUNT_BUDGET} requests, ${PAGE_WEIGHT_BUDGET_BYTES / 1024 / 1024} MB)`,
    });
    expect(requests, 'Request count budget').toBeLessThanOrEqual(REQUEST_COUNT_BUDGET);
    expect(bytes, 'Transfer size budget').toBeLessThanOrEqual(PAGE_WEIGHT_BUDGET_BYTES);
  });
});
