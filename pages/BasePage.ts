import { expect, type Locator, type Page } from '@playwright/test';
import { env } from '../utils/env';
import {
  gotoWithRetry,
  type NavigationRetryOptions,
} from '../utils/navigation';

export interface FocusInfo {
  tag: string;
  name: string;
  inMain: boolean;
  inNav: boolean;
  inDialog: boolean;
  visible: boolean;
  focusIndicator: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Shared navigation and assertion helpers for every page object. Page objects
 * own all selectors; tests only call their methods.
 */
export class BasePage {
  protected readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigate(path: string, options?: NavigationRetryOptions): Promise<void> {
    await gotoWithRetry(this.page, path, options);
  }

  currentPath(): string {
    return new URL(this.page.url()).pathname;
  }

  async expectUrl(pattern: string | RegExp): Promise<void> {
    await expect(this.page).toHaveURL(pattern);
  }

  /** Asserts the current pathname, ignoring query/hash differences. */
  async expectPath(path: string): Promise<void> {
    await expect(this.page).toHaveURL(
      new RegExp(`${escapeRegExp(path)}(?:[?#].*)?$`),
    );
  }

  async expectTitle(pattern: string | RegExp): Promise<void> {
    await expect(this.page).toHaveTitle(pattern);
  }

  /**
   * Dashboard/report modules render skeleton placeholders before their data
   * arrives (QA-007). Wait for real content by asserting no skeleton slots
   * remain in the given scope.
   */
  async waitForSkeletonsToClear(
    scope?: Locator,
    timeout = 30_000,
  ): Promise<void> {
    const target = scope ?? this.page.locator('body');

    await expect
      .poll(() => target.locator('[data-slot="skeleton"]').count(), {
        timeout,
        message: 'Expected loading skeletons to be replaced by real content',
      })
      .toBe(0);
  }

  /** Pins the viewport for responsive checks (NFR-03). */
  async setViewportSize(width: number, height: number): Promise<void> {
    await this.page.setViewportSize({ width, height });
  }

  async viewportSize(): Promise<{ width: number; height: number }> {
    const size = this.page.viewportSize();

    if (!size) {
      throw new Error('The browser viewport is not set');
    }

    return { width: size.width, height: size.height };
  }

  /**
   * True when the document is wider than the viewport, i.e. content overflows
   * horizontally and would trigger a mobile sideways scroll (NFR-03).
   */
  async hasHorizontalOverflow(): Promise<boolean> {
    const metrics = await this.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));

    return metrics.scrollWidth > metrics.clientWidth + 1;
  }

  // ------------------------------------------------ accessibility probes
  /** Document-level semantics checked by A11Y-05. */
  async documentSemantics(): Promise<{ lang: string; title: string; mainLandmarks: number }> {
    return this.page.evaluate(() => ({
      lang: document.documentElement.lang,
      title: document.title.trim(),
      mainLandmarks: [...document.querySelectorAll('main, [role="main"]')].filter(
        (el) => (el as HTMLElement).offsetParent !== null || getComputedStyle(el).position === 'fixed',
      ).length,
    }));
  }

  async pressKey(key: string): Promise<void> {
    await this.page.keyboard.press(key);
  }

  /** Describes the focused element: name, landmark and whether focus is visible (WCAG 2.4.7). */
  async activeElementInfo(): Promise<FocusInfo> {
    return this.page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) {
        return { tag: 'body', name: '', inMain: false, inNav: false, inDialog: false, visible: false, focusIndicator: false };
      }
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const indicator =
        (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
        (style.boxShadow !== 'none' && style.boxShadow !== '');
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || '')
        .replace(/\s+/g, ' ').trim().slice(0, 60);
      return {
        tag: el.tagName.toLowerCase(),
        name,
        inMain: !!el.closest('main, [role="main"]'),
        inNav: !!el.closest('nav, [role="navigation"]'),
        inDialog: !!el.closest('[role="dialog"], [role="alertdialog"]'),
        visible: rect.width > 0 && rect.height > 0,
        focusIndicator: indicator,
      };
    });
  }

  /** Presses Tab `count` times and returns where focus landed after each press. */
  async tabSequence(count: number): Promise<FocusInfo[]> {
    const stops: FocusInfo[] = [];
    for (let index = 0; index < count; index += 1) {
      await this.page.keyboard.press('Tab');
      stops.push(await this.activeElementInfo());
    }
    return stops;
  }

  async expectNoHorizontalOverflow(): Promise<void> {
    await expect
      .poll(() => this.hasHorizontalOverflow(), {
        timeout: 15_000,
        message: 'Expected no horizontal overflow at the current viewport',
      })
      .toBe(false);
  }
}
