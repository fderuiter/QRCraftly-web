/**
 * Runs axe-core in unit tests and checks its results, replacing vitest-axe
 * (GitHub issue #1186). axe-core is the same engine @axe-core/playwright runs
 * in the E2E suite. Like vitest-axe, it runs axe's default rule set, so
 * `color-contrast` stays on; jsdom can't compute colours, so axe reports it as
 * incomplete rather than as a violation, and E2E covers contrast.
 */
import axeCore from 'axe-core';
import type { AxeResults, ImpactValue, Result, RunOptions } from 'axe-core';

const MAX_NODES = 5;
const MAX_HTML = 200;

let queue: Promise<unknown> = Promise.resolve();

/**
 * Scans `target` with axe-core. Calls are queued, because axe-core throws when
 * two runs overlap. An element that is not in the document is scanned from a
 * copy placed in `document.body`, which is restored afterwards.
 */
export function axe(target: Element | Document, options: RunOptions = {}): Promise<AxeResults> {
  const run = async (): Promise<AxeResults> => {
    if (target instanceof Element && !target.ownerDocument.contains(target)) {
      const original = document.body.innerHTML;
      document.body.innerHTML = target.outerHTML;
      try {
        return await axeCore.run(document.body, options);
      } finally {
        document.body.innerHTML = original;
      }
    }
    return axeCore.run(target, options);
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

function trim(html: string): string {
  return html.length > MAX_HTML ? `${html.slice(0, MAX_HTML)}…` : html;
}

function describeViolation(violation: Result): string {
  const lines = [`${violation.id} (${violation.impact ?? 'unknown impact'}): ${violation.help}`, `  ${violation.helpUrl}`];
  for (const node of violation.nodes.slice(0, MAX_NODES)) {
    lines.push(`  - ${node.target.join(' ')}`, `    ${trim(node.html)}`);
  }
  if (violation.nodes.length > MAX_NODES) {
    lines.push(`  …and ${violation.nodes.length - MAX_NODES} more`);
  }
  return lines.join('\n');
}

/** Matcher: the axe results have no violations (at the impact levels asked for, if any). */
export function toHaveNoViolations(results: AxeResults) {
  if (!results || !Array.isArray(results.violations)) {
    throw new Error('toHaveNoViolations expects the results of axe()');
  }
  const levels: ImpactValue[] = (results.toolOptions as { impactLevels?: ImpactValue[] }).impactLevels ?? [];
  const violations = levels.length
    ? results.violations.filter(v => v.impact != null && levels.includes(v.impact))
    : results.violations;
  const pass = violations.length === 0;
  return {
    pass,
    actual: violations,
    message: () =>
      pass
        ? 'Expected accessibility violations, but axe found none'
        : `Expected no accessibility violations, but axe found ${violations.length}:\n\n${violations
            .map(describeViolation)
            .join('\n\n')}`,
  };
}

interface AxeMatchers<R = unknown> {
  toHaveNoViolations(): R;
}

declare module 'vitest' {
  // Vitest declares Assertion<T = any>; a merged declaration must match it.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends AxeMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
