import { request as playwrightRequest, type APIResponse } from '@playwright/test';
import { test, expect } from '../fixtures/pages.fixture';
import { env } from '../utils/env';

/**
 * Security — transport, API and session hardening (SEC-02/04/08/09/10/11/12/13/14/17, GEN-07).
 *
 * Read-only: only GET/OPTIONS requests and page loads. Data APIs are not
 * hard-coded: each test records the same-origin `/api/` GETs the app itself
 * makes while loading a module, so the checks follow the live API surface.
 * No response body, cookie or token value is ever written to the report.
 *
 * Run: npm run test:modules:chrome -- tests/11-security-api.spec.ts
 */

const ORIGIN = new URL(env.baseURL).origin;
const FOREIGN_ORIGIN = 'https://evil.example';
const SESSION_ENDPOINT = '/api/v1/auth/get-session';
const STACK_TRACE = /(\bat [\w.<>$]+ \(|node_modules|Traceback \(most recent|\.(ts|js):\d+:\d+|webpack-internal|Error: .*\n\s+at )/;
const SENSITIVE_KEY = /pass(word)?|hash|secret|salt|otp|private/i;

/** Response headers every HTML page should send (OWASP secure headers). */
const REQUIRED_HTML_HEADERS: ReadonlyArray<{ name: string; valid: RegExp }> = [
  { name: 'strict-transport-security', valid: /max-age=\d{7,}/i },
  { name: 'content-security-policy', valid: /\S/ },
  { name: 'x-content-type-options', valid: /^nosniff$/i },
  { name: 'referrer-policy', valid: /\S/ },
];

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    prefix + key,
    ...flattenKeys(child, `${prefix}${key}.`),
  ]);
}

function frameProtection(headers: Record<string, string>): boolean {
  const xfo = headers['x-frame-options'] ?? '';
  const csp = headers['content-security-policy'] ?? '';
  return /deny|sameorigin/i.test(xfo) || /frame-ancestors/i.test(csp);
}

async function textOf(response: APIResponse): Promise<string> {
  return (await response.text().catch(() => '')).slice(0, 20_000);
}

