import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPath } from './open.js';
import { buildBugReport, bugReportMarkdown } from './bug-report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, 'template.html');
const CSS_PATH = path.join(__dirname, 'assets', 'dashboard.css');
const JS_PATH = path.join(__dirname, 'assets', 'dashboard.js');

const normalizeStatus = (s) => (s === 'timedOut' || s === 'interrupted' ? 'failed' : s);

// Playwright passes colorized error strings straight to reporters.
const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');

// Playwright appends tags (e.g. " @smoke") to the title when the tag option is
// used. Drop any trailing tag tokens so the dashboard shows a clean title.
const stripTags = (title) => String(title || '').replace(/(\s+@[\w-]+)+\s*$/, '').trim();

function playwrightVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'playwright-core', 'package.json'), 'utf8')
    );
    return pkg.version;
  } catch {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'node_modules', '@playwright', 'test', 'package.json'), 'utf8')
      );
      return pkg.version;
    } catch {
      return '';
    }
  }
}

function flattenSteps(steps, out = []) {
  for (const step of steps || []) {
    if (step.title && step.category !== 'pw:api') out.push(step.title);
    if (step.steps?.length) flattenSteps(step.steps, out);
  }
  return out;
}

/**
 * Developer-facing reproduction steps: test.step titles, page actions and
 * assertions in execution order (fixtures/hooks omitted). The failing step is
 * flagged so the bug report can point at it.
 */
function actionSteps(steps, out = []) {
  for (const step of steps || []) {
    if (['test.step', 'pw:api', 'expect'].includes(step.category) && step.title) {
      out.push({ title: stripAnsi(step.title), failed: Boolean(step.error) });
    }
    // Fixture/hook setup (launch browser, create context...) is not a repro step.
    const nested = !['pw:api', 'expect', 'hook', 'fixture'].includes(step.category);
    if (nested && step.steps?.length) actionSteps(step.steps, out);
  }
  return out;
}

