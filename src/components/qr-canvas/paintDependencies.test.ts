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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import {
  EyeShape,
  QRErrorCorrectionLevel,
  QRStyle,
  QRType,
  SocialFormat,
  TemplateStyle,
  type QRConfig,
} from '@/packages/core/types';
import { isStyleField } from '@/utils/styleFields';
import {
  hasPaintConfigChanged,
  PAINT_CONFIG_KEYS,
  QR_CONFIG_DEPENDENCIES,
  type PaintConfigKey,
} from './paintDependencies';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

/** Reads every property name declared on the QRConfig interface directly from its AST. */
function readDeclaredQrConfigKeys(): string[] {
  const typesFile = path.resolve(currentDir, '../../packages/core/types.ts');
  const source = ts.createSourceFile(
    typesFile,
    fs.readFileSync(typesFile, 'utf8'),
    ts.ScriptTarget.Latest,
  );
  const declaredKeys: string[] = [];
  source.forEachChild((node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'QRConfig') {
      for (const member of node.members) {
        if (member.name) {
          declaredKeys.push(member.name.getText(source));
        }
      }
    }
  });
  return declaredKeys;
}

/** Distinct non-default value for each of the 53 'paint' keys in QRConfig. */
const DISTINCT_PAINT_MUTATIONS: { [K in PaintConfigKey]-?: QRConfig[K] } = {
  fgColor: '#123456',
  bgColor: '#fafafa',
  style: QRStyle.SWISS,
  logoUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
  logoSize: 0.28,
  logoPaddingStyle: 'circle',
  logoPadding: 3,
  logoBackgroundColor: '#eeeeee',
  eyeColor: '#654321',
  eyeFrameColor: '#112233',
  eyeBallColor: '#445566',
  eyeFrameShape: EyeShape.LEAF,
  eyeBallShape: EyeShape.CIRCLE,
  isBorderEnabled: true,
  borderSize: 0.09,
  borderColor: '#222222',
  borderStyle: 'dashed',
  borderText: 'SCAN HERE',
  borderTextPosition: 'top-center',
  borderTextColor: '#ffeedd',
  borderLogoUrl: 'data:image/png;base64,R0lGODlhAQABAIAAAAUEBA==',
  borderLogoPosition: 'bottom-right',
  socialFormat: SocialFormat.PORTRAIT_4_5,
  templateStyle: TemplateStyle.MINIMALIST,
  templateHeadline: 'Welcome',
  templateSubtext: 'Point your camera',
  templateBgColor: '#f5f5f5',
  templateTextColor: '#101010',
  templateQrScale: 1.25,
  isMazeEnabled: true,
  isMazeBridgesEnabled: false,
  mazeColor: '#0ea5e9',
  mazePathWidth: 0.35,
  showMazeSolution: true,
  backgroundImageUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
  isLuminanceMaskingEnabled: true,
  fgColorDark: '#0a0a0a',
  fgColorLight: '#fefefe',
  luminanceThreshold: 0.42,
  mosaicImageUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAAC',
  mosaicMode: 'halftone',
  mosaicContrast: 0.75,
  frameStyle: 'banner',
  frameText: 'SCAN ME',
  frameTextColor: '#fefefe',
  frameBgColor: '#111827',
  framePosition: 'top',
  frameIcon: 'scan',
  frameFontFamily: 'monospace',
  gradientType: 'linear',
  gradientColorStops: [
    { offset: 0, color: '#ff0000' },
    { offset: 1, color: '#0000ff' },
  ],
  gradientAngle: 135,
  quietZoneModules: 7,
};

