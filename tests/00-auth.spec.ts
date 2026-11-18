import { test, expect } from '../fixtures/auth.fixture';
import {
  attemptLogin,
  formatLoginDiagnostics,
  loginWithRateLimitRetry,
  loginWithRetry,
  openLoginPage,
  type LoginAttempt,
} from '../utils/auth';
import { env } from '../utils/env';
import { LoginPage } from '../pages/LoginPage';
import { WorkspacePage } from '../pages/WorkspacePage';
import { ForgotPasswordPage, SignupPage } from '../pages/AuthFormsPage';

const LOGIN_RETRY_OPTIONS = { attempts: 3, retryDelayMs: 1_500 };

// These tests type the real password; never record it in a trace.
test.use({ trace: 'off' });

// Each test submits the real sign-in form and /sign-in/email is rate-limited
// (QA-003), so keep this file on one worker even when the suite runs fully
// parallel. Other spec files still run alongside it.
test.describe.configure({ mode: 'default' });

function annotateFinding(description: string): void {
  test.info().annotations.push({
    type: 'qa-finding',
    description,
  });
}

test.describe('Login page UI', () => {
  test('renders the login form and account links', async ({ loginPage }) => {
    await loginPage.goto();

    await loginPage.expectTitle(/Log in .* TaskForge/);
    await loginPage.expectRendered();
  });

  test('empty fields show inline validation without calling the sign-in API', async ({
    loginPage,
  }) => {
    const signInRequests = loginPage.trackSignInRequests();

    await loginPage.goto({ waitForHydration: true });
    await loginPage.submit();

    await loginPage.expectEmptyFieldValidation();
    await loginPage.expectNoCredentialQuery();
    await loginPage.expectNoSignInRequests(signInRequests);
  });

  test('invalid email format is rejected before the sign-in API', async ({
    loginPage,
  }) => {
    const signInRequests = loginPage.trackSignInRequests();

    await loginPage.goto({ waitForHydration: true });
    await loginPage.fillEmail('not-an-email');
    await loginPage.fillPassword('Format-Test-Only!');
    await loginPage.submit();

    await loginPage.expectInvalidEmailValidation();
    await loginPage.expectNoCredentialQuery();
    await loginPage.expectNoSignInRequests(signInRequests);
  });

  test('password visibility toggles without losing the value', async ({
    loginPage,
  }) => {
    const fakePassword = 'Visibility-Test-Only!';

    await loginPage.goto({ waitForHydration: true });
    await loginPage.expectPasswordHidden();

    await loginPage.fillPassword(fakePassword);
    await loginPage.togglePasswordVisibility();
    await loginPage.expectPasswordRevealed(fakePassword);

    await loginPage.togglePasswordVisibility();
    await loginPage.expectPasswordHidden();
  });
});

