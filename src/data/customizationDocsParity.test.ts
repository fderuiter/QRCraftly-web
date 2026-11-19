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

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { clampSize, ExportOptions, FORMAT_LABELS, printHint } from '@/components/ExportOptions';
import { ContrastBanner } from '@/components/style-controls/ContrastWarning';
import { CTA_PRESETS } from '@/components/style-controls/FrameControls';
import { MIN_CONTRAST_THRESHOLD, PATTERNS, PRESET_COLORS } from '@/constants';
import { PRESET_LOGO_CATEGORIES, PRESET_LOGOS } from '@/constants/presetLogos';
import { DEFAULT_CONFIG } from '@/packages/core/config';
import { IMAGE_UPLOAD_LIMITS } from '@/packages/core/security';
import {
  EyeShape,
  FRAME_FONT_FAMILIES,
  type QRConfig,
  QRErrorCorrectionLevel,
  QRStyle,
  QRType,
  SocialFormat,
  TemplateStyle,
} from '@/packages/core/types';
import { WALLET_CARD_SIZE, WALLET_CARD_TEXT_LIMITS, walletRefusalReason } from '@/packages/qr-export';
import { getLogoMetrics, MIN_LOGO_BACKING_PADDING } from '@/packages/qr-matrix';
import { DEFAULT_MOSAIC_OPTIONS, planMosaic } from '@/packages/qr-matrix/mosaic';
import { BRAND_TEMPLATES_STORAGE_KEY, MAX_CUSTOM_TEMPLATES } from '@/utils/brandTemplateManager';
import { isStyleField, pickStyle, STYLE_BASELINE } from '@/utils/styleFields';
import { PREBUILT_TEMPLATES } from './brandTemplates';
import { getGuide, guides, type Guide, type GuideBlock } from './guides';
import { landingPageContent } from './landingPageContent';

/**
 * Internal and arcade-only QRConfig fields that must never be exposed in user-facing guides
 * or landing page copy.
 */
const EXCLUDED_INTERNAL_QR_FIELDS: readonly (keyof QRConfig)[] = [
  'isMazeEnabled',
  'isMazeBridgesEnabled',
  'mazeColor',
  'mazePathWidth',
  'showMazeSolution',
  'backgroundImageUrl',
  'isLuminanceMaskingEnabled',
  'fgColorDark',
  'fgColorLight',
  'luminanceThreshold',
  'animationValues',
  'isAnimating',
  'animationFps',
];

function collectBlockText(block: GuideBlock): string {
  switch (block.type) {
    case 'p':
      return block.text;
    case 'note':
      return `${block.title} ${block.text}`;
    case 'table':
      return [block.caption, ...block.head, ...block.rows.flat()].join(' ');
    case 'code':
      return `${block.title ?? ''} ${block.code}`;
    case 'ul':
    case 'ol':
      return block.items.join(' ');
  }
}

function collectGuideText(guide: Guide): string {
  return [
    guide.title,
    guide.shortTitle,
    guide.seoTitle,
    guide.description,
    guide.lead,
    ...guide.sections.flatMap((section) => [section.heading, ...section.blocks.map(collectBlockText)]),
  ].join('\n');
}

