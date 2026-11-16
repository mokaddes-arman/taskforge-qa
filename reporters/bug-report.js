/**
 * Turns one Playwright run into a developer bug report.
 *
 * - bugs:          failed/flaky tests, one entry per test (all browsers merged)
 * - knownDefects:  tests marked test.fail('QA-xxx ...') - still reproducing, or
 *                  flagged "possibly fixed" when the expected failure passed
 * - notVerified:   skipped tests and the precondition that skipped them
 *
 * The same object feeds the dashboard "Bug report" tab and bug-report.md.
 */

const AUTH_FILE = /00-auth\.spec\.ts$/;
const SECURITY_FILE = /security/i;
const QA_ID = /\b(QA-\d{3,})\b/;

function moduleName(test) {
  const describe = test.titlePath?.[0];
  if (describe) return describe.replace(/\s*\(Module \d+\)\s*$/, '');
  const base = test.file.split('/').pop().replace(/\.spec\.ts$/, '').replace(/^\d+-/, '');
  return base.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function headline(error) {
  return String(error?.message || 'Test failed without an error message')
    .replace(/^Error:\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pulls Locator/Expected/Received lines out of a Playwright assertion error. */
function expectedActual(error) {
  const lines = String(error?.full || '').split('\n').map((l) => l.trim());
  const pick = (re) => lines.filter((l) => re.test(l));
  return {
    locator: pick(/^Locator:/)[0]?.replace(/^Locator:\s*/, '') || '',
    expected: pick(/^Expected(?: [a-z]+)?:/).join('\n'),
    received: pick(/^Received(?: [a-z]+)?:/).join('\n'),
    timeout: pick(/^Timeout:|Timeout \d+ms exceeded/)[0] || '',
  };
}

function cleanSteps(actions) {
  const out = [];
  for (const step of actions || []) {
    const prev = out[out.length - 1];
    if (prev && prev.title === step.title) {
      prev.failed = prev.failed || step.failed;
      continue;
    }
    out.push({ ...step });
  }
  // Keep the run-up to the failure; long read-only tests can have 100+ actions.
  const failAt = out.findIndex((s) => s.failed);
  const end = failAt >= 0 ? failAt + 1 : out.length;
  return { steps: out.slice(Math.max(0, end - 25), end), truncated: end > 25 };
}

function suggestSeverity(test, projects, status) {
  if (status === 'flaky') return { level: 'Low', why: 'Passed on retry (intermittent)' };
  if (AUTH_FILE.test(test.file)) return { level: 'High', why: 'Authentication flow' };
  if (SECURITY_FILE.test(test.file)) return { level: 'High', why: 'Security / cross-cutting edge case' };
  if (projects.length > 1) return { level: 'High', why: `Reproduces in ${projects.length} browsers` };
  return { level: 'Medium', why: 'Single browser / single flow' };
}

function evidence(test) {
  return {
    project: test.project,
    screenshot: test.screenshot || '',
    video: test.video || '',
    trace: test.trace || '',
    reportUrl: test.reportUrl || '',
  };
}

function rerun(test, projects) {
  const flags = projects.map((p) => `--project=${p}`).join(' ');
  return `npx playwright test ${test.file}:${test.line} ${flags}`.trim();
}

export function buildBugReport(payload) {
  const groups = new Map();
  for (const t of payload.tests) {
    const key = `${t.file}::${(t.titlePath || []).join(' > ')}::${t.title}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const bugs = [];
  const knownDefects = [];
  const notVerified = [];

  for (const runs of groups.values()) {
    const first = runs[0];
    const module = moduleName(first);

    const broken = runs.filter((t) => t.status === 'failed' || t.status === 'flaky');
    const known = runs.filter((t) => t.knownDefect);
    const skipped = runs.filter((t) => t.status === 'skipped');

    if (known.length) {
      const note =
        known.flatMap((t) => t.annotations).find((a) => a.type === 'fail')?.description || '';
      const fixed = known.filter((t) => t.status === 'failed');
      knownDefects.push({
        module,
        title: first.title,
        file: first.file,
        line: first.line,
        qaId: note.match(QA_ID)?.[1] || '',
        note,
        projects: known.map((t) => t.project),
        state: fixed.length ? 'possibly-fixed' : 'still-reproducing',
        stateDetail: fixed.length
          ? `Expected failure PASSED in ${fixed.map((t) => t.project).join(', ')} - verify the fix, then remove test.fail()`
          : 'Defect still reproduces',
      });
      // A known defect whose expectation flipped is a verification task, not a new bug.
      continue;
    }

    if (skipped.length && !broken.length) {
      const reason =
        skipped.flatMap((t) => t.annotations).find((a) => a.type === 'skip')?.description || 'Skipped';
      notVerified.push({
        module,
        title: first.title,
        file: first.file,
        line: first.line,
        reason,
        projects: skipped.map((t) => t.project),
      });
    }

    if (!broken.length) continue;

    const primary = broken.find((t) => t.status === 'failed') || broken[0];
    const status = broken.some((t) => t.status === 'failed') ? 'failed' : 'flaky';
    const projects = broken.map((t) => t.project);
    const passedIn = runs.filter((t) => t.status === 'passed').map((t) => t.project);
    const severity = suggestSeverity(primary, projects, status);
    const { steps, truncated } = cleanSteps(primary.actions);
    const ea = expectedActual(primary.error);

    bugs.push({
      module,
      title: `${module}: ${primary.title}`,
      summary: headline(primary.error),
      status,
      severity: severity.level,
      severityReason: severity.why,
      file: primary.file,
      line: primary.line,
      scenario: [...(primary.titlePath || []), primary.title].join(' > '),
      projects,
      passedIn,
      preconditions: AUTH_FILE.test(primary.file)
        ? 'Signed out; valid owner credentials available.'
        : `Signed in as the workspace Owner (saved session from auth.setup) on ${payload.baseURL || 'the target environment'}.`,
      steps,
      stepsTruncated: truncated,
      expected: ea.expected,
      actual: ea.received || headline(primary.error),
      locator: ea.locator,
      timeout: ea.timeout,
      error: primary.error?.full || primary.error?.stack || '',
      snippet: primary.error?.snippet || '',
      failureContext: primary.failureContext || '',
      evidence: broken.map(evidence),
      rerun: rerun(primary, projects),
      retries: primary.retries,
    });
  }

  const order = { High: 0, Medium: 1, Low: 2 };
  bugs.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);
  bugs.forEach((b, i) => (b.id = `BUG-${String(i + 1).padStart(3, '0')}`));
  knownDefects.sort((a, b) => (a.state === b.state ? a.qaId.localeCompare(b.qaId) : a.state === 'possibly-fixed' ? -1 : 1));

  return {
    generatedAt: payload.generatedAt,
    environment: {
      baseURL: payload.baseURL,
      projects: payload.projects.filter((p) => p !== 'setup'),
      branch: payload.branch,
      commit: payload.commit,
      runner: payload.env,
      os: payload.os,
      node: payload.node,
      playwright: payload.playwrightVersion,
      workers: payload.workers,
    },
    totals: payload.totals,
    bugs,
    knownDefects,
    notVerified,
  };
}

const fence = (s) => '```\n' + String(s).replace(/```/g, "'''").trim() + '\n```';
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function bugReportMarkdown(payload) {
  const r = payload.bugReport;
  const e = r.environment;
  const t = r.totals;
  const out = [];

  out.push(`# ${payload.projectName} - Bug report`);
  out.push('');
  out.push(`Generated ${payload.runDate} from an automated Playwright run.`);
  out.push('');
  out.push('## Environment');
  out.push('');
  out.push('| Item | Value |');
  out.push('| --- | --- |');
  out.push(`| Application | ${cell(e.baseURL || 'n/a')} |`);
  out.push(`| Browsers / projects | ${cell(e.projects.join(', '))} |`);
  out.push(`| Suite revision | ${cell([e.branch, e.commit].filter(Boolean).join(' @ ') || 'n/a')} |`);
  out.push(`| Runner | ${cell(`${e.runner} · ${e.os} · Node ${e.node} · Playwright ${e.playwright} · ${e.workers} worker(s)`)} |`);
  out.push(
    `| Result | ${t.total} tests: ${t.passed} passed, ${t.failed} failed, ${t.flaky} flaky, ${t.skipped} skipped |`
  );
  out.push('');

  out.push(`## New bugs (${r.bugs.length})`);
  out.push('');
  if (!r.bugs.length) {
    out.push('No new failures in this run.');
    out.push('');
  } else {
    out.push('| ID | Severity (suggested) | Module | Summary | Browsers |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const b of r.bugs) {
      out.push(`| ${b.id} | ${b.severity} | ${cell(b.module)} | ${cell(b.summary.slice(0, 120))} | ${cell(b.projects.join(', '))} |`);
    }
    out.push('');
    for (const b of r.bugs) {
      out.push(`### ${b.id} - ${b.title}`);
      out.push('');
      out.push(`- **Status:** ${b.status}${b.retries ? ` (after ${b.retries} retr${b.retries === 1 ? 'y' : 'ies'})` : ''}`);
      out.push(`- **Suggested severity:** ${b.severity} - ${b.severityReason}`);
      out.push(`- **Fails in:** ${b.projects.join(', ')}${b.passedIn.length ? ` · **passes in:** ${b.passedIn.join(', ')}` : ''}`);
      out.push(`- **Test:** \`${b.file}:${b.line}\` - ${b.scenario}`);
      out.push('');
      out.push(`**Preconditions:** ${b.preconditions}`);
      out.push('');
      out.push('**Steps to reproduce**');
      out.push('');
      if (b.steps.length) {
        if (b.stepsTruncated) out.push('_(earlier steps omitted)_');
        b.steps.forEach((s, i) => out.push(`${i + 1}. ${s.title}${s.failed ? '  **<- fails here**' : ''}`));
      } else {
        out.push(`1. Run \`${b.rerun}\``);
      }
      out.push('');
      out.push(`**Expected:** ${b.expected ? '\n\n' + fence(b.expected) : 'See the assertion in the test.'}`);
      out.push('');
      out.push(`**Actual:** ${b.actual.includes('\n') || b.actual.length > 100 ? '\n\n' + fence(b.actual) : b.actual}`);
      out.push('');
      if (b.locator) out.push(`**Element:** \`${b.locator}\``), out.push('');
      if (b.failureContext) {
        out.push('**Page state at failure**');
        out.push('');
        out.push(fence(b.failureContext));
        out.push('');
      }
      out.push('<details><summary>Error details</summary>');
      out.push('');
      out.push(fence(b.error.slice(0, 4000)));
      out.push('');
      out.push('</details>');
      out.push('');
      const ev = b.evidence
        .map((x) =>
          [
            x.screenshot && `[screenshot](${x.screenshot})`,
            x.video && `[video](${x.video})`,
            x.trace && `[trace](${x.trace})`,
          ]
            .filter(Boolean)
            .join(' · ')
            .replace(/^/, `${x.project}: `)
        )
        .join('  \n');
      out.push(`**Evidence:**  \n${ev}`);
      out.push('');
      out.push(`**Re-run:** \`${b.rerun}\``);
      out.push('');
    }
  }

  out.push(`## Known defects (${r.knownDefects.length})`);
  out.push('');
  if (!r.knownDefects.length) {
    out.push('No tests are marked as expected failures.');
  } else {
    out.push('Tests marked `test.fail()` with a QA finding ID. They keep the defect visible without failing the run.');
    out.push('');
    out.push('| QA ID | Module | State | Detail | Test |');
    out.push('| --- | --- | --- | --- | --- |');
    for (const k of r.knownDefects) {
      out.push(
        `| ${cell(k.qaId || '-')} | ${cell(k.module)} | ${k.state === 'possibly-fixed' ? '**Possibly fixed**' : 'Still reproducing'} | ${cell(k.note)} | \`${k.file}:${k.line}\` |`
      );
    }
  }
  out.push('');

  out.push(`## Not verified in this run (${r.notVerified.length})`);
  out.push('');
  if (!r.notVerified.length) {
    out.push('Every scenario executed.');
  } else {
    out.push('Skipped because live data did not meet the precondition. These are not failures.');
    out.push('');
    out.push('| Module | Scenario | Reason |');
    out.push('| --- | --- | --- |');
    for (const n of r.notVerified) out.push(`| ${cell(n.module)} | ${cell(n.title)} | ${cell(n.reason)} |`);
  }
  out.push('');
  out.push('_Evidence links are relative to `dashboard-report/`. Open traces with `npx playwright show-trace <file>`._');
  out.push('');
  return out.join('\n');
}
