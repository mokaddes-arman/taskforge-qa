import { expect, type Locator, type Page } from '@playwright/test';
import type { Credentials } from '../utils/env';
import { BasePage } from './BasePage';

const SIGN_IN_ENDPOINT = '/api/v1/auth/sign-in/email';
export const INVALID_CREDENTIALS = /invalid email or password/i;

export type SignInOutcome =
  | { kind: 'success' }
  | { kind: 'invalid'; text: string };

export class LoginPage extends BasePage {
  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly rememberMeCheckbox: Locator;
  readonly passwordToggle: Locator;
  readonly submitButton: Locator;
  readonly forgotPasswordLink: Locator;
  readonly signupLink: Locator;
  readonly alerts: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', {
      name: 'Welcome back',
      level: 1,
    });
    this.emailInput = page.getByRole('textbox', { name: 'Email' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.rememberMeCheckbox = page.getByRole('checkbox', {
      name: /remember me/i,
    });
    this.passwordToggle = page.getByRole('button', {
      name: /show password|hide password/i,
    });
    this.submitButton = page.getByRole('button', {
      name: 'Log in',
      exact: true,
    });
    this.forgotPasswordLink = page.getByRole('link', {
      name: 'Forgot your password?',
    });
    this.signupLink = page.getByRole('link', { name: 'Register now' });
    this.alerts = page.locator('[role="alert"]');
  }

  async goto(options: { waitForHydration?: boolean } = {}): Promise<void> {
    await this.navigate('/login');
    await this.waitForForm();

    if (options.waitForHydration) {
      await this.waitForHydration();
    }
  }

  /**
   * Opens /login with the application scripts blocked, i.e. the state before
   * React hydrates (or with JavaScript disabled). Used by SEC-16 / QA-012.
   */
  async gotoWithoutScripts(): Promise<void> {
    await this.page.route(/\/_next\/static\/.*\.js(\?|$)/, (route) => route.abort());
    await this.navigate('/login');
    await this.waitForForm();
  }

  /**
   * Aborts sign-in API calls in the browser and records them, so validation
   * tests never reach the server or consume the sign-in rate limit.
   */
  async blockSignInApi(): Promise<string[]> {
    const attempts: string[] = [];
    await this.page.route(/\/api\/v1\/auth\/sign-in\//, async (route) => {
      attempts.push(new URL(route.request().url()).pathname);
      await route.abort('blockedbyclient');
    });
    return attempts;
  }

  /** Opens /login with extra query parameters (e.g. a redirect target). */
  async gotoWithQuery(query: string): Promise<void> {
    await this.navigate(`/login?${query}`);
    await this.waitForForm();
    await this.waitForHydration();
  }

  /** Submits the form and waits for the browser to leave or reload /login. */
  async submitAndWaitForNavigation(): Promise<void> {
    await Promise.all([
      this.page.waitForURL((url) => url.search.length > 0 || url.pathname !== '/login', { timeout: 15_000 }).catch(() => undefined),
      this.submitButton.click(),
    ]);
  }

  async waitForForm(): Promise<void> {
    await this.emailInput.waitFor({ state: 'visible', timeout: 15_000 });
  }

  /**
   * A native form submission before React hydrates performs a GET and leaks the
   * password into the URL (QA-012). Wait for React's onSubmit handler to be
   * attached before filling or clicking the form.
   */
  async waitForHydration(): Promise<void> {
    await this.page.waitForFunction(
      () => {
        const form = document.querySelector('form');
        if (!form) {
          return false;
        }

        const propsKey = Object.keys(form).find(
          (key) =>
            key.startsWith('__reactProps$') ||
            key.startsWith('__reactEventHandlers$'),
        );

        return (
          !!propsKey &&
          typeof (form as unknown as Record<string, { onSubmit?: unknown }>)[
            propsKey
          ]?.onSubmit === 'function'
        );
      },
      undefined,
      { timeout: 20_000 },
    );
  }

  /** Records sign-in API calls so tests can prove client-side validation. */
  trackSignInRequests(): string[] {
    const requests: string[] = [];
    this.page.on('request', (request) => {
      if (request.url().includes(SIGN_IN_ENDPOINT)) {
        requests.push(request.url());
      }
    });
    return requests;
  }

  async fillEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
  }

  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password);
  }

  /**
   * Types a real secret without recording it. Playwright titles every input
   * action with its value (`Fill "<value>"`, `Type "<value>"`, `Insert "<value>"`)
   * in the HTML report, traces and custom reporters, which leaked the owner
   * password into published CI artifacts. Setting the value through the native
   * setter and dispatching input/change events works with React-controlled
   * inputs and is recorded only as `Evaluate`.
   */
  async fillSecretPassword(secret: string): Promise<void> {
    await this.passwordInput.evaluate((el, value) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      input.focus();
      if (setter) setter.call(input, value);
      else input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, secret);
    // Compare lengths only so a failed assertion never prints the secret.
    const length = await this.passwordInput.evaluate((el) => (el as HTMLInputElement).value.length);
    expect(length, 'password field holds the full secret').toBe(secret.length);
  }

  async fillCredentials(credentials: Credentials): Promise<void> {
    await this.fillEmail(credentials.email);
    await this.fillSecretPassword(credentials.password);
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async togglePasswordVisibility(): Promise<void> {
    await this.passwordToggle.click();
  }

  errorAlert(text: string | RegExp): Locator {
    return this.alerts.filter({ hasText: text }).first();
  }

  /**
   * Next.js renders its route announcer with role="alert" as well, so a plain
   * getByRole('alert') can be ambiguous. Read the first alert that has text.
   */
  async readAlert(): Promise<string> {
    const count = await this.alerts.count();

    for (let index = 0; index < count; index += 1) {
      const text = (await this.alerts
        .nth(index)
        .textContent()
        .catch(() => '')) ?? '';
      const clean = text.replace(/\s+/g, ' ').trim();
      if (clean) {
        return clean;
      }
    }

    return '';
  }

  /**
   * Waits for the post-submit outcome: a redirect off /login, or the inline
   * invalid-credentials alert. Never reads the response body.
   */
  async waitForSignInOutcome(): Promise<SignInOutcome> {
    const handle = await this.page.waitForFunction(
      () => {
        const alert = document.querySelector('[role="alert"]');
        const text = (alert?.textContent ?? '').replace(/\s+/g, ' ').trim();

        if (window.location.pathname !== '/login') {
          return { kind: 'success' } as const;
        }

        if (/invalid email or password/i.test(text)) {
          return { kind: 'invalid', text } as const;
        }

        return false;
      },
      undefined,
      { timeout: 20_000 },
    );

    return handle.jsonValue() as Promise<SignInOutcome>;
  }

  async expectRendered(): Promise<void> {
    await expect(this.heading).toBeVisible();
    await expect(this.emailInput).toBeVisible();
    await expect(this.passwordInput).toBeVisible();
    await expect(this.passwordInput).toHaveAttribute('type', 'password');
    await expect(this.rememberMeCheckbox).toBeVisible();
    await expect(this.submitButton).toBeVisible();
    await expect(this.passwordToggle).toHaveAttribute(
      'aria-label',
      'Show password',
    );
    await expect(this.forgotPasswordLink).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    await expect(this.signupLink).toHaveAttribute('href', '/signup');
  }

  async expectVisible(): Promise<void> {
    await expect(this.emailInput).toBeVisible();
  }

  async expectEmptyFieldValidation(): Promise<void> {
    await expect(this.errorAlert(/enter your email/i)).toBeVisible();
    await expect(this.errorAlert(/enter your password/i)).toBeVisible();
    await expect(this.emailInput).toHaveAttribute('aria-invalid', 'true');
    await expect(this.passwordInput).toHaveAttribute('aria-invalid', 'true');
  }

  async expectInvalidEmailValidation(): Promise<void> {
    await expect(
      this.errorAlert(/enter a valid email address/i),
    ).toBeVisible();
    await expect(this.emailInput).toHaveAttribute('aria-invalid', 'true');
  }

  async expectInvalidCredentialsError(): Promise<void> {
    await expect(this.errorAlert(INVALID_CREDENTIALS)).toBeVisible();
  }

  async expectPasswordHidden(): Promise<void> {
    await expect(this.passwordInput).toHaveAttribute('type', 'password');
    await expect(this.passwordToggle).toHaveAttribute(
      'aria-label',
      'Show password',
    );
  }

  async expectPasswordRevealed(value: string): Promise<void> {
    await expect(this.passwordInput).toHaveAttribute('type', 'text');
    await expect(this.passwordInput).toHaveValue(value);
    await expect(this.passwordToggle).toHaveAttribute(
      'aria-label',
      'Hide password',
    );
  }

  async expectNoCredentialQuery(): Promise<void> {
    await expect(this.page).not.toHaveURL(/[?&](email|password)=/i);
  }

  async expectNoSignInRequests(requests: string[]): Promise<void> {
    expect(requests).toHaveLength(0);
  }
}
