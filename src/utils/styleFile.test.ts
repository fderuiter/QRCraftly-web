import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../constants';
import { type QRConfig, QRStyle, QRType } from '../types';
import { MAX_STYLE_FILE_BYTES, parseStyleFile, serializeStyle, STYLE_FILE_FORMAT } from './styleFile';

const config = (overrides: Partial<QRConfig> = {}): QRConfig => ({ ...DEFAULT_CONFIG, ...overrides });

describe('style file', () => {
  it('round-trips the style of a config', () => {
    const original = config({ style: QRStyle.SWISS, fgColor: '#112233', bgColor: '#fefefe', eyeColor: '#445566', isBorderEnabled: true, borderSize: 0.1 });
    const parsed = parseStyleFile(serializeStyle(original));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.skipped).toBe(0);
    expect({ ...config(), ...parsed.style }).toEqual(expect.objectContaining({ style: QRStyle.SWISS, fgColor: '#112233', bgColor: '#fefefe', eyeColor: '#445566', isBorderEnabled: true, borderSize: 0.1 }));
  });

  it('never writes content or images', () => {
    const text = serializeStyle(
      config({ value: 'https://secret.example/token', type: QRType.WIFI, logoUrl: 'data:image/png;base64,AAAA', borderText: 'private words', templateHeadline: 'headline', mosaicImageUrl: 'data:image/png;base64,BBBB' })
    );
    expect(text).not.toMatch(/secret|token|private words|headline|data:image|logoUrl|value/);
    expect(JSON.parse(text).format).toBe(STYLE_FILE_FORMAT);
  });

  it('ignores content and unknown fields in a file', () => {
    const parsed = parseStyleFile(JSON.stringify({ format: STYLE_FILE_FORMAT, version: 1, style: { fgColor: '#000000', value: 'https://evil.example', logoUrl: 'data:x', constructor: 1, __proto__: { polluted: true } } }));
    expect(parsed.ok && Object.keys(parsed.style)).toEqual(['fgColor']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('counts and drops values outside the rules', () => {
    const parsed = parseStyleFile(JSON.stringify({ format: STYLE_FILE_FORMAT, version: 1, style: { fgColor: 'red; background:url(x)', style: 'nope', logoSize: 9, borderSize: Number.NaN, isBorderEnabled: 'yes', bgColor: '#ffffff' } }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.style).toEqual({ bgColor: '#ffffff' });
    expect(parsed.skipped).toBe(5);
  });

  it.each([
    ['not json', 'That file is not valid JSON.'],
    ['[]', 'That is not a QRCraftly style file.'],
    [JSON.stringify({ format: 'other', version: 1, style: {} }), 'That is not a QRCraftly style file.'],
    [JSON.stringify({ format: STYLE_FILE_FORMAT, version: 2, style: {} }), 'That style file comes from a newer version of QRCraftly.'],
    [JSON.stringify({ format: STYLE_FILE_FORMAT, version: 1, style: [] }), 'That style file has no settings.'],
    [JSON.stringify({ format: STYLE_FILE_FORMAT, version: 1, style: { value: 'x' } }), 'That style file has no usable settings.'],
  ])('refuses %s', (text, reason) => {
    expect(parseStyleFile(text)).toEqual({ ok: false, reason });
  });

  it('refuses a file that is too large', () => {
    expect(parseStyleFile(' '.repeat(MAX_STYLE_FILE_BYTES + 1)).ok).toBe(false);
  });

  it('keeps a transparent background and the eye colours (#1366)', () => {
    const parsed = parseStyleFile(serializeStyle(config({ bgColor: 'transparent', eyeFrameColor: '#123456', eyeBallColor: '#654321' })));
    expect(parsed.ok && parsed.style).toEqual(expect.objectContaining({ bgColor: 'transparent', eyeFrameColor: '#123456', eyeBallColor: '#654321' }));
  });

  it('accepts transparent only for the background', () => {
    const parsed = parseStyleFile(JSON.stringify({ format: STYLE_FILE_FORMAT, version: 1, style: { bgColor: 'transparent', fgColor: 'transparent' } }));
    expect(parsed.ok && parsed.style).toEqual({ bgColor: 'transparent' });
  });
});
