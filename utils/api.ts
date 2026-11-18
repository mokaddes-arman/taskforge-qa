import { expect, type APIRequestContext } from '@playwright/test';
import { env } from './env';

/** Workspace slug, e.g. "abdul-s-workspace". */
export const WORKSPACE_SLUG = env.workspacePath.replace(/^\//, '');
export const WS_API = `/api/v1/workspaces/${WORKSPACE_SLUG}`;

/** TaskForge API response envelope. */
export interface Envelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; details?: Record<string, string> };
  message: string;
  statusCode: number;
  path: string;
}

export interface ApiResult<T = unknown> {
  status: number;
  contentType: string;
  body: Envelope<T>;
}

/**
 * Read-only API client over Playwright's request context (it carries the saved
 * session cookies). The integration specs only GET; `send` exists for RBAC
 * authorization probes whose payloads are no-ops.
 */
export class TaskForgeApi {
  constructor(private readonly request: APIRequestContext) {}

  async get<T = unknown>(path: string): Promise<ApiResult<T>> {
    const response = await this.request.get(path, { failOnStatusCode: false, maxRedirects: 0 });
    const body = (await response.json().catch(() => null)) as Envelope<T>;
    return { status: response.status(), contentType: response.headers()['content-type'] ?? '', body };
  }

  /**
   * Non-GET request for authorization probes. Callers must send a payload that
   * changes nothing even if the server wrongly accepts it (same values, an
   * existing member, an empty patch).
   */
  async send<T = unknown>(method: 'POST' | 'PATCH', path: string, data: unknown): Promise<ApiResult<T>> {
    const response = await this.request.fetch(path, { method, data, failOnStatusCode: false, maxRedirects: 0 });
    const body = (await response.json().catch(() => null)) as Envelope<T>;
    return { status: response.status(), contentType: response.headers()['content-type'] ?? '', body };
  }

  /** GET that must succeed; returns `data`. */
  async data<T = unknown>(path: string): Promise<T> {
    const result = await this.get<T>(path);
    expectSuccessEnvelope(path, result);
    return result.body.data as T;
  }
}

/** Contract every successful response must honour. */
export function expectSuccessEnvelope(path: string, result: ApiResult): void {
  expect(result.status, `${path}: HTTP status`).toBe(200);
  expect(result.contentType, `${path}: JSON content type`).toMatch(/application\/json/);
  expect(result.body, `${path}: JSON body`).not.toBeNull();
  expect(result.body.success, `${path}: success flag`).toBe(true);
  expect(result.body.statusCode, `${path}: statusCode mirrors HTTP status`).toBe(result.status);
  expect(result.body.path, `${path}: path echoes the request`).toBe(path);
  expect(typeof result.body.message, `${path}: message`).toBe('string');
  expect(result.body.message.length, `${path}: message not empty`).toBeGreaterThan(0);
  expect(result.body, `${path}: has a data field`).toHaveProperty('data');
  expect(result.body.error, `${path}: no error on success`).toBeUndefined();
}

/** Contract every error response must honour. */
export function expectErrorEnvelope(path: string, result: ApiResult, status: number, code: string): void {
  expect(result.status, `${path}: HTTP status`).toBe(status);
  expect(result.contentType, `${path}: JSON content type`).toMatch(/application\/json/);
  expect(result.body?.success, `${path}: success flag`).toBe(false);
  expect(result.body.statusCode, `${path}: statusCode mirrors HTTP status`).toBe(status);
  expect(result.body.error?.code, `${path}: error code`).toBe(code);
  expect(result.body.message, `${path}: human-readable message`).toMatch(/\S/);
  expect(JSON.stringify(result.body), `${path}: no stack trace`).not.toMatch(/\bat [\w.<>]+ \(|node_modules|\.ts:\d+/);
}

/** YYYY-MM-DD of `date` in an IANA time zone. */
export function isoDateIn(timeZone: string, date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Monday..Sunday ISO dates of the week containing `isoDate`. */
export function weekRange(isoDate: string): { from: string; to: string } {
  const day = new Date(`${isoDate}T00:00:00Z`);
  const mondayOffset = (day.getUTCDay() + 6) % 7;
  const from = new Date(day.getTime() - mondayOffset * 86_400_000);
  const to = new Date(from.getTime() + 6 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
