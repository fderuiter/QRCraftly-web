import { describe, expect, it } from 'vitest';
import { decodePunycodeLabel, hasMixedScripts, toUnicodeHostname } from '../index';

describe('toUnicodeHostname', () => {
  it('decodes Punycode labels and leaves ASCII labels alone', () => {
    expect(toUnicodeHostname('xn--mnchen-3ya.de')).toBe('münchen.de');
    expect(toUnicodeHostname('www.example.com')).toBe('www.example.com');
    expect(toUnicodeHostname('xn--wgv71a119e.jp')).toBe('日本語.jp');
  });

  it('reveals a lookalike address', () => {
    // "аpple" with a Cyrillic first letter, and an all-Cyrillic "аррӏе".
    expect(toUnicodeHostname('xn--pple-43d.com')).toBe('аpple.com');
    expect(toUnicodeHostname('xn--80ak6aa92e.com')).toBe('аррӏе.com');
  });

  it('keeps a label that is not valid Punycode as it is', () => {
    expect(decodePunycodeLabel('aé-b')).toBeNull();
    expect(decodePunycodeLabel('!!!')).toBeNull();
    expect(toUnicodeHostname('xn--!!!.com')).toBe('xn--!!!.com');
  });
});

describe('hasMixedScripts', () => {
  it('flags a label that mixes Latin and Cyrillic letters', () => {
    expect(hasMixedScripts('аpple.com')).toBe(true);
  });

  it('accepts single-script names and normal Japanese mixes', () => {
    expect(hasMixedScripts('münchen.de')).toBe(false);
    expect(hasMixedScripts('аррӏе.com')).toBe(false);
    expect(hasMixedScripts('example.com')).toBe(false);
    expect(hasMixedScripts('ひらがなカタカナ漢字.jp')).toBe(false);
  });
});
