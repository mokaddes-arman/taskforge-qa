import { test } from '../fixtures/pages.fixture';

/**
 * COMP-07 / NFR-03 — screen resolutions not covered by the existing 375 px and
 * 1440 px checks in 11-security-edge-cases.spec.ts: 320 px (small phone),
 * 768 px (tablet portrait), 1024 px (tablet landscape / small laptop) and
 * 1920 px (full-HD desktop). Every page must render without a horizontal
 * scrollbar. Read-only.
 */

const VIEWPORTS = [
  { label: '320px small phone', width: 320, height: 640 },
  { label: '768px tablet portrait', width: 768, height: 1024 },
  { label: '1024px tablet landscape', width: 1024, height: 768 },
  { label: '1920px full HD', width: 1920, height: 1080 },
] as const;

test.describe('Compatibility — screen resolutions (COMP-07 / NFR-03)', () => {
  for (const viewport of VIEWPORTS) {
    test(`COMP-07: core pages fit ${viewport.label} without horizontal scroll`, async ({
      page, homePage, tasksPage, schedulePage, timesheetsPage, projectsPage, settingsPage,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const module of [homePage, tasksPage, schedulePage, timesheetsPage, projectsPage, settingsPage]) {
        await module.goto();
        // Below 768px some desktop controls (e.g. the Projects Table/Cards
        // toggle) are intentionally hidden, so the full readiness check only
        // applies to tablet and desktop widths; goto() already waits for the page.
        if (viewport.width >= 768) await module.expectLoaded();
        await module.expectNoHorizontalOverflow();
      }
    });
  }
});