// Cluster key: first line of the error, numbers masked, whitespace collapsed.
function clusterKey(message) {
  const first = String(message || 'unknown error').split('\n')[0];
  return first.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function gitInfo(cwd) {
  const read = (p) => {
    try {
      return fs.readFileSync(path.join(cwd, '.git', p), 'utf8').trim();
    } catch {
      return '';
    }
  };
  const head = read('HEAD');
  if (head.startsWith('ref: ')) {
    const ref = head.slice(5);
    return { branch: ref.replace(/^refs\/heads\//, ''), commit: read(ref).slice(0, 8) };
  }
  return { branch: '', commit: head.slice(0, 8) };
}

/**
 * Emits one self-contained HTML test-health dashboard (no deps, no network),
 * plus a developer bug report (bug-report.md / bug-report.json) built from the
 * same run. Both the HTML report and this reporter receive the same
 * TestCase/TestResult data, so the numbers always agree.
 *
 * Options:
 *   outputFile  - dashboard path (default dashboard-report/index.html)
 *   projectName - name shown in the dashboard header (default "TaskForge QA")
 *   open        - "auto" (default: open locally on a TTY), "always" or "never"
 */
export default class DashboardReporter {
  constructor(options = {}) {
    this.outputFile = path.resolve(options.outputFile || 'dashboard-report/index.html');
    this.projectName = options.projectName || 'TaskForge QA';
    this.openMode = process.env.DASHBOARD_OPEN || options.open || 'auto';
    this.byId = new Map();
    this.workerIndexes = new Set();
    this.runStart = null;
  }

  onBegin(config) {
    this.config = config;
    this.rootDir = config.rootDir || process.cwd();
    this.configDir = config.configFile ? path.dirname(config.configFile) : process.cwd();
    this.runStart = new Date();
    this.baseURL = config.projects?.find((p) => p.use?.baseURL)?.use?.baseURL || process.env.BASE_URL || '';
  }

  onTestEnd(test, result) {
    let entry = this.byId.get(test.id);
    if (!entry) {
      const project = test.parent?.project?.()?.name || 'default';
      const location = test.location || {};
      const file = location.file
        ? path.relative(this.configDir, location.file).split(path.sep).join('/')
        : 'unknown';
      entry = {
        id: test.id,
        title: stripTags(test.title),
        titlePath: test.titlePath().filter(Boolean).slice(2, -1).map(stripTags),
        file,
        line: location.line || 0,
        project,
        browser: test.parent?.project?.()?.use?.channel || test.parent?.project?.()?.use?.browserName || '',
        tags: (test.tags || []).map((t) => String(t).replace(/^@/, '')),
        attempts: [],
      };
      this.byId.set(test.id, entry);
    }

    // Annotations can be added at runtime (test.fail/test.skip inside the body).
    entry.annotations = test.annotations || [];
    entry.expectedStatus = test.expectedStatus;
    entry.outcome = test.outcome();

    const errorText = result.error
      ? {
          message: stripAnsi(result.error.message).split('\n')[0].trim().slice(0, 200),
          full: stripAnsi(result.error.message || ''),
          stack: stripAnsi(result.error.stack || result.error.message),
          snippet: stripAnsi(result.error.snippet || ''),
          location: result.error.location || null,
        }
      : null;

    entry.attempts.push({
      status: normalizeStatus(result.status),
      duration: result.duration,
      error: errorText,
      result,
    });

    entry.duration = result.duration;
    entry.startTime = result.startTime;
    entry.workerIndex = result.workerIndex;
    if (result.workerIndex != null) this.workerIndexes.add(result.workerIndex);
  }

  onEnd(fullResult) {
    const runEnd = new Date();
    const tests = [...this.byId.values()].map((entry) => this._finalizeTest(entry));

    // Nothing to report (e.g. `--list`): leave the previous artifacts untouched.
    if (!tests.length) {
      void fullResult;
      return;
    }

    const totals = { total: tests.length, passed: 0, failed: 0, flaky: 0, skipped: 0 };
    for (const t of tests) totals[t.status] = (totals[t.status] || 0) + 1;
    const denom = totals.passed + totals.failed + totals.flaky;
    const passRate = denom ? (totals.passed + totals.flaky) / denom : 0;

    const dashboardDir = path.dirname(this.outputFile);
    const reportUrl = path
      .relative(dashboardDir, path.join(this.configDir, 'playwright-report', 'index.html'))
      .split(path.sep)
      .join('/');

    // Drop stale attachments from the previous run, then copy this run's.
    fs.rmSync(path.join(dashboardDir, 'assets'), { recursive: true, force: true });
    this._copyAttachments(tests, dashboardDir);
    tests.forEach((t) => (t.reportUrl = `${reportUrl}#?testId=${encodeURIComponent(t.id)}`));

    const clusters = this._clusters(tests);
    const historyPath = path.join(dashboardDir, 'history.json');
    const history = this._readHistory(historyPath);
    const previous = history.length ? history[history.length - 1] : this._readPrevious(path.join(dashboardDir, 'last-run.json'));
    const suites = new Set(tests.map((t) => t.file)).size;
    const projects = [...new Set(tests.map((t) => t.project))];
    const git = gitInfo(this.configDir);

    const summary = {
      date: runEnd.toISOString(),
      total: totals.total,
      passed: totals.passed,
      failed: totals.failed,
      flaky: totals.flaky,
      skipped: totals.skipped,
      passRate,
    };
    const nextHistory = [...history, summary].slice(-20);

    const payload = {
      projectName: this.projectName,
      runDate: runEnd.toISOString(),
      generatedAt: new Date().toISOString(),
      runStart: this.runStart.toISOString(),
      runEnd: runEnd.toISOString(),
      durationMs: runEnd - this.runStart,
      runStatus: fullResult?.status || '',
      // Worker indexes grow when a worker restarts after a failure and include
      // the setup project's worker, so report the configured pool size.
      workers: typeof this.config?.workers === 'number' ? this.config.workers : this.workerIndexes.size || 1,
      workerSlots: this.workerIndexes.size,
      branch: process.env.GITHUB_REF_NAME || process.env.GIT_BRANCH || git.branch,
      commit: (process.env.GITHUB_SHA || '').slice(0, 8) || git.commit,
      env: process.env.CI ? 'CI' : 'local',
      os: `${os.type()} ${os.release()}`,
      node: process.version,
      baseURL: this.baseURL,
      playwrightVersion: playwrightVersion(),
      suites,
      projects,
      totals,
      passRate,
      previousPassRate: previous?.passRate ?? null,
      previousTotals: previous
        ? { total: previous.total, passed: previous.passed, failed: previous.failed, flaky: previous.flaky, skipped: previous.skipped }
        : null,
      history: nextHistory,
      clusters,
      tests,
    };

    payload.bugReport = buildBugReport(payload);
    const markdown = bugReportMarkdown(payload);
    payload.bugReportMarkdown = markdown;

    // Raw steps are only needed to build the bug report; keep the page lean.
    for (const t of tests) delete t.actions;

    fs.mkdirSync(dashboardDir, { recursive: true });
    fs.writeFileSync(this.outputFile, this._html(payload));
    fs.writeFileSync(path.join(dashboardDir, 'bug-report.md'), markdown);
    fs.writeFileSync(path.join(dashboardDir, 'bug-report.json'), JSON.stringify(payload.bugReport, null, 2));
    fs.writeFileSync(historyPath, JSON.stringify(nextHistory, null, 2));
    fs.writeFileSync(
      path.join(dashboardDir, 'last-run.json'),
      JSON.stringify({ passRate, totals, runDate: payload.runDate }, null, 2)
    );

    const bugs = payload.bugReport.bugs.length;
    const known = payload.bugReport.knownDefects.length;
    console.log(
      `\nDashboard: ${this.outputFile}  ` +
        `(${totals.passed} passed, ${totals.failed} failed, ${totals.flaky} flaky, ${totals.skipped} skipped, ${(passRate * 100).toFixed(1)}% pass)` +
        `\nBug report: ${path.join(dashboardDir, 'bug-report.md')}  (${bugs} new bug${bugs === 1 ? '' : 's'}, ${known} known defect${known === 1 ? '' : 's'})`
    );
    const shouldOpen =
      this.openMode === 'always' || (this.openMode === 'auto' && process.stdin.isTTY && !process.env.CI);
    if (shouldOpen) openPath(this.outputFile);
  }

  _finalizeTest(entry) {
    const last = entry.attempts[entry.attempts.length - 1];
    let status = last.status;

    // Mirror Playwright's own outcome: an expected failure (test.fail) is a
    // pass, a test that was expected to fail but passed is a failure.
    const knownDefect = entry.expectedStatus === 'failed';
    if (entry.outcome === 'expected' && status === 'failed') status = 'passed';
    if (entry.outcome === 'unexpected' && status === 'passed') status = 'failed';
    if (status === 'passed' && entry.attempts.slice(0, -1).some((a) => a.status === 'failed')) {
      status = 'flaky';
    }

    const annotations = entry.annotations || [];
    const ann = (type) => annotations.find((a) => a.type === type)?.description;
    const titleMatch = entry.title.match(/\b(GET|POST|PUT|DELETE|PATCH)\s+(\S+)/);
    const endpoint = ann('endpoint') || (titleMatch ? `${titleMatch[1]} ${titleMatch[2]}` : '');
    const httpStatus = Number(ann('status')) || null;

    const attachments = last.result?.attachments || [];
    const find = (name) => attachments.find((a) => a.name === name);
    const text = (name) => {
      const a = find(name);
      if (!a) return '';
      try {
        return a.body ? a.body.toString('utf8') : a.path ? fs.readFileSync(a.path, 'utf8') : '';
      } catch {
        return '';
      }
    };

    return {
      id: entry.id,
      title: entry.title,
      titlePath: entry.titlePath,
      file: entry.file,
      line: entry.line,
      project: entry.project,
      browser: entry.browser,
      tags: entry.tags,
      status,
      knownDefect,
      annotations: annotations.map((a) => ({ type: a.type, description: a.description || '' })),
      duration: last.duration,
      startTime: entry.startTime,
      workerIndex: entry.workerIndex,
      error: last.error,
      steps: [...new Set(flattenSteps(last.result?.steps))].slice(0, 60),
      actions: actionSteps(last.result?.steps),
      failureContext: text('failure-context'),
      attempts: entry.attempts.map((a) => ({ status: a.status, duration: a.duration })),
      retries: entry.attempts.length - 1,
      endpoint,
      httpStatus,
      _attachments: { screenshot: find('screenshot'), video: find('video'), trace: find('trace') },
    };
  }

  _copyAttachments(tests, dashboardDir) {
    let index = 0;
    for (const test of tests) {
      for (const kind of ['screenshot', 'video', 'trace']) {
        const att = test._attachments[kind];
        if (!att?.path) continue;
        const dir = path.join(dashboardDir, 'assets', String(index));
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, path.basename(att.path));
        try {
          fs.copyFileSync(att.path, dest);
          test[kind] = path.relative(dashboardDir, dest).split(path.sep).join('/');
        } catch {
          /* attachment may already be cleaned up; skip the link */
        }
      }
      delete test._attachments;
      index++;
    }
  }

  _clusters(tests) {
    const map = new Map();
    for (const t of tests) {
      if (t.status !== 'failed' && t.status !== 'flaky') continue;
      const key = clusterKey(t.error?.message);
      if (!map.has(key)) map.set(key, { message: key, count: 0, tests: [] });
      const c = map.get(key);
      c.count++;
      c.tests.push(`${t.project}: ${t.title}`);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }

  _readPrevious(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  // History is best-effort: a missing or corrupt file just starts a new one.
  _readHistory(file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.passRate === 'number') : [];
    } catch {
      return [];
    }
  }

  _html(payload) {
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    const css = fs.readFileSync(CSS_PATH, 'utf8');
    const js = fs.readFileSync(JS_PATH, 'utf8');
    const data = JSON.stringify(payload).replace(/</g, '\\u003c');
    return template
      .split('/*__DASHBOARD_CSS__*/')
      .join(css)
      .split('/*__DASHBOARD_DATA__*/')
      .join(data)
      .split('/*__DASHBOARD_JS__*/')
      .join(js);
  }

  printsToStdio() {
    return false;
  }
}
