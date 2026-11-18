import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage';

/** Better Auth endpoints that would send mail or create users. */
const PASSWORD_RESET_API = /\/api\/v1\/auth\/(forget-password|request-password-reset)/;
const SIGN_UP_API = /\/api\/v1\/auth\/sign-up/;

/**
 * Blocks an API at the network layer and records every attempt, so a
 * validation test can never create a user or send an email even if the
 * client-side validation it checks is broken.
 */
async function guardApi(page: Page, pattern: RegExp): Promise<string[]> {
  const attempts: string[] = [];
  await page.route(pattern, async (route) => {
    attempts.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.abort('blockedbyclient');
  });
  return attempts;
}

/** `/forgot-password` (AUTH-12). */
export class ForgotPasswordPage extends BasePage {
  readonly heading: Locator;
  readonly emailInput: Locator;
  readonly sendButton: Locator;
  readonly backToLoginLink: Locator;
  readonly alerts: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: 'Forgot your password?', level: 1 });
    this.emailInput = page.getByRole('textbox', { name: 'Email' });
    this.sendButton = page.getByRole('button', { name: 'Send reset link' });
    this.backToLoginLink = page.getByRole('link', { name: 'Back to log in' });
    this.alerts = page.locator('[role="alert"]');
  }

  /** Opens the page with the reset API blocked; returns the attempt log. */
  async gotoGuarded(): Promise<string[]> {
    const attempts = await guardApi(this.page, PASSWORD_RESET_API);
    await this.navigate('/forgot-password');
    await expect(this.heading).toBeVisible();
    return attempts;
  }

  async expectRendered(): Promise<void> {
    await expect(this.emailInput).toBeVisible();
    await expect(this.sendButton).toBeVisible();
    await expect(this.backToLoginLink).toHaveAttribute('href', '/login');
    await this.expectTitle(/forgot password/i);
  }

  async submitEmail(value: string): Promise<void> {
    await this.emailInput.fill(value);
    await this.sendButton.click();
  }

  async expectEmailError(): Promise<void> {
    await expect(this.alerts.filter({ hasText: /email/i }).first()).toBeVisible();
    await expect(this.emailInput).toHaveAttribute('aria-invalid', 'true');
  }
}

/** `/signup` (AUTH-13). */
export class SignupPage extends BasePage {
  readonly heading: Locator;
  readonly fullNameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly createAccountButton: Locator;
  readonly passwordPolicy: Locator;
  readonly loginLink: Locator;
  readonly alerts: Locator;

  constructor(page: Page) {
    super(page);
    this.heading = page.getByRole('heading', { name: 'Create your account', level: 1 });
    this.fullNameInput = page.getByRole('textbox', { name: 'Full name' });
    this.emailInput = page.getByRole('textbox', { name: 'Email' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password', exact: true });
    this.confirmPasswordInput = page.getByRole('textbox', { name: 'Confirm password' });
    this.createAccountButton = page.getByRole('button', { name: 'Create account' });
    this.passwordPolicy = page.getByText(/at least 6 characters/i);
    this.loginLink = page.getByRole('main').getByRole('link', { name: 'Log in' });
    this.alerts = page.locator('[role="alert"]');
  }

  /** Opens the page with the sign-up API blocked; returns the attempt log. */
  async gotoGuarded(): Promise<string[]> {
    const attempts = await guardApi(this.page, SIGN_UP_API);
    await this.navigate('/signup');
    await expect(this.heading).toBeVisible();
    return attempts;
  }

  async expectRendered(): Promise<void> {
    for (const input of [this.fullNameInput, this.emailInput, this.passwordInput, this.confirmPasswordInput]) {
      await expect(input).toBeVisible();
    }
    await expect(this.passwordInput).toHaveAttribute('type', 'password');
    await expect(this.passwordPolicy).toBeVisible();
    await expect(this.createAccountButton).toBeVisible();
    await expect(this.loginLink).toHaveAttribute('href', '/login');
    await this.expectTitle(/create account/i);
  }

  async fillForm(values: { name: string; email: string; password: string; confirm: string }): Promise<void> {
    await this.fullNameInput.fill(values.name);
    await this.emailInput.fill(values.email);
    await this.passwordInput.fill(values.password);
    await this.confirmPasswordInput.fill(values.confirm);
  }

  async submit(): Promise<void> {
    await this.createAccountButton.click();
  }

  /** True when at least one inline validation message is shown. */
  async validationMessages(): Promise<string[]> {
    await expect.poll(async () => (await this.alerts.allTextContents()).filter((t) => t.trim()).length, {
      timeout: 5_000,
    }).toBeGreaterThan(0);
    return (await this.alerts.allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }
}
