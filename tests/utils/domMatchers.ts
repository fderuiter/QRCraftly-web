/*
    QRCraftly
    Copyright (C) 2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

/**
 * Our own DOM matchers (#1188). They replace `@testing-library/jest-dom` and keep
 * its documented semantics for the fifteen matchers this repository uses. Register
 * them with `expect.extend(domMatchers)`; `vitest.setup.ts` does that for the jsdom
 * project.
 */
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api';
import type { MatcherState } from 'vitest';

/** The matchers' public signatures, mirrored from jest-dom's documentation. */
export interface DomMatchers<R = unknown> {
  toBeInTheDocument(): R;
  toBeVisible(): R;
  toBeEmptyDOMElement(): R;
  toBeDisabled(): R;
  toBeEnabled(): R;
  toBeChecked(): R;
  toHaveFocus(): R;
  toContainElement(element: Element | null): R;
  toHaveAttribute(name: string, value?: unknown): R;
  toHaveClass(...classNames: Array<string | RegExp>): R;
  toHaveClass(classNames: string, options?: { exact: boolean }): R;
  toHaveStyle(css: string | Record<string, unknown>): R;
  toHaveTextContent(text: string | RegExp, options?: { normalizeWhitespace: boolean }): R;
  toHaveValue(value?: string | string[] | number | null): R;
  toHaveAccessibleName(name?: unknown): R;
  toHaveAccessibleDescription(description?: unknown): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Matchers<T> extends DomMatchers<T> {}
}

interface Result {
  pass: boolean;
  message: () => string;
}
type Received = HTMLElement | SVGElement;

const MAX_PRINT = 3000;
const COMMENT_NODE = 8;

function hint(state: MatcherState, name: string, expected = ''): string {
  return state.utils.matcherHint(`${state.isNot ? '.not' : ''}.${name}`, 'element', expected);
}

/** Pretty-prints an element and trims the output so a big tree stays readable. */
function printElement(state: MatcherState, node: Node | null, deep = true): string {
  if (node === null) return state.utils.RECEIVED_COLOR('null');
  const text = state.utils.stringify(node.cloneNode(deep));
  const trimmed = text.length > MAX_PRINT ? `${text.slice(0, MAX_PRINT)}\n  ...` : text;
  return state.utils.RECEIVED_COLOR(trimmed);
}

function indent(text: string): string {
  return text
    .split(/\r?\n/)
    .map(line => `  ${line}`)
    .join('\n');
}

function show(state: MatcherState, value: unknown): string {
  return typeof value === 'string' ? value : state.utils.stringify(value);
}

/** Builds the standard message: hint, expected value, received value and the element. */
function report(
  state: MatcherState,
  matcherHint: string,
  expectedLabel: string,
  expected: unknown,
  received: unknown,
  element: Node,
): string {
  return [
    `${matcherHint}\n`,
    `${expectedLabel}:\n${state.utils.EXPECTED_COLOR(indent(show(state, expected)))}`,
    `Received:\n${state.utils.RECEIVED_COLOR(indent(show(state, received)))}`,
    `\nElement:\n${indent(printElement(state, element))}`,
  ].join('\n');
}

function viewOf(node: unknown): (Window & typeof globalThis) | null {
  if (typeof node !== 'object' || node === null || !('ownerDocument' in node)) return null;
  const doc = (node as Node).ownerDocument;
  return doc?.defaultView ?? null;
}

function typeError(state: MatcherState, name: string, received: unknown, what: string): Error {
  let withType = '';
  try {
    withType = state.utils.printWithType('Received', received, state.utils.printReceived);
  } catch {
    // printWithType can throw for a Document.
  }
  return new Error([hint(state, name), '', `received value must ${what}.`, withType].join('\n'));
}

function assertElement(state: MatcherState, name: string, received: unknown): asserts received is Received {
  const view = viewOf(received);
  if (!view || !(received instanceof view.HTMLElement || received instanceof view.SVGElement)) {
    throw typeError(state, name, received, 'be an HTMLElement or an SVGElement');
  }
}

