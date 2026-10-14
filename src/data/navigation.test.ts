import { describe, expect, it } from 'vitest';
import { GENERATOR_FOOTER_LINKS, HELP_LINKS, PRIMARY_NAV_ITEMS, QR_TYPE_ROUTES, getCurrentPrimaryNavId, normalizePathname } from './navigation';
import { QRType } from '@/types';

describe('primary navigation model', () => {
  it('contains the five primary destinations in order', () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual([
      'Create QR',
      'File Transfer',
      'Arcade',
      'About',
      'Security',
    ]);
    expect(PRIMARY_NAV_ITEMS.find((item) => item.id === 'transfer')?.tag).toBe('Beta');
  });

  it('lists the guides and the pledge as help links', () => {
    expect(HELP_LINKS).toEqual([
      ['Guides', '/guides'],
      ['No-Ads Pledge', '/free-forever'],
    ]);
  });

  it('lists one footer link per generator route', () => {
    expect(GENERATOR_FOOTER_LINKS.map(([, href]) => href).sort()).toEqual(Object.values(QR_TYPE_ROUTES).sort());
  });

  it('maps every QR type to a route', () => {
    for (const type of Object.values(QRType)) {
      expect(QR_TYPE_ROUTES[type]).toMatch(/^\//);
    }
  });

  it('identifies the current destination', () => {
    expect(getCurrentPrimaryNavId('/')).toBe('create');
    expect(getCurrentPrimaryNavId('/vcard-qr-code/')).toBe('create');
    expect(getCurrentPrimaryNavId('/file-transfer')).toBe('transfer');
    expect(getCurrentPrimaryNavId('/file-transfer/receive')).toBe('transfer');
    expect(getCurrentPrimaryNavId('/about?x=1')).toBe('about');
    expect(getCurrentPrimaryNavId('/security#privacy')).toBe('security');
    expect(getCurrentPrimaryNavId('/arcade')).toBe('arcade');
    expect(getCurrentPrimaryNavId('/game')).toBeUndefined();
  });

  it('normalises pathnames', () => {
    expect(normalizePathname('/')).toBe('/');
    expect(normalizePathname('/about/')).toBe('/about');
    expect(normalizePathname('')).toBe('/');
  });
});
