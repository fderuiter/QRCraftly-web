// @vitest-environment jsdom
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
import { afterEach, describe, expect, it } from 'vitest';
import { domMatchers } from './domMatchers';

expect.extend(domMatchers);

function render(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function byId<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing #${id}`);
  return element as unknown as T;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('toBeInTheDocument', () => {
  it('passes for attached elements and fails for detached ones and null', () => {
    render('<span id="a">a</span>');
    expect(byId('a')).toBeInTheDocument();
    expect(document.createElement('div')).not.toBeInTheDocument();
    expect(null).not.toBeInTheDocument();
    expect(() => expect(null).toBeInTheDocument()).toThrow(/HTMLElement or an SVGElement/);
    expect(() => expect(document.createElement('p')).toBeInTheDocument()).toThrow(/could not be found/);
  });

  it('shows the element when .not fails', () => {
    render('<b id="b">bold</b>');
    expect(() => expect(byId('b')).not.toBeInTheDocument()).toThrow(/bold/);
  });
});

describe('toHaveAttribute', () => {
  it('checks presence, value, regexes via asymmetric matchers and .not', () => {
    render('<a id="l" href="/x" data-empty="">x</a>');
    const link = byId('l');
    expect(link).toHaveAttribute('href');
    expect(link).toHaveAttribute('href', '/x');
    expect(link).toHaveAttribute('data-empty', '');
    expect(link).toHaveAttribute('href', expect.stringContaining('x'));
    expect(link).not.toHaveAttribute('title');
    expect(link).not.toHaveAttribute('href', '/y');
    expect(() => expect(link).toHaveAttribute('href', '/y')).toThrow(/href="\/x"/);
  });
});

describe('toHaveTextContent', () => {
  it('normalises whitespace by default and matches substrings and regexes', () => {
    render('<p id="p">  Hello\n\t   world  </p>');
    const p = byId('p');
    expect(p).toHaveTextContent('Hello world');
    expect(p).toHaveTextContent('lo wo');
    expect(p).toHaveTextContent(/^Hello world$/);
    expect(p).not.toHaveTextContent('Goodbye');
  });

  it('keeps whitespace with normalizeWhitespace false, but turns nbsp into spaces', () => {
    render('<p id="p">a\u00a0 b</p>');
    expect(byId('p')).toHaveTextContent('a  b', { normalizeWhitespace: false });
    expect(byId('p')).not.toHaveTextContent('a b', { normalizeWhitespace: false });
  });

  it('refuses an empty string against non-empty text', () => {
    render('<p id="p">x</p><p id="e"></p>');
    expect(() => expect(byId('p')).toHaveTextContent('')).toThrow(/toBeEmptyDOMElement/);
    expect(byId('e')).toHaveTextContent('');
  });

  it('accepts any Node and rejects non-nodes', () => {
    expect(document.createTextNode('plain')).toHaveTextContent('plain');
    expect(() => expect('plain').toHaveTextContent('plain')).toThrow(/be a Node/);
  });
});

describe('toHaveClass', () => {
  it('takes space-separated strings, several arguments and regexes', () => {
    render('<div id="d" class="a  b c-1"></div>');
    const d = byId('d');
    expect(d).toHaveClass('a');
    expect(d).toHaveClass('b a');
    expect(d).toHaveClass('a', 'b');
    expect(d).toHaveClass(/^c-\d$/);
    expect(d).not.toHaveClass('z');
    expect(d).not.toHaveClass('a z');
  });

  it('supports { exact }', () => {
    render('<div id="d" class="a b"></div>');
    expect(byId('d')).toHaveClass('b a', { exact: true });
    expect(byId('d')).not.toHaveClass('a', { exact: true });
    expect(() => expect(byId('d')).toHaveClass('a', { exact: true })).toThrow(/EXACTLY/);
  });

  it('needs at least one class unless negated', () => {
    render('<div id="d" class="a"></div><div id="n"></div>');
    // With no class names, `.not` asserts that the element has no classes at all.
    expect(byId('n')).not.toHaveClass();
    expect(() => expect(byId('d')).not.toHaveClass()).toThrow(/\(none\)/);
    expect(() => expect(byId('n')).toHaveClass()).toThrow(/At least one expected class/);
  });
});

describe('toHaveValue', () => {
  it('reads text inputs, textareas and number inputs as numbers', () => {
    render(
      '<input id="t" value="hi"><textarea id="ta">body</textarea><input id="n" type="number" value="5"><input id="ne" type="number">',
    );
    expect(byId('t')).toHaveValue('hi');
    expect(byId('ta')).toHaveValue('body');
    expect(byId('n')).toHaveValue(5);
    expect(byId('n')).not.toHaveValue('5');
    expect(byId('ne')).toHaveValue(null);
    expect(byId('ne')).not.toHaveValue();
    expect(() => expect(byId('n')).toHaveValue('5')).toThrow(/\(number\)/);
  });

  it('reads single and multiple selects', () => {
    render(
      '<select id="s"><option value="a">A</option><option value="b" selected>B</option></select>' +
        '<select id="m" multiple><option value="a" selected>A</option><option value="b">B</option><option value="c" selected>C</option></select>',
    );
    expect(byId('s')).toHaveValue('b');
    expect(byId('m')).toHaveValue(['c', 'a']);
    expect(byId('m')).not.toHaveValue(['a']);
    expect(byId('m')).not.toHaveValue(['a', 'b', 'c']);
  });

  it('reads aria-valuenow for value roles and refuses checkboxes', () => {
    render('<div id="r" role="slider" aria-valuenow="7"></div><input id="c" type="checkbox">');
    expect(byId('r')).toHaveValue(7);
    expect(() => expect(byId('c')).toHaveValue('on')).toThrow(/toBeChecked/);
  });
});

describe('toBeDisabled and toBeEnabled', () => {
  it('reads the disabled attribute on form controls only', () => {
    render('<button id="b" disabled>b</button><div id="d" disabled>d</div><x-thing id="x" disabled></x-thing>');
    expect(byId('b')).toBeDisabled();
    expect(byId('b')).not.toBeEnabled();
    expect(byId('d')).not.toBeDisabled();
    expect(byId('d')).toBeEnabled();
    expect(byId('x')).toBeDisabled();
  });

  it('disables descendants of <fieldset disabled> except inside its first legend', () => {
    render(
      '<fieldset disabled><legend><input id="in-legend"></legend><legend><input id="second"></legend><input id="plain"></fieldset>',
    );
    expect(byId('in-legend')).toBeEnabled();
    expect(byId('second')).toBeDisabled();
    expect(byId('plain')).toBeDisabled();
    expect(() => expect(byId('plain')).toBeEnabled()).toThrow(/is not enabled/);
  });
});

describe('toBeChecked', () => {
  it('reads checkboxes, radios and aria-checked roles', () => {
    render(
      '<input id="c" type="checkbox" checked><input id="r" type="radio"><div id="s" role="switch" aria-checked="true"></div><div id="o" role="option" aria-checked="false"></div>',
    );
    expect(byId('c')).toBeChecked();
    expect(byId('r')).not.toBeChecked();
    expect(byId('s')).toBeChecked();
    expect(byId('o')).not.toBeChecked();
  });

  it('fails for elements that cannot be checked', () => {
    render('<input id="t"><div id="d" role="button" aria-checked="true"></div>');
    expect(() => expect(byId('t')).toBeChecked()).toThrow(/only inputs/);
    expect(() => expect(byId('d')).toBeChecked()).toThrow(/only inputs/);
  });
});

describe('toHaveFocus', () => {
  it('compares with the active element', () => {
    render('<input id="a"><input id="b">');
    byId('a').focus();
    expect(byId('a')).toHaveFocus();
    expect(byId('b')).not.toHaveFocus();
    expect(() => expect(byId('b')).toHaveFocus()).toThrow(/Received element with focus/);
  });
});

describe('toHaveAccessibleName and toHaveAccessibleDescription', () => {
  it('computes names from aria-labelledby, labels and content', () => {
    render(
      '<span id="lbl">Shipping</span><span id="lbl2">address</span><input id="i" aria-labelledby="lbl lbl2">' +
        '<label for="j">Email</label><input id="j"><button id="b">Save <span hidden>x</span></button><input id="none">',
    );
    expect(byId('i')).toHaveAccessibleName('Shipping address');
    expect(byId('j')).toHaveAccessibleName('Email');
    expect(byId('b')).toHaveAccessibleName(/^Save$/);
    expect(byId('b')).toHaveAccessibleName(expect.stringContaining('Sa'));
    expect(byId('b')).toHaveAccessibleName();
    expect(byId('none')).not.toHaveAccessibleName();
    expect(() => expect(byId('j')).toHaveAccessibleName('Phone')).toThrow(/Email/);
  });

  it('computes descriptions from aria-describedby', () => {
    render('<p id="hint">Stays on this device</p><button id="b" aria-describedby="hint">Go</button><button id="c">No</button>');
    expect(byId('b')).toHaveAccessibleDescription('Stays on this device');
    expect(byId('b')).toHaveAccessibleDescription(/this device/);
    expect(byId('b')).toHaveAccessibleDescription();
    expect(byId('c')).not.toHaveAccessibleDescription();
  });
});

describe('toContainElement', () => {
  it('checks descendants and accepts null', () => {
    render('<div id="outer"><span id="inner"></span></div><span id="other"></span>');
    expect(byId('outer')).toContainElement(byId('inner'));
    expect(byId('outer')).not.toContainElement(byId('other'));
    expect(byId('outer')).not.toContainElement(null);
    expect(() => expect(byId('outer')).toContainElement(byId('other'))).toThrow(/does not contain/);
  });
});

describe('toHaveStyle', () => {
  it('compares computed styles from objects and CSS strings', () => {
    render('<div id="d" style="width: 25%; display: none; touch-action: none; color: red"></div>');
    const d = byId('d');
    expect(d).toHaveStyle({ width: '25%' });
    expect(d).toHaveStyle({ touchAction: 'none', display: 'none' });
    expect(d).toHaveStyle('display: none; width: 25%');
    expect(d).not.toHaveStyle({ width: '50%' });
    expect(() => expect(d).toHaveStyle({ width: '50%' })).toThrow(/width: 50%/);
  });

  it('throws on CSS it cannot parse', () => {
    render('<div id="d"></div>');
    expect(() => expect(byId('d')).toHaveStyle('width')).toThrow(/Syntax error/);
  });
});

describe('toBeVisible', () => {
  it('walks ancestors for display, visibility, opacity and hidden', () => {
    render(
      '<div id="v">shown</div>' +
        '<div style="display: none"><span id="d">x</span></div>' +
        '<div style="visibility: hidden"><span id="h">x</span></div>' +
        '<div style="opacity: 0"><span id="o">x</span></div>' +
        '<div hidden><span id="a">x</span></div>',
    );
    expect(byId('v')).toBeVisible();
    for (const id of ['d', 'h', 'o', 'a']) expect(byId(id)).not.toBeVisible();
    expect(document.createElement('div')).not.toBeVisible();
    expect(() => expect(byId('d')).toBeVisible()).toThrow(/is not visible/);
  });

  it('hides the content of a closed <details> but not its summary', () => {
    render(
      '<details><summary id="s">Sum</summary><p id="c">Body</p></details>' +
        '<details open><p id="oc">Open body</p></details>',
    );
    expect(byId('s')).toBeVisible();
    expect(byId('c')).not.toBeVisible();
    expect(byId('oc')).toBeVisible();
  });
});

describe('toBeEmptyDOMElement', () => {
  it('ignores comments but not text or elements', () => {
    render('<div id="e"><!-- note --></div><div id="t"> </div><div id="c"><i></i></div>');
    expect(byId('e')).toBeEmptyDOMElement();
    expect(byId('t')).not.toBeEmptyDOMElement();
    expect(byId('c')).not.toBeEmptyDOMElement();
  });
});

describe('failure messages', () => {
  it('print the element, trimmed when large', () => {
    const big = render(`<div id="big">${'<span>row</span>'.repeat(2000)}</div>`);
    let message = '';
    try {
      expect(big).toHaveTextContent('missing');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('Element:');
    expect(message).toContain('<div');
    // 2,000 <span> elements would print as well over 30,000 characters.
    expect(message.length).toBeLessThan(15000);
  });

  it('reject non-elements', () => {
    expect(() => expect({}).toBeVisible()).toThrow(/HTMLElement or an SVGElement/);
  });
});
