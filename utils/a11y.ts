import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

/** WCAG 2.0/2.1 level A and AA rule tags (the agreed target, A11Y-01). */
export const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export interface AxeFinding {
  rule: string;
  impact: string;
  nodes: number;
  help: string;
  sample: string;
}

/**
 * Runs axe-core against the current page, attaches the full result as JSON
 * evidence and returns a compact list of violations.
 */
export async function scanAccessibility(page: Page, testInfo: TestInfo, label: string): Promise<AxeFinding[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();

  await testInfo.attach(`axe-${label.replace(/\W+/g, '-').toLowerCase()}.json`, {
    body: JSON.stringify({ url: results.url, violations: results.violations, incomplete: results.incomplete.length, passes: results.passes.length }, null, 2),
    contentType: 'application/json',
  });

  return results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact ?? 'unknown',
    nodes: violation.nodes.length,
    help: violation.help,
    sample: violation.nodes[0]?.target.join(' ') ?? '',
  }));
}

export function seriousOrCritical(findings: AxeFinding[]): string[] {
  return findings
    .filter((finding) => finding.impact === 'serious' || finding.impact === 'critical')
    .map((finding) => `${finding.rule} (${finding.impact}, ${finding.nodes} node${finding.nodes === 1 ? '' : 's'}): ${finding.help} — e.g. ${finding.sample}`);
}