function assertNode(state: MatcherState, name: string, received: unknown): asserts received is Node {
  const view = viewOf(received);
  if (!view || !(received instanceof view.Node)) throw typeError(state, name, received, 'be a Node');
}

function tagOf(element: Element): string {
  return element.tagName.toLowerCase();
}

function isInDocument(element: Node): boolean {
  return element.ownerDocument === element.getRootNode({ composed: true });
}

/** A simple state matcher: the element passes or not, and the message shows it. */
function stateResult(state: MatcherState, name: string, pass: boolean, word: string, element: Element): Result {
  return {
    pass,
    message: () =>
      [hint(state, name), '', `Received element ${pass ? 'is' : 'is not'} ${word}:`, indent(printElement(state, element, false))].join(
        '\n',
      ),
  };
}

// ---------------------------------------------------------------------------
// Disabled state: form controls, custom elements and <fieldset disabled>.
// ---------------------------------------------------------------------------

const DISABLEABLE_TAGS = ['fieldset', 'input', 'select', 'optgroup', 'option', 'button', 'textarea'];

function canBeDisabled(element: Element): boolean {
  const tag = tagOf(element);
  return DISABLEABLE_TAGS.includes(tag) || tag.includes('-');
}

function isOwnDisabled(element: Element): boolean {
  return canBeDisabled(element) && element.hasAttribute('disabled');
}

/** The first <legend> of a disabled <fieldset> stays enabled (HTML "fieldset disabled"). */
function isFirstLegend(element: Element, parent: Element): boolean {
  return (
    tagOf(element) === 'legend' &&
    tagOf(parent) === 'fieldset' &&
    Array.from(parent.children).find(child => tagOf(child) === 'legend') === element
  );
}

function isAncestorDisabled(element: Element): boolean {
  const parent = element.parentElement;
  if (!parent) return false;
  return (isOwnDisabled(parent) && !isFirstLegend(element, parent)) || isAncestorDisabled(parent);
}

function isDisabled(element: Element): boolean {
  return canBeDisabled(element) && (isOwnDisabled(element) || isAncestorDisabled(element));
}

// ---------------------------------------------------------------------------
// Visibility: computed style, `hidden` and closed <details>, up the ancestor chain.
// ---------------------------------------------------------------------------

function isStyleVisible(element: Element, view: Window): boolean {
  const { display, visibility, opacity } = view.getComputedStyle(element);
  return display !== 'none' && visibility !== 'hidden' && visibility !== 'collapse' && opacity !== '0';
}

function isElementVisible(element: Element, view: Window, child?: Element): boolean {
  // A closed <details> still shows its <summary>.
  const detailsOpen = element.nodeName !== 'DETAILS' || child?.nodeName === 'SUMMARY' || element.hasAttribute('open');
  const parent = element.parentElement;
  return (
    isStyleVisible(element, view) &&
    !element.hasAttribute('hidden') &&
    detailsOpen &&
    (!parent || isElementVisible(parent, view, element))
  );
}

// ---------------------------------------------------------------------------
// Values: inputs, selects, textareas and ARIA value roles.
// ---------------------------------------------------------------------------

const VALUE_ROLES = ['meter', 'progressbar', 'slider', 'spinbutton'];

function elementValue(element: Element): unknown {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'number') return element.value === '' ? null : Number(element.value);
    return element.value;
  }
  if (element instanceof HTMLSelectElement) {
    const selected = Array.from(element.options)
      .filter(option => option.selected)
      .map(option => option.value);
    return element.multiple ? selected : selected[0];
  }
  if ('value' in element && element.value !== undefined && element.value !== null) return element.value;
  const role = element.getAttribute('role');
  return role !== null && VALUE_ROLES.includes(role) ? Number(element.getAttribute('aria-valuenow')) : undefined;
}

function sameValue(received: unknown, expected: unknown): boolean {
  if (Array.isArray(received) && Array.isArray(expected)) {
    const have = new Set(received);
    return [...new Set(expected)].every(value => have.has(value)) && [...new Set(received)].every(value => expected.includes(value));
  }
  return received === expected;
}

