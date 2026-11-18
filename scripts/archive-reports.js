// Snapshots the latest run's reports so the next run cannot overwrite them.
//
//   npm run report:archive -- <label>
//
// Copies dashboard-report/ (dashboard, bug report, screenshots/videos/traces of
// failures, history) and playwright-report/ (Playwright HTML report with
// traces) into qa/report-history/<run date>_<label>/. The live report folders
// are left untouched, so `npm run report` / `npm run dashboard` keep working.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const label = (process.argv[2] || 'run').replace(/[^\w.-]+/g, '-');
const lastRun = path.join(root, 'dashboard-report', 'last-run.json');

if (!fs.existsSync(lastRun)) {
  console.error('No dashboard-report/last-run.json found; run the tests first.');
  process.exit(1);
}

const { runDate, totals } = JSON.parse(fs.readFileSync(lastRun, 'utf8'));
const stamp = new Date(runDate).toISOString().slice(0, 16).replace(/:/g, '-');
const target = path.join(root, 'qa', 'report-history', `${stamp}_${label}`);

if (fs.existsSync(target)) {
  console.error(`Refusing to overwrite existing archive: ${path.relative(root, target)}`);
  process.exit(1);
}

fs.mkdirSync(target, { recursive: true });
for (const dir of ['dashboard-report', 'playwright-report']) {
  const source = path.join(root, dir);
  if (fs.existsSync(source)) fs.cpSync(source, path.join(target, dir), { recursive: true });
}

console.log(
  `Archived ${totals.total} tests (${totals.passed} passed, ${totals.failed} failed, ` +
    `${totals.skipped} skipped) -> ${path.relative(root, target)}`,
);