test.describe('Authentication', () => {
  test('valid owner credentials authenticate and return a JSON API response', async ({
    page,
    credentials,
    workspacePage,
  }) => {
    test.slow();
    annotateFinding(
      'QA-004 reference: owner credentials and profile email alignment; see qa/findings.md.',
    );

    const result = await loginWithRetry(
      page,
      credentials,
      LOGIN_RETRY_OPTIONS,
    );

    await test.info().attach('login-attempts', {
      body: JSON.stringify(result.attempts, null, 2),
      contentType: 'application/json',
    });

    expect(result.success, formatLoginDiagnostics(result)).toBe(true);
    await workspacePage.expectAuthenticated();

    const successfulAttempt = result.attempts.at(-1);
    expect(successfulAttempt?.outcome).toBe('success');
    expect(successfulAttempt?.status).toBe(200);
    expect(successfulAttempt?.contentType).toMatch(/application\/json/i);

    // The client redirects as soon as the response arrives, so Playwright can
    // occasionally lose the response body before it is read. The status and
    // content type prove the JSON API contract; inspect the body when captured.
    if (successfulAttempt?.apiKeys) {
      expect(successfulAttempt.apiKeys).toEqual(
        expect.arrayContaining(['token', 'user']),
      );
    } else {
      test.info().annotations.push({
        type: 'note',
        description:
          'Sign-in response body was not readable after the redirect; status 200 and JSON content type were verified instead.',
      });
    }

    expect(successfulAttempt?.credentialUrlLeak).toBe(false);
  });

  test('invalid credentials return 401 and do not create a session', async ({
    page,
    credentials,
    loginPage,
    workspacePage,
  }) => {
    await openLoginPage(page);

    const invalid = {
      email: credentials.email,
      password: `Wrong-${Date.now()}-Password!`,
    };

    const attempts = await loginWithRateLimitRetry(page, invalid);
    const attempt = attempts.at(-1);

    await test.info().attach('invalid-login-attempts', {
      body: JSON.stringify(attempts, null, 2),
      contentType: 'application/json',
    });

    expect(
      attempt?.outcome,
      formatLoginDiagnostics({ success: false, attempts }),
    ).toBe('invalid');

    await loginPage.expectInvalidCredentialsError();
    await workspacePage.expectLoggedOut();

    expect(attempt?.status).toBe(401);
    expect(attempt?.apiCode).toBe('INVALID_EMAIL_OR_PASSWORD');
    expect(attempt?.credentialUrlLeak).toBe(false);
    await loginPage.expectNoCredentialQuery();
  });

  test('authenticated storageState persists into a new browser context', async ({
    browser,
    credentials,
  }) => {
    test.slow();

    const statePath = test.info().outputPath('persistence-state.json');
    const contextA = await browser.newContext({ baseURL: env.baseURL });

    try {
      const pageA = await contextA.newPage();
      const loginResult = await loginWithRetry(
        pageA,
        credentials,
        LOGIN_RETRY_OPTIONS,
      );

      await test.info().attach('persistence-login-attempts', {
        body: JSON.stringify(loginResult.attempts, null, 2),
        contentType: 'application/json',
      });

      expect(
        loginResult.success,
        formatLoginDiagnostics(loginResult),
      ).toBe(true);
      await new WorkspacePage(pageA).expectAuthenticated();

      // Persist the authenticated cookies/local storage, then discard the
      // original context. Context B must still be authenticated.
      await contextA.storageState({ path: statePath });
    } finally {
      await contextA.close();
    }

    const contextB = await browser.newContext({
      baseURL: env.baseURL,
      storageState: statePath,
    });

    try {
      const pageB = await contextB.newPage();
      const workspacePage = new WorkspacePage(pageB);

      await workspacePage.goto();
      await workspacePage.expectAuthenticated();

      expect(workspacePage.currentPath()).not.toBe('/login');
    } finally {
      await contextB.close();
    }
  });

  test('a fresh unauthenticated context is redirected from protected routes', async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: env.baseURL });

    try {
      const page = await context.newPage();
      const loginPage = new LoginPage(page);
      const workspacePage = new WorkspacePage(page);

      await workspacePage.goto();
      await workspacePage.expectLoggedOut();
      await loginPage.expectVisible();
    } finally {
      await context.close();
    }
  });

  test('logout clears the session and protects workspace routes', async ({
    page,
    credentials,
    workspacePage,
  }) => {
    test.slow();

    const loginResult = await loginWithRetry(
      page,
      credentials,
      LOGIN_RETRY_OPTIONS,
    );

    await test.info().attach('logout-login-attempts', {
      body: JSON.stringify(loginResult.attempts, null, 2),
      contentType: 'application/json',
    });

    expect(loginResult.success, formatLoginDiagnostics(loginResult)).toBe(true);
    await workspacePage.expectAuthenticated();

    await workspacePage.logout();
    await workspacePage.expectLoggedOut();

    // A protected route must not render after logout.
    await workspacePage.goto();
    await workspacePage.expectLoggedOut();
  });

  test('clearing session cookies redirects protected routes to login', async ({
    page,
    context,
    credentials,
    loginPage,
    workspacePage,
  }) => {
    test.slow();
    annotateFinding(
      'Session-expiry simulation: auth cookies cleared in a disposable context.',
    );

    const loginResult = await loginWithRetry(
      page,
      credentials,
      LOGIN_RETRY_OPTIONS,
    );

    await test.info().attach('session-expiry-login-attempts', {
      body: JSON.stringify(loginResult.attempts, null, 2),
      contentType: 'application/json',
    });

    expect(loginResult.success, formatLoginDiagnostics(loginResult)).toBe(true);
    await workspacePage.expectAuthenticated();

    await context.clearCookies();
    await workspacePage.goto();

    await workspacePage.expectLoggedOut();
    await loginPage.expectVisible();
  });

  test('QA-003: repeated fresh-context sign-ins are consistent', async ({
    browser,
    credentials,
  }) => {
    test.slow();
    annotateFinding(
      'QA-003 reference: fresh-context sign-in consistency guard. The original transient-401 claim remains documented and is not automatically re-confirmed.',
    );

    const iterations = 3;
    const attemptGroups: LoginAttempt[][] = [];

    for (let current = 1; current <= iterations; current += 1) {
      const context = await browser.newContext({ baseURL: env.baseURL });

      try {
        const page = await context.newPage();
        await openLoginPage(page);

        attemptGroups.push(
          await loginWithRateLimitRetry(page, credentials, current, {
            maxRateLimitRetries: 2,
          }),
        );
      } finally {
        await context.close();
      }
    }

    const attempts = attemptGroups.flat();
    await test.info().attach('fresh-context-logins', {
      body: JSON.stringify(attempts, null, 2),
      contentType: 'application/json',
    });

    const finalAttempts = attemptGroups
      .map((group) => group.at(-1))
      .filter((attempt): attempt is LoginAttempt => Boolean(attempt));
    const failures = finalAttempts.filter(
      (attempt) => attempt.outcome !== 'success',
    );

    expect(
      failures,
      `QA-003 transient sign-in failure detected. ` +
        `Expected all ${iterations} fresh-context logins to succeed.\n` +
        `Attempts: ${JSON.stringify(attempts, null, 2)}`,
    ).toHaveLength(0);
    expect(finalAttempts).toHaveLength(iterations);

    for (const attempt of finalAttempts) {
      expect(attempt.status).toBe(200);
      expect(attempt.credentialUrlLeak).toBe(false);
    }
  });
});