function stripTags(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function assertNumericStyleBound(field: keyof QRConfig, min: number, max: number, step: number): void {
  expect(isStyleField(field), `${field} should be a registered style field`).toBe(true);
  expect(pickStyle({ [field]: min }).skipped, `${field} should accept min=${min}`).toBe(0);
  expect(pickStyle({ [field]: max }).skipped, `${field} should accept max=${max}`).toBe(0);
  expect(pickStyle({ [field]: min - step }).skipped, `${field} should reject below min=${min}`).toBe(1);
  expect(pickStyle({ [field]: max + step }).skipped, `${field} should reject above max=${max}`).toBe(1);
}

function assertEnumStyleValues(field: keyof QRConfig, expectedValues: readonly string[]): void {
  expect(isStyleField(field), `${field} should be a registered style field`).toBe(true);
  for (const value of expectedValues) {
    expect(pickStyle({ [field]: value }).skipped, `${field} should accept '${value}'`).toBe(0);
  }
  expect(pickStyle({ [field]: '__invalid_option__' }).skipped, `${field} should reject unknown values`).toBe(1);
}

describe('customization and export documentation parity', () => {
  it('matches styleFields.ts numeric bounds, defaults, and enums in /guides/qr-code-customization-parameters', () => {
    const guide = getGuide('qr-code-customization-parameters');
    expect(guide).toBeDefined();
    const text = collectGuideText(guide!);

    // Verify canonical numeric bounds against pickStyle rules AND guide text
    assertNumericStyleBound('gradientAngle', 0, 360, 1);
    expect(text).toContain('0° to 360°');

    assertNumericStyleBound('logoSize', 0.1, 0.3, 0.01);
    const minLogoPct = Math.round(0.1 * 100);
    const maxLogoPct = Math.round(0.3 * 100);
    const maxUnpaddedAreaPct = Math.round(0.3 * 0.3 * 100);
    expect(text).toContain(`${minLogoPct}% to ${maxLogoPct}%`);
    expect(text).toContain(`${maxUnpaddedAreaPct}% of the unpadded matrix area`);
    expect(text).not.toMatch(/under 30 percent of the total code area/i);

    assertNumericStyleBound('logoPadding', 0, 4, 0.5);
    expect(text).toContain(`${MIN_LOGO_BACKING_PADDING} to 4 modules`);
    expect(text).toContain(`default ${STYLE_BASELINE.logoPadding} module`);

    assertNumericStyleBound('borderSize', 0.01, 0.15, 0.01);
    expect(text).toContain('1.0% to 15.0%');
    expect(text).toContain(`default ${(Number(STYLE_BASELINE.borderSize) * 100).toFixed(1)}%`);

    assertNumericStyleBound('templateQrScale', 0.5, 1.5, 0.05);
    expect(text).toContain('50% to 150%');
    expect(text).toContain(`default ${Math.round(Number(STYLE_BASELINE.templateQrScale) * 100)}%`);

    assertNumericStyleBound('quietZoneModules', 2, 10, 1);
    expect(text).toContain('2 to 10 modules');
    expect(text).toContain(`default ${STYLE_BASELINE.quietZoneModules} modules`);

    assertNumericStyleBound('mosaicContrast', 0, 1, 0.05);
    expect(text).toContain('0% to 100%');
    expect(text).toContain(`default ${Math.round(DEFAULT_MOSAIC_OPTIONS.contrast * 100)}%`);

    // Verify enum sets in styleFields.ts and corresponding studio terms in guide text
    assertEnumStyleValues('style', Object.values(QRStyle));
    assertEnumStyleValues('eyeFrameShape', Object.values(EyeShape));
    assertEnumStyleValues('eyeBallShape', Object.values(EyeShape));
    assertEnumStyleValues('gradientType', ['none', 'linear', 'radial']);
    assertEnumStyleValues('logoPaddingStyle', ['square', 'circle', 'none']);
    assertEnumStyleValues('borderStyle', ['solid', 'dashed', 'dotted', 'double']);
    assertEnumStyleValues('borderTextPosition', ['top-center', 'bottom-center']);
    assertEnumStyleValues('borderLogoPosition', ['bottom-center', 'bottom-right']);
    assertEnumStyleValues('socialFormat', Object.values(SocialFormat));
    assertEnumStyleValues('templateStyle', Object.values(TemplateStyle));
    assertEnumStyleValues('frameStyle', ['none', 'pill', 'banner', 'speech-bubble', 'card']);
    assertEnumStyleValues('framePosition', ['bottom', 'top', 'left', 'right']);
    assertEnumStyleValues('frameIcon', ['none', 'scan', 'camera', 'star', 'heart', 'info', 'phone']);
    assertEnumStyleValues('frameFontFamily', FRAME_FONT_FAMILIES);
    assertEnumStyleValues('mosaicMode', ['tiles', 'halftone']);
    assertEnumStyleValues('errorCorrectionLevel', Object.values(QRErrorCorrectionLevel));
    expect(pickStyle({ bgColor: 'transparent' }).skipped).toBe(0);

    for (const label of [
      'Transparent Background',
      'Solid',
      'Linear',
      'Radial',
      'Square (1:1)',
      'Portrait (4:5)',
      'Story (9:16)',
      'Minimalist',
      'Gradient',
      'Solid Frame',
      'Wi-Fi Card',
      'Dashed',
      'Dotted',
      'Double',
      'Top Center',
      'Bottom Center',
      'Bottom Right',
      'Pill Badge',
      'Banner Bar',
      'Speech Bubble',
      'Full Card',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('matches studio preset counts, contrast threshold, logo ECC clamping, and Mosaic rules', () => {
    const guide = getGuide('qr-code-customization-parameters')!;
    const text = collectGuideText(guide);

    // Brand templates & Style Gallery
    expect(text).toContain(`${PREBUILT_TEMPLATES.length} ready-made presets`);
    expect(text).toContain(`up to ${MAX_CUSTOM_TEMPLATES} custom templates`);
    expect(text).toContain(BRAND_TEMPLATES_STORAGE_KEY);
    expect(text).toContain('Save as template');
    expect(text).toContain('Export JSON');
    expect(text).toContain('Import JSON');

    const totalGalleryTiles = PATTERNS.length + PRESET_COLORS.length;
    expect(text).toContain(`${totalGalleryTiles} live previews`);
    expect(text).toContain(`${PATTERNS.length} module styles`);
    expect(text).toContain(`${PRESET_COLORS.length} palettes`);
    expect(text).toContain('Surprise me');
    expect(text).toContain('Undo style change');
    expect(text).toContain('Redo style change');

    for (const pattern of PATTERNS) {
      expect(text).toContain(pattern.label);
    }

    // Contrast rule & Fix contrast banner button label
    expect(text).toContain(`${MIN_CONTRAST_THRESHOLD}:1`);
    const bannerText = stripTags(
      renderToStaticMarkup(
        createElement(ContrastBanner, {
          isVisible: true,
          contrastRatio: 2.1,
          messageType: 'color',
          onAutoFix: () => {},
        })
      )
    );
    expect(bannerText).toContain('Fix contrast');
    expect(text).toContain('Fix contrast');

    // Frame & CTA Badge counts and presets
    expect(text).toContain(`${CTA_PRESETS.length} presets`);
    for (const preset of CTA_PRESETS) {
      expect(text).toContain(preset.text);
    }
    expect(text).toContain(`${FRAME_FONT_FAMILIES.length} options`);
    expect(text).toContain('Helvetica');

    // Preset logos, upload cap, and per-ECC cutout clamping from getLogoMetrics
    expect(text).toContain(`${PRESET_LOGOS.length} built-in generic SVG marks`);
    for (const preset of PRESET_LOGOS) {
      expect(text).toContain(preset.label);
    }
    for (const category of PRESET_LOGO_CATEGORIES) {
      if (category.id !== 'all') {
        expect(text).toContain(category.label);
      }
    }
    expect(text).toContain(`${IMAGE_UPLOAD_LIMITS.MAX_FILE_UPLOAD_MB} MB`);

    const moduleCount = 21;
    for (const level of [
      QRErrorCorrectionLevel.L,
      QRErrorCorrectionLevel.M,
      QRErrorCorrectionLevel.Q,
      QRErrorCorrectionLevel.H,
    ]) {
      const metrics = getLogoMetrics(
        {
          ...DEFAULT_CONFIG,
          errorCorrectionLevel: level,
          logoSize: 0.3,
          logoPaddingStyle: 'square',
          logoPadding: 4,
        },
        moduleCount,
        10
      );
      const clampedPct = Math.round((metrics.cutoutModuleSize / moduleCount) * 100);
      expect(text).toContain(`${clampedPct}% at Level ${level}`);
    }

    // Mosaic Halftone 3x3 Mosaic Core vs 1x1 Tiles
    expect(DEFAULT_MOSAIC_OPTIONS.mode).toBe('halftone');
    const dummyModules = { size: 21, get: () => true };
    const dummySource = { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255]) };
    const halftoneSub = planMosaic(dummyModules, dummySource, { mode: 'halftone', contrast: 0.5 }).subdivisions;
    const tilesSub = planMosaic(dummyModules, dummySource, { mode: 'tiles', contrast: 0.5 }).subdivisions;
    expect(halftoneSub).toBe(3);
    expect(tilesSub).toBe(1);
    expect(text).toContain('Halftone');
    expect(text).toContain(`${halftoneSub}x${halftoneSub}`);
    expect(text).toContain('Mosaic Core');
    expect(text).toContain('Tiles');
    expect(text).toContain(`${tilesSub}x${tilesSub}`);
  });

  it('matches ExportOptions and WalletDialog constants and labels in /guides/qr-code-export-and-wallet-options', () => {
    const exportGuide = getGuide('qr-code-export-and-wallet-options');
    expect(exportGuide).toBeDefined();
    const text = collectGuideText(exportGuide!);

    // Formats and raster bounds
    const formatLabels = Object.values(FORMAT_LABELS);
    expect(formatLabels).toHaveLength(6);
    for (const label of formatLabels) {
      expect(text).toContain(label);
    }

    const minPx = clampSize(0);
    const maxPx = clampSize(100_000);
    expect(text).toContain(`${minPx} to ${maxPx} px`);
    expect(text).toContain('512 px');
    expect(text).toContain('2048 px');
    expect(text).toContain('4096 px');

    // Verify 300 dpi print equivalents match printHint()
    for (const px of [512, 2048, 4096]) {
      const widthMatch = printHint(px).match(/Prints (\d+\.\d+ cm \(\d+\.\d+ in\))/);
      expect(widthMatch).not.toBeNull();
      expect(text).toContain(widthMatch![1]);
    }

    // Verify rendered ExportOptions labels match documented UI labels
    const rasterPanelMarkup = stripTags(
      renderToStaticMarkup(
        createElement(ExportOptions, {
          id: 'parity-raster',
          format: 'png',
          onFormatChange: () => {},
          size: 2048,
          onSizeChange: () => {},
          filename: 'qr-code',
          onFilenameChange: () => {},
          onCopyImage: () => {},
          onCopySvg: () => {},
          copySvgBusy: false,
          onWallet: () => {},
        })
      )
    );
    const vectorPanelMarkup = stripTags(
      renderToStaticMarkup(
        createElement(ExportOptions, {
          id: 'parity-vector',
          format: 'pdf',
          colorSpace: 'cmyk',
          onFormatChange: () => {},
          onColorSpaceChange: () => {},
          size: 2048,
          onSizeChange: () => {},
          filename: 'qr-code',
          onFilenameChange: () => {},
          onCopyImage: () => {},
          onCopySvg: () => {},
          copySvgBusy: false,
          onWallet: () => {},
        })
      )
    );

    for (const uiLabel of ['Screen', 'Print', 'Poster', 'Custom', 'File name', 'Copy image', 'Copy as SVG', 'Add to phone wallet']) {
      expect(rasterPanelMarkup).toContain(uiLabel);
      expect(text).toContain(uiLabel);
    }
    for (const vectorLabel of ['Color Space', 'RGB', 'CMYK']) {
      expect(vectorPanelMarkup).toContain(vectorLabel);
      expect(text).toContain(vectorLabel);
    }

    // Wallet Card dimensions, text limits, refusal reasons, and developer pass section
    expect(text).toContain(`${WALLET_CARD_SIZE.width}x${WALLET_CARD_SIZE.height}`);
    expect(text).toContain(`${WALLET_CARD_TEXT_LIMITS.title} characters`);
    expect(text).toContain(`${WALLET_CARD_TEXT_LIMITS.subtitle} characters`);
    expect(walletRefusalReason(QRType.PAYMENT)).not.toBeNull();
    expect(walletRefusalReason(QRType.BULK_CSV)).not.toBeNull();
    expect(walletRefusalReason(QRType.URL)).toBeNull();
    expect(text).toContain('Payment');
    expect(text).toContain('Bulk CSV');
    expect(text).toContain('Have your own Apple or Google developer keys?');
    expect(text).toContain('.pkpass');
    expect(text).toContain('Google Wallet pass');
  });

  it('keeps print guide and Mosaic/SVG landing pages aligned with studio behavior', () => {
    const printGuide = getGuide('how-to-print-a-qr-code-that-scans')!;
    const printText = collectGuideText(printGuide);
    expect(printText).toContain('EPS');
    expect(printText).toContain('CMYK');
    expect(printText).toContain('Helvetica');
    expect(printText).toContain('2 to 10 modules');

    const mosaicCopy = landingPageContent['mosaic-qr-code'];
    const aiFaq = mosaicCopy.faqs.find((faq) => faq.question === 'Is this an AI QR code?');
    expect(aiFaq).toBeDefined();
    expect(aiFaq!.answer).toContain('Halftone');
    expect(aiFaq!.answer).toContain('3x3');
    expect(aiFaq!.answer).toContain('Mosaic Core');
    expect(aiFaq!.answer).toContain('Tiles');
    expect(aiFaq!.answer).toContain('1x1');
    expect(aiFaq!.answer).not.toContain('Your picture is shrunk to one color per module');

    expect(mosaicCopy.guide?.privacy).toContain('3x3');
    expect(mosaicCopy.guide?.privacy).toContain('Mosaic Core');
    expect(mosaicCopy.guide?.privacy).toContain('Tiles');
    expect(mosaicCopy.guide?.privacy).not.toContain('reduced to one color per module');

    const svgCopy = landingPageContent['svg-qr-code'];
    const svgCopySerialized = JSON.stringify(svgCopy);
    expect(svgCopySerialized).toContain('Copy as SVG');
    expect(svgCopySerialized).not.toContain('Copy SVG code');
    expect(svgCopySerialized).toContain('CMYK');
    expect(svgCopySerialized).toContain('EPS');
    expect(svgCopySerialized).toContain('PDF');
  });

  it('enforces guide description caps, unique React keys, and zero excluded internal QRConfig fields', () => {
    const allLandingSerialized = JSON.stringify(landingPageContent);
    for (const excludedField of EXCLUDED_INTERNAL_QR_FIELDS) {
      expect(allLandingSerialized).not.toContain(excludedField);
    }

    for (const guide of guides) {
      expect(guide.description.length, `${guide.slug} description exceeds 155 chars`).toBeLessThanOrEqual(155);

      const guideText = collectGuideText(guide);
      for (const excludedField of EXCLUDED_INTERNAL_QR_FIELDS) {
        expect(guideText, `${guide.slug} leaked internal field ${excludedField}`).not.toContain(excludedField);
      }

      const sourceUrls = guide.sources.map((source) => source.url);
      expect(new Set(sourceUrls).size, `${guide.slug} has duplicate source URLs`).toBe(sourceUrls.length);

      for (const section of guide.sections) {
        for (const block of section.blocks) {
          if (block.type === 'ul' || block.type === 'ol') {
            expect(new Set(block.items).size, `${guide.slug}#${section.id} has duplicate list items`).toBe(block.items.length);
          } else if (block.type === 'table') {
            expect(new Set(block.head).size, `${guide.slug}#${section.id} has duplicate table headers`).toBe(block.head.length);
            const rowKeys = block.rows.map((row) => row[0]);
            expect(new Set(rowKeys).size, `${guide.slug}#${section.id} has duplicate table row keys`).toBe(rowKeys.length);
            for (const row of block.rows) {
              expect(new Set(row).size, `${guide.slug}#${section.id} row '${row[0]}' has duplicate cell text`).toBe(row.length);
            }
          }
        }
      }
    }
  });
});