test.describe('Security — transport, API and session hardening', () => {
  test('SEC-09: HTML responses send baseline security headers', async ({ page }) => {
    test.fail(true, 'QA-019: HSTS, CSP, X-Frame-Options, X-Content-Type-Options and Referrer-Policy are missing.');

    const missing: string[] = [];
    for (const path of ['/login', env.workspacePath]) {
      const response = await page.request.get(path, { maxRedirects: 0, failOnStatusCode: false });
      const headers = response.headers();
      for (const header of REQUIRED_HTML_HEADERS) {
        if (!header.valid.test(headers[header.name] ?? '')) missing.push(`${path}: ${header.name}`);
      }
      if (!frameProtection(headers)) missing.push(`${path}: x-frame-options / frame-ancestors`);
    }

    test.info().annotations.push({ type: 'missing-headers', description: missing.join(', ') || 'none' });
    expect(missing, 'Every HTML response must carry the baseline security headers').toEqual([]);
  });

  test('SEC-10: the login page refuses to render inside a third-party frame', async ({ browser }) => {
    test.fail(true, 'QA-020: no X-Frame-Options / frame-ancestors, so the login page can be framed (clickjacking).');

    // Anonymous context: a cross-site frame would not receive the session anyway.
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.setContent(`<iframe id="probe" src="${ORIGIN}/login" width="800" height="600"></iframe>`);

    // Give the frame time to load (or be blocked), then check what rendered.
    let rendered = false;
    for (let attempt = 0; attempt < 20 && !rendered; attempt += 1) {
      const frame = page.frames().find((candidate) => candidate.url().startsWith(ORIGIN));
      rendered = frame
        ? await frame
            .evaluate(() => Boolean(document.querySelector('input[type="password"], form')))
            .catch(() => false)
        : false;
      if (!rendered) await page.waitForTimeout(500);
    }

    await context.close();
    expect(rendered, 'The login form must not render inside a frame hosted by another origin').toBe(false);
  });

  test('SEC-11: the API does not grant CORS access to foreign origins', async ({ page }) => {
    const simple = await page.request.get(SESSION_ENDPOINT, {
      headers: { Origin: FOREIGN_ORIGIN },
      failOnStatusCode: false,
    });
    const preflight = await page.request.fetch(SESSION_ENDPOINT, {
      method: 'OPTIONS',
      headers: {
        Origin: FOREIGN_ORIGIN,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'content-type',
      },
      failOnStatusCode: false,
    });

    for (const [label, response] of [['GET', simple], ['OPTIONS preflight', preflight]] as const) {
      const allowOrigin = response.headers()['access-control-allow-origin'] ?? '';
      expect(allowOrigin, `${label}: a foreign origin must not be reflected`).not.toBe(FOREIGN_ORIGIN);
      expect(allowOrigin, `${label}: credentials must never be combined with a wildcard origin`).not.toBe('*');
    }
  });

  test('SEC-12: responses do not disclose server software versions', async ({ page }) => {
    test.fail(true, 'QA-021: x-powered-by discloses CyberPanel-OLS/2.5.0.');

    const disclosed: string[] = [];
    for (const path of ['/login', SESSION_ENDPOINT]) {
      const headers = (await page.request.get(path, { failOnStatusCode: false })).headers();
      for (const name of ['x-powered-by', 'server', 'x-aspnet-version', 'x-turbo-charged-by']) {
        const value = headers[name] ?? '';
        if (/\d+\.\d+/.test(value) || (name === 'x-powered-by' && value)) disclosed.push(`${path}: ${name}=${value}`);
      }
    }

    test.info().annotations.push({ type: 'disclosed-headers', description: disclosed.join(', ') || 'none' });
    expect(disclosed, 'No product/version banner headers').toEqual([]);
  });

  test('SEC-13: data APIs reject anonymous requests', async ({ page, tasksPage, employeesPage, leavePage, payrollPage }) => {
    const dataApis = new Set<string>();
    page.on('request', (req) => {
      const url = new URL(req.url());
      // /api/v1/plans is the public pricing catalogue (no tenant data).
      if (req.method() === 'GET' && url.origin === ORIGIN && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/v1/auth/') && url.pathname !== '/api/v1/plans') {
        dataApis.add(url.pathname + url.search);
      }
    });

    for (const module of [tasksPage, employeesPage, leavePage, payrollPage]) {
      await module.goto();
      await module.expectLoaded();
    }

    expect(dataApis.size, 'The modules should load data through same-origin /api/ GETs').toBeGreaterThan(0);

    const anonymous = await playwrightRequest.newContext({ baseURL: env.baseURL, storageState: { cookies: [], origins: [] } });
    const exposed: string[] = [];
    for (const path of dataApis) {
      const response = await anonymous.get(path, { failOnStatusCode: false, maxRedirects: 0 });
      if (![401, 403].includes(response.status())) exposed.push(`${response.status()} ${path.split('?')[0]}`);
    }
    await anonymous.dispose();

    test.info().annotations.push({ type: 'checked-endpoints', description: `${dataApis.size} endpoint(s)` });
    expect(exposed, 'Every data API must answer 401/403 without a session').toEqual([]);
  });

  test('SEC-14: the session API returns no credential material', async ({ page, credentials }) => {
    const response = await page.request.get(SESSION_ENDPOINT);

    expect(response.status(), 'get-session should succeed for the saved owner session').toBe(200);
    expect(response.headers()['content-type'] ?? '').toMatch(/application\/json/);

    const body = (await response.json()) as { user?: { email?: string }; session?: Record<string, unknown> };
    expect(body.user?.email?.toLowerCase(), 'The session belongs to the configured owner').toBe(credentials.email.toLowerCase());

    const leaked = flattenKeys(body).filter((key) => SENSITIVE_KEY.test(key.split('.').pop() ?? ''));
    expect(leaked, 'No password/hash/secret fields in the session payload').toEqual([]);
    expect(response.headers()['cache-control'] ?? '', 'Session responses must not be cached').toMatch(/no-store/);

    if (body.session && 'token' in body.session) {
      test.info().annotations.push({
        type: 'observation',
        description: 'get-session returns the session token in the JSON body (readable by page scripts despite the HttpOnly cookie).',
      });
    }
  });

  test('SEC-08: session cookies are HttpOnly, Secure and SameSite', async ({ context, browserName }) => {
    const host = new URL(env.baseURL).hostname;
    const sessionCookies = (await context.cookies(env.baseURL)).filter(
      (cookie) => /session|auth/i.test(cookie.name) && host.endsWith(cookie.domain.replace(/^\./, '')),
    );

    expect(sessionCookies.length, 'The saved owner session should hold at least one session cookie').toBeGreaterThan(0);
    for (const cookie of sessionCookies) {
      expect(cookie.httpOnly, `${cookie.name} must be HttpOnly`).toBe(true);
      expect(cookie.secure, `${cookie.name} must be Secure`).toBe(true);
      if (browserName === 'webkit') {
        // Playwright's WebKit build on Windows reports every cookie as SameSite=None
        // (no SameSite support in that port); Chrome and Firefox read Lax for the same cookie.
        test.info().annotations.push({ type: 'engine-limitation', description: `WebKit reports SameSite=${cookie.sameSite}; verified as Lax in Chrome/Firefox.` });
        continue;
      }
      expect(['Lax', 'Strict'], `${cookie.name} must set SameSite Lax or Strict`).toContain(cookie.sameSite);
    }
  });

  test('SEC-02/GEN-07: a non-member workspace URL exposes no workspace data', async ({ page, homePage }) => {
    const foreignPath = '/qa-nonmember-workspace-zz9';
    const leakedApis: string[] = [];
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/') && url.pathname.includes(foreignPath.slice(1)) && response.status() < 400) {
        leakedApis.push(`${response.status()} ${url.pathname}`);
      }
    });

    const response = await page.goto(foreignPath, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const finalPath = homePage.currentPath();
    const stayedOnForeignWorkspace = finalPath.startsWith(foreignPath);
    const denied = (response?.status() ?? 200) >= 400 || !stayedOnForeignWorkspace || (await homePage.showsNotFoundOrDenied());

    expect(denied, `Expected 403/404 or a redirect for ${foreignPath} (got ${response?.status()} at ${finalPath})`).toBe(true);
    expect(leakedApis, 'No successful data API calls for the foreign workspace').toEqual([]);
  });

  test('SEC-17: unknown routes and API paths return clean errors without stack traces', async ({ page }) => {
    for (const path of ['/api/v1/qa-definitely-not-an-endpoint', `${env.workspacePath}/qa-definitely-not-a-route`, '/api/v1/auth/qa-not-an-auth-route']) {
      const response = await page.request.get(path, { failOnStatusCode: false });
      expect(response.status(), `${path} should be a client error`).toBeGreaterThanOrEqual(400);
      expect(response.status(), `${path} must not be a server error`).toBeLessThan(500);
      expect(await textOf(response), `${path} must not leak a stack trace or source paths`).not.toMatch(STACK_TRACE);
    }
  });

  test('SEC-04 (QA-002): project descriptions contain no environment/config secrets', async ({ projectDetailPage }) => {
    test.fail(true, 'QA-002: the Global Softel description holds an .env-style configuration template.');

    await projectDetailPage.goto('Settings');
    const description = await projectDetailPage.storedDescription();
    const envAssignments = description.match(/^\s*#?\s*[A-Z][A-Z0-9_]{2,}\s*=/gm) ?? [];
    const secretKeys = description.match(/\b[A-Z0-9_]*(SECRET|PASSWORD|API_KEY|SERVICE_ROLE_KEY|MASTER_KEY|DATABASE_URL)[A-Z0-9_]*\b/g) ?? [];

    test.info().annotations.push({
      type: 'description-scan',
      description: `${description.length} chars, ${envAssignments.length} KEY= lines, ${new Set(secretKeys).size} secret-like key names (values not recorded)`,
    });
    expect(envAssignments.length, 'No KEY=value configuration lines in a project description').toBe(0);
    expect(secretKeys.length, 'No secret-like configuration key names in a project description').toBe(0);
  });
});