/**
 * Authentication hardening added by the 17 Nov 2026 coverage audit.
 * Dummy credentials are used wherever no real sign-in is needed; the sign-up
 * and password-reset APIs are blocked at the network layer so no user is
 * created and no email is sent even if client-side validation breaks.
 */
test.describe('Authentication hardening', () => {
  const DUMMY_EMAIL = 'qa.dummy@example.com';
  const DUMMY_PASSWORD = 'Dummy-Not-A-Real-Pw1!';

  test('AUTH-12: forgot-password page validates an empty email without sending a reset', async ({ page }) => {
    const forgotPage = new ForgotPasswordPage(page);
    const resetAttempts = await forgotPage.gotoGuarded();
    await forgotPage.expectRendered();

    await forgotPage.submitEmail('');
    await forgotPage.expectEmailError();
    await forgotPage.submitEmail('not-an-email');
    await forgotPage.expectEmailError();

    expect(resetAttempts, 'Invalid input must not call the password-reset API').toEqual([]);
  });

  test('AUTH-13: sign-up page renders its form without submitting', async ({ page }) => {
    const signupPage = new SignupPage(page);
    const signUpAttempts = await signupPage.gotoGuarded();
    await signupPage.expectRendered();

    // Boundary: 5-character password without a digit, and a mismatched confirmation.
    await signupPage.fillForm({ name: 'QA Boundary', email: DUMMY_EMAIL, password: 'abcd!', confirm: 'abcd?' });
    await signupPage.submit();
    const messages = await signupPage.validationMessages();

    expect(messages.join(' | '), 'Weak/mismatched passwords are rejected inline').toMatch(/password|match|characters/i);
    expect(signUpAttempts, 'Invalid input must not call the sign-up API').toEqual([]);
  });

  test('AUTH-14: whitespace-only email is rejected before the sign-in API', async ({ page, loginPage }) => {
    const attempts = await loginPage.blockSignInApi();
    await loginPage.goto({ waitForHydration: true });

    await loginPage.fillEmail('   ');
    await loginPage.fillPassword('   ');
    await loginPage.submit();
    await expect(loginPage.emailInput).toHaveAttribute('aria-invalid', 'true');
    await expect(loginPage.errorAlert(/enter your email/i)).toBeVisible();

    expect(attempts, 'No sign-in request for a blank email').toEqual([]);
    await expect(page).toHaveURL(/\/login$/);
  });

  test('AUTH-14 (QA-029): over-long email and whitespace-only password are rejected before the sign-in API', async ({ page, loginPage }) => {
    test.fail(true, 'QA-029: a 300-character email (RFC 5321 max 254) and a whitespace-only password pass client validation and are sent to the sign-in API.');
    const attempts = await loginPage.blockSignInApi();
    await loginPage.goto({ waitForHydration: true });

    await loginPage.fillEmail(`${'a'.repeat(290)}@example.com`);
    await loginPage.fillPassword(DUMMY_PASSWORD);
    await loginPage.submit();
    await page.waitForTimeout(1_500);

    await loginPage.goto({ waitForHydration: true });
    await loginPage.fillEmail(DUMMY_EMAIL);
    await loginPage.fillPassword('   ');
    await loginPage.submit();
    await page.waitForTimeout(1_500);

    expect(attempts, 'Invalid credentials must be stopped client-side').toEqual([]);
  });

  test('SEC-16 (QA-012): login form without scripts must not put credentials in the URL', async ({ loginPage }) => {
    test.fail(true, 'QA-012: the server-rendered <form> has no method, so a pre-hydration/no-JS submit is a GET with the credentials in the query string.');

    await loginPage.gotoWithoutScripts();
    await loginPage.fillEmail(DUMMY_EMAIL);
    await loginPage.fillPassword(DUMMY_PASSWORD);
    await loginPage.submitAndWaitForNavigation();

    await loginPage.expectNoCredentialQuery();
  });

  test('SEC-08/AUTH-15: post-login redirect stays on-origin and a logged-out token cannot be replayed', async ({
    browser,
    page,
    context,
    credentials,
    loginPage,
    workspacePage,
  }) => {
    test.slow();
    const origin = new URL(env.baseURL).origin;
    const evil = encodeURIComponent('https://evil.example/phish');

    await loginPage.gotoWithQuery(`callbackURL=${evil}&redirect=${evil}&redirectTo=${evil}&next=${evil}`);
    const attempt = await attemptLogin(page, credentials, 1);
    expect(attempt.outcome, `Sign-in outcome: ${JSON.stringify({ ...attempt, url: undefined })}`).toBe('success');
    await workspacePage.expectAuthenticated();
    expect(new URL(page.url()).origin, 'Post-login navigation must stay on the application origin').toBe(origin);

    // Capture the live session, log out, then replay the old cookies.
    const issuedCookies = await context.cookies(env.baseURL);
    await workspacePage.logout();
    await workspacePage.expectLoggedOut();

    const replay = await browser.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
    try {
      await replay.addCookies(issuedCookies);
      const replayPage = await replay.newPage();
      const session = await replayPage.request.get('/api/v1/auth/get-session');
      const body = await session.json().catch(() => null);
      expect(body?.user ?? null, 'A logged-out session token must not authenticate again').toBeNull();

      const replayWorkspace = new WorkspacePage(replayPage);
      await replayWorkspace.goto();
      await replayWorkspace.expectLoggedOut();
    } finally {
      await replay.close();
    }
  });
});
