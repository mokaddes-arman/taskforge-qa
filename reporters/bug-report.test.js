// Unit tests for the bug report classification and counts shown on the dashboard.
// Run: npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBugReport, bugReportMarkdown } from './bug-report.js';

const base = { file: 'tests/19-accessibility.spec.ts', line: 10, titlePath: ['A11y'], actions: [], annotations: [] };
const run = (over) => ({ ...base, title: 'A11Y-01: Login page', project: 'modules-chrome', status: 'passed', knownDefect: false, ...over });
const knownNote = [{ type: 'fail', description: 'QA-024: login contrast' }];

function payload(tests, extra = {}) {
  return {
    projectName: 'TaskForge QA',
    runDate: '2026-11-18T00:00:00.000Z',
    generatedAt: '2026-11-18T00:00:00.000Z',
    baseURL: 'https://example.test/',
    projects: [...new Set(tests.map((t) => t.project))],
    totals: { total: tests.length, passed: 0, failed: 0, flaky: 0, skipped: 0, knownDefects: 0 },
    tests,
    ...extra,
  };
}

test('a reproduced known defect is listed as a known defect, not a new bug', () => {
  const r = buildBugReport(payload([run({ knownDefect: true, annotations: knownNote })]));
  assert.equal(r.bugs.length, 0);
  assert.equal(r.knownDefects.length, 1);
  assert.equal(r.knownDefects[0].qaId, 'QA-024');
  assert.equal(r.knownDefects[0].state, 'still-reproducing');
});

test('a failure in a project without the known-defect annotation is still a new bug', () => {
  const r = buildBugReport(
    payload([
      run({ knownDefect: true, annotations: knownNote }),
      run({ project: 'modules-firefox', status: 'failed', error: { message: 'boom', full: 'boom' } }),
    ]),
  );
  assert.equal(r.knownDefects.length, 1, 'known defect kept');
  assert.equal(r.bugs.length, 1, 'real failure not hidden');
  assert.deepEqual(r.bugs[0].projects, ['modules-firefox']);
});

test('an expected failure that passed is flagged possibly fixed', () => {
  const r = buildBugReport(payload([run({ knownDefect: true, annotations: knownNote, status: 'failed' })]));
  assert.equal(r.bugs.length, 0);
  assert.equal(r.knownDefects[0].state, 'possibly-fixed');
});

test('the markdown marks a partial run and reports known-defect expected failures', () => {
  const p = payload([run({ knownDefect: true, annotations: knownNote })], {
    partialRun: true,
    projectsRun: 1,
    configuredProjects: ['auth-chrome', 'modules-chrome', 'roles-chrome'],
  });
  p.totals = { total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, knownDefects: 1 };
  p.bugReport = buildBugReport(p);
  const md = bugReportMarkdown(p);
  assert.match(md, /PARTIAL RUN: 1 of 3 configured projects/);
  assert.match(md, /incl\. 1 known-defect expected failures/);
  assert.match(md, /## Known defects \(1\)/);
});

test('a full run has no partial-run note', () => {
  const p = payload([run({})], { partialRun: false, projectsRun: 1, configuredProjects: ['modules-chrome'] });
  p.bugReport = buildBugReport(p);
  assert.doesNotMatch(bugReportMarkdown(p), /PARTIAL RUN/);
});