describe('QRCanvas paintDependencies', () => {
  it('classifies every declared QRConfig key into encode, animation, or paint', () => {
    const declaredKeys = readDeclaredQrConfigKeys();
    expect(declaredKeys).toHaveLength(59);

    expect(Object.keys(QR_CONFIG_DEPENDENCIES).sort()).toEqual([...declaredKeys].sort());

    const encodeKeys = declaredKeys.filter(
      (key) => Reflect.get(QR_CONFIG_DEPENDENCIES, key) === 'encode',
    );
    const animationKeys = declaredKeys.filter(
      (key) => Reflect.get(QR_CONFIG_DEPENDENCIES, key) === 'animation',
    );
    const paintKeys = declaredKeys.filter(
      (key) => Reflect.get(QR_CONFIG_DEPENDENCIES, key) === 'paint',
    );

    expect(encodeKeys.sort()).toEqual(['errorCorrectionLevel', 'type', 'value']);
    expect(animationKeys.sort()).toEqual(['animationFps', 'animationValues', 'isAnimating']);
    expect(paintKeys).toHaveLength(53);
    expect([...PAINT_CONFIG_KEYS].sort()).toEqual(paintKeys.sort());
  });

  it('tracks every visual style field from styleFields.ts as a paint dependency', () => {
    const declaredKeys = readDeclaredQrConfigKeys();
    const styleKeys = declaredKeys.filter((key) => isStyleField(key));
    expect(styleKeys).toHaveLength(47);

    const nonPaintStyleKeys = styleKeys.filter(
      (key) => Reflect.get(QR_CONFIG_DEPENDENCIES, key) !== 'paint',
    );
    expect(nonPaintStyleKeys.sort()).toEqual(['animationFps', 'errorCorrectionLevel']);

    for (const key of styleKeys) {
      if (key === 'errorCorrectionLevel' || key === 'animationFps') continue;
      const next: QRConfig = { ...DEFAULT_CONFIG };
      Reflect.set(next, key, Reflect.get(DISTINCT_PAINT_MUTATIONS, key));
      expect(
        hasPaintConfigChanged(DEFAULT_CONFIG, next),
        `Expected style field '${key}' to trigger hasPaintConfigChanged`,
      ).toBe(true);
    }
  });

  it.each(PAINT_CONFIG_KEYS)(
    'detects a change in paint key %s',
    (key) => {
      const next: QRConfig = {
        ...DEFAULT_CONFIG,
        [key]: DISTINCT_PAINT_MUTATIONS[key],
      };
      expect(hasPaintConfigChanged(DEFAULT_CONFIG, next)).toBe(true);
    },
  );

  it('returns false when only encode or animation fields change', () => {
    const largeDataUrl = `data:image/png;base64,${'A'.repeat(4096)}`;
    const base: QRConfig = {
      ...DEFAULT_CONFIG,
      logoUrl: largeDataUrl,
      borderLogoUrl: largeDataUrl,
      backgroundImageUrl: largeDataUrl,
      mosaicImageUrl: largeDataUrl,
    };

    expect(hasPaintConfigChanged(base, base)).toBe(false);
    expect(hasPaintConfigChanged(base, { ...base })).toBe(false);
    expect(
      hasPaintConfigChanged(base, {
        ...base,
        value: 'https://example.org/updated',
        type: QRType.TEXT,
        errorCorrectionLevel: QRErrorCorrectionLevel.L,
        animationValues: ['frame-1', 'frame-2'],
        isAnimating: true,
        animationFps: 15,
      }),
    ).toBe(false);
  });

  it('compares gradientColorStops items by offset and color', () => {
    const withStops: QRConfig = {
      ...DEFAULT_CONFIG,
      gradientType: 'linear',
      gradientColorStops: [
        { offset: 0, color: '#111111' },
        { offset: 1, color: '#999999' },
      ],
    };

    // Distinct array instance with identical stop values does not trigger repaint
    expect(
      hasPaintConfigChanged(withStops, {
        ...withStops,
        gradientColorStops: [
          { offset: 0, color: '#111111' },
          { offset: 1, color: '#999999' },
        ],
      }),
    ).toBe(false);

    // Editing a stop offset triggers repaint
    expect(
      hasPaintConfigChanged(withStops, {
        ...withStops,
        gradientColorStops: [
          { offset: 0.2, color: '#111111' },
          { offset: 1, color: '#999999' },
        ],
      }),
    ).toBe(true);

    // Editing a stop color triggers repaint
    expect(
      hasPaintConfigChanged(withStops, {
        ...withStops,
        gradientColorStops: [
          { offset: 0, color: '#111111' },
          { offset: 1, color: '#abcdef' },
        ],
      }),
    ).toBe(true);

    // Adding or clearing stops triggers repaint
    expect(
      hasPaintConfigChanged(withStops, {
        ...withStops,
        gradientColorStops: [
          { offset: 0, color: '#111111' },
          { offset: 0.5, color: '#555555' },
          { offset: 1, color: '#999999' },
        ],
      }),
    ).toBe(true);
    expect(hasPaintConfigChanged(withStops, { ...withStops, gradientColorStops: undefined })).toBe(
      true,
    );
  });

  it('detects undefined-to-defined transitions for quietZoneModules, frameFontFamily, and luminance fields', () => {
    const unsetOptional: QRConfig = {
      ...DEFAULT_CONFIG,
      quietZoneModules: undefined,
      frameFontFamily: undefined,
      isLuminanceMaskingEnabled: undefined,
      fgColorDark: undefined,
      fgColorLight: undefined,
      luminanceThreshold: undefined,
    };

    expect(hasPaintConfigChanged(unsetOptional, { ...unsetOptional, quietZoneModules: 6 })).toBe(
      true,
    );
    expect(
      hasPaintConfigChanged(unsetOptional, { ...unsetOptional, frameFontFamily: 'serif' }),
    ).toBe(true);
    expect(
      hasPaintConfigChanged(unsetOptional, { ...unsetOptional, isLuminanceMaskingEnabled: true }),
    ).toBe(true);
    expect(
      hasPaintConfigChanged(unsetOptional, { ...unsetOptional, fgColorDark: '#102030' }),
    ).toBe(true);
    expect(
      hasPaintConfigChanged(unsetOptional, { ...unsetOptional, fgColorLight: '#f0e0d0' }),
    ).toBe(true);
    expect(
      hasPaintConfigChanged(unsetOptional, { ...unsetOptional, luminanceThreshold: 0.35 }),
    ).toBe(true);
  });
});