// ---------------------------------------------------------------------------
// Styles: CSS strings or objects, normalised through a scratch element.
// ---------------------------------------------------------------------------

function parseCss(css: string): Record<string, string> {
  const declarations: Record<string, string> = {};
  let depth = 0;
  let quote = '';
  let current = '';
  const parts: string[] = [];
  for (const char of css) {
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    } else if (char === ';' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  for (const part of parts) {
    if (part.trim() === '') continue;
    const colon = part.indexOf(':');
    if (colon <= 0 || part.slice(colon + 1).trim() === '') {
      throw new Error(`Syntax error parsing expected css: missing property or value in "${part.trim()}"`);
    }
    declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
  }
  return declarations;
}

function kebab(property: string): string {
  return property.startsWith('--') ? property : property.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

// ---------------------------------------------------------------------------
// The matchers.
// ---------------------------------------------------------------------------

function toBeInTheDocument(this: MatcherState, element: unknown): Result {
  if (element !== null || !this.isNot) assertElement(this, 'toBeInTheDocument', element);
  const pass = element !== null && isInDocument(element);
  return {
    pass,
    message: () =>
      [
        hint(this, 'toBeInTheDocument'),
        '',
        this.isNot
          ? `expected document not to contain element, found:\n${indent(printElement(this, element))}`
          : this.utils.RECEIVED_COLOR('element could not be found in the document'),
      ].join('\n'),
  };
}

function toBeVisible(this: MatcherState, element: unknown): Result {
  assertElement(this, 'toBeVisible', element);
  const attached = isInDocument(element);
  const view = viewOf(element);
  const pass = attached && view !== null && isElementVisible(element, view);
  return stateResult(this, 'toBeVisible', pass, `visible${attached ? '' : ' (element is not in the document)'}`, element);
}

function toBeEmptyDOMElement(this: MatcherState, element: unknown): Result {
  assertElement(this, 'toBeEmptyDOMElement', element);
  const pass = Array.from(element.childNodes).every(node => node.nodeType === COMMENT_NODE);
  return {
    pass,
    message: () => [hint(this, 'toBeEmptyDOMElement'), '', 'Received:', `  ${this.utils.printReceived(element.innerHTML)}`].join('\n'),
  };
}

function toBeDisabled(this: MatcherState, element: unknown): Result {
  assertElement(this, 'toBeDisabled', element);
  return stateResult(this, 'toBeDisabled', isDisabled(element), 'disabled', element);
}

function toBeEnabled(this: MatcherState, element: unknown): Result {
  assertElement(this, 'toBeEnabled', element);
  return stateResult(this, 'toBeEnabled', !isDisabled(element), 'enabled', element);
}

const CHECKED_ROLES = ['checkbox', 'menuitemcheckbox', 'menuitemradio', 'option', 'radio', 'switch', 'treeitem'];

function toBeChecked(this: MatcherState, element: unknown): Result {
  assertElement(this, 'toBeChecked', element);
  const isInput = element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio');
  const role = element.getAttribute('role');
  const ariaChecked = element.getAttribute('aria-checked');
  const isAria = role !== null && CHECKED_ROLES.includes(role) && (ariaChecked === 'true' || ariaChecked === 'false');
  if (!isInput && !isAria) {
    return {
      pass: false,
      message: () =>
        `only inputs with type="checkbox" or type="radio" or elements with role ${CHECKED_ROLES.join(', ')} and a valid aria-checked attribute can be used with .toBeChecked(). Use .toHaveValue() instead`,
    };
  }
  const pass = isInput ? element.checked : ariaChecked === 'true';
  return stateResult(this, 'toBeChecked', pass, 'checked', element);
}

function toHaveFocus(this: MatcherState, element: unknown): Result {
  assertElement(this, 'toHaveFocus', element);
  const active = element.ownerDocument.activeElement;
  return {
    pass: active === element,
    message: () =>
      [
        hint(this, 'toHaveFocus'),
        '',
        ...(this.isNot
          ? ['Received element is focused:', indent(printElement(this, element, false))]
          : [
              'Expected element with focus:',
              indent(printElement(this, element, false)),
              'Received element with focus:',
              indent(printElement(this, active, false)),
            ]),
      ].join('\n'),
  };
}

function toContainElement(this: MatcherState, container: unknown, element: unknown): Result {
  assertElement(this, 'toContainElement', container);
  if (element !== null) assertElement(this, 'toContainElement', element);
  return {
    pass: container.contains(element),
    message: () =>
      [
        this.utils.matcherHint(`${this.isNot ? '.not' : ''}.toContainElement`, 'element', 'element'),
        '',
        `${printElement(this, container, false)} ${this.isNot ? 'contains:' : 'does not contain:'} ${printElement(this, element, false)}`,
      ].join('\n'),
  };
}

function toHaveAttribute(this: MatcherState, element: unknown, name: string, ...rest: [value?: unknown]): Result {
  assertElement(this, 'toHaveAttribute', element);
  const expected = rest[0];
  const expectsValue = expected !== undefined;
  const has = element.hasAttribute(name);
  const value = element.getAttribute(name);
  const describe = (v: unknown) => (v === undefined ? name : `${name}=${this.utils.stringify(v)}`);
  return {
    pass: expectsValue ? has && this.equals(value, expected) : has,
    message: () =>
      report(
        this,
        hint(this, 'toHaveAttribute', this.utils.printExpected(name)),
        `Expected the element ${this.isNot ? 'not to' : 'to'} have attribute`,
        describe(expected),
        has ? describe(value) : null,
        element,
      ),
  };
}

function splitClasses(value: string | null | undefined): string[] {
  return value ? value.split(/\s+/).filter(name => name.length > 0) : [];
}

function toHaveClass(this: MatcherState, element: unknown, ...params: unknown[]): Result {
  assertElement(this, 'toHaveClass', element);
  const last = params[params.length - 1];
  const hasOptions = typeof last === 'object' && last !== null && !(last instanceof RegExp);
  const exact = hasOptions && 'exact' in last && Boolean(last.exact);
  const names = hasOptions ? params.slice(0, -1) : params;
  const expected: Array<string | RegExp> = names.flatMap((name): Array<string | RegExp> =>
    name instanceof RegExp ? [name] : splitClasses(typeof name === 'string' ? name : undefined),
  );
  if (exact && expected.some(name => name instanceof RegExp)) {
    throw new Error('Exact option does not support RegExp expected class names');
  }
  const received = splitClasses(element.getAttribute('class'));
  const subset = expected.every(name =>
    typeof name === 'string' ? received.includes(name) : received.some(className => name.test(className)),
  );
  const shown = expected.map(String).join(' ');
  if (expected.length === 0 && !exact) {
    return {
      pass: this.isNot ? received.length > 0 : false,
      message: () =>
        this.isNot
          ? report(this, hint(this, 'toHaveClass'), 'Expected the element to have classes', '(none)', received.join(' '), element)
          : [hint(this, 'toHaveClass'), 'At least one expected class must be provided.'].join('\n'),
    };
  }
  return {
    pass: exact ? subset && expected.length === received.length : subset,
    message: () =>
      report(
        this,
        hint(this, 'toHaveClass', this.utils.printExpected(shown)),
        `Expected the element ${this.isNot ? 'not to' : 'to'} have ${exact ? 'EXACTLY defined classes' : 'class'}`,
        shown,
        received.join(' '),
        element,
      ),
  };
}

function toHaveStyle(this: MatcherState, element: unknown, css: string | Record<string, unknown>): Result {
  assertElement(this, 'toHaveStyle', element);
  const declared = typeof css === 'object' && css !== null ? css : parseCss(String(css));
  const scratch = element.ownerDocument.createElement('div');
  const expected: Record<string, string> = {};
  for (const [property, value] of Object.entries(declared)) {
    const name = kebab(property);
    scratch.style.setProperty(name, String(value));
    expected[name] = scratch.style.getPropertyValue(name);
  }
  const computed = element.ownerDocument.defaultView?.getComputedStyle(element);
  const received: Record<string, string> = {};
  for (const name of Object.keys(expected)) received[name] = computed?.getPropertyValue(name) ?? '';
  const print = (styles: Record<string, string>) =>
    Object.keys(styles)
      .sort()
      .map(name => `${name}: ${styles[name]};`)
      .join('\n');
  const entries = Object.keys(expected);
  return {
    pass: entries.length > 0 && entries.every(name => received[name] === expected[name]),
    message: () => report(this, hint(this, 'toHaveStyle'), 'Expected styles', print(expected), print(received), element),
  };
}

function toHaveTextContent(
  this: MatcherState,
  node: unknown,
  checkWith: string | RegExp,
  options: { normalizeWhitespace: boolean } = { normalizeWhitespace: true },
): Result {
  assertNode(this, 'toHaveTextContent', node);
  const raw = node.textContent ?? '';
  const text = options.normalizeWhitespace ? raw.replace(/\s+/g, ' ').trim() : raw.replace(/\u00a0/g, ' ');
  const emptyCheck = text !== '' && checkWith === '';
  const matches = checkWith instanceof RegExp ? checkWith.test(text) : text.includes(String(checkWith));
  return {
    pass: !emptyCheck && matches,
    message: () =>
      report(
        this,
        hint(this, 'toHaveTextContent'),
        emptyCheck
          ? 'Checking with empty string will always match, use .toBeEmptyDOMElement() instead'
          : `Expected element ${this.isNot ? 'not to' : 'to'} have text content`,
        checkWith,
        text,
        node,
      ),
  };
}

function toHaveValue(this: MatcherState, element: unknown, ...rest: [value?: unknown]): Result {
  assertElement(this, 'toHaveValue', element);
  if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
    throw new Error(
      'input with type=checkbox or type=radio cannot be used with .toHaveValue(). Use .toBeChecked() for type=checkbox instead',
    );
  }
  const expected = rest[0];
  const received = elementValue(element);
  const expectsValue = expected !== undefined;
  // Show the types when only they differ, e.g. 5 (number) against "5" (string).
  const typed = (value: unknown) =>
    expected !== received && String(expected) === String(received) ? `${String(value)} (${typeof value})` : value;
  return {
    pass: expectsValue ? sameValue(received, expected) : Boolean(received),
    message: () =>
      report(
        this,
        hint(this, 'toHaveValue'),
        `Expected the element ${this.isNot ? 'not to' : 'to'} have value`,
        expectsValue ? typed(expected) : '(any)',
        typed(received),
        element,
      ),
  };
}

function accessibleText(
  state: MatcherState,
  name: 'toHaveAccessibleName' | 'toHaveAccessibleDescription',
  element: unknown,
  rest: [value?: unknown],
): Result {
  assertElement(state, name, element);
  const actual = name === 'toHaveAccessibleName' ? computeAccessibleName(element) : computeAccessibleDescription(element);
  const label = name === 'toHaveAccessibleName' ? 'accessible name' : 'accessible description';
  const expected = rest[0];
  let pass: boolean;
  if (rest.length === 0) pass = actual !== '';
  else pass = expected instanceof RegExp ? expected.test(actual) : state.equals(actual, expected);
  return {
    pass,
    message: () =>
      report(state, hint(state, name), `Expected element ${state.isNot ? 'not to' : 'to'} have ${label}`, expected, actual, element),
  };
}

function toHaveAccessibleName(this: MatcherState, element: unknown, ...rest: [value?: unknown]): Result {
  return accessibleText(this, 'toHaveAccessibleName', element, rest);
}

function toHaveAccessibleDescription(this: MatcherState, element: unknown, ...rest: [value?: unknown]): Result {
  return accessibleText(this, 'toHaveAccessibleDescription', element, rest);
}

/** Pass to `expect.extend`. */
export const domMatchers = {
  toBeInTheDocument,
  toBeVisible,
  toBeEmptyDOMElement,
  toBeDisabled,
  toBeEnabled,
  toBeChecked,
  toHaveFocus,
  toContainElement,
  toHaveAttribute,
  toHaveClass,
  toHaveStyle,
  toHaveTextContent,
  toHaveValue,
  toHaveAccessibleName,
  toHaveAccessibleDescription,
};
