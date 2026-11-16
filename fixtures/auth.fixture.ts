import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { WorkspacePage } from '../pages/WorkspacePage';
import {
  ownerCredentials,
  STORAGE_STATE,
  type Credentials,
} from '../utils/env';

interface AuthFixtures {
  credentials: Credentials;
  loginPage: LoginPage;
  workspacePage: WorkspacePage;
  authStoragePath: string;
  failureContext: void;
}

const MAX_CONTEXT_LINES = 15;
const SENSITIVE_PARAM = /pass|token|secret|code|email|key|session/i;

/** Masks credential-like query values so evidence never leaks secrets. */
function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);

    for (const name of [...url.searchParams.keys()]) {
      if (SENSITIVE_PARAM.test(name)) {
        url.searchParams.set(name, '***');
      }
    }

    return url.toString();
  } catch {
    return raw;
  }
}

function pushLimited(list: string[], line: string): void {
  if (list.length < MAX_CONTEXT_LINES) {
    list.push(line.replace(/\s+/g, ' ').slice(0, 300));
  }
}

/**
 * Records the page state developers need when a test fails: final URL,
 * console errors, uncaught page errors and failed/5xx network requests. It is
 * attached as "failure-context" only for unexpected results, so passing runs
 * stay lean; the dashboard reporter folds it into the bug report.
 */
async function trackFailureContext(
  page: Page,
  testInfo: TestInfo,
  use: () => Promise<void>,
): Promise<void> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      pushLimited(consoleErrors, message.text());
    }
  });
  page.on('pageerror', (error) => pushLimited(pageErrors, error.message));
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'failed';

    // Navigation away aborts in-flight requests; that is noise, not a defect.
    if (!/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(reason)) {
      pushLimited(
        failedRequests,
        `${request.method()} ${redactUrl(request.url())} -> ${reason}`,
      );
    }
  });
  page.on('response', (response) => {
    if (response.status() >= 500 || response.status() === 429) {
      pushLimited(
        failedRequests,
        `${response.request().method()} ${redactUrl(response.url())} -> HTTP ${response.status()}`,
      );
    }
  });

  await use();

  if (testInfo.status === testInfo.expectedStatus) {
    return;
  }

  const section = (title: string, lines: string[]) =>
    lines.length ? [`${title}:`, ...lines.map((line) => `  - ${line}`)] : [];
  const url = page.isClosed() ? '(page closed)' : redactUrl(page.url());
  const body = [
    `Page URL: ${url}`,
    ...section('Console errors', consoleErrors),
    ...section('Uncaught page errors', pageErrors),
    ...section('Failed / 5xx / 429 requests', failedRequests),
  ].join('\n');

  await testInfo.attach('failure-context', {
    body,
    contentType: 'text/plain',
  });
}

export const test = base.extend<AuthFixtures>({
  credentials: async ({}, use) => {
    await use(ownerCredentials());
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  workspacePage: async ({ page }, use) => {
    await use(new WorkspacePage(page));
  },
  authStoragePath: async ({}, use) => {
    await use(STORAGE_STATE);
  },
  failureContext: [
    async ({ page }, use, testInfo) => {
      await trackFailureContext(page, testInfo, () => use());
    },
    { auto: true },
  ],
});

export { expect };
