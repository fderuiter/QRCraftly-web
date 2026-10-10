/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

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
 * Real pixel round-trip for the Fluid Ink style (issue #919).
 *
 * The production renderer draws into a tiny software canvas in rasterContext.ts, which
 * flattens the recorded paths (lines, quadratic curves, arcs) and fills them with
 * the canvas default non-zero winding rule into an RGBA buffer. That buffer is then
 * decoded with our real decoder (#1178).
 */

import { describe, it, expect } from 'vitest';
import { qrEncoder as QRCode } from '../../../../tests/fixtures/qrEncoder';
import { qrReader } from '../../../../tests/fixtures/qrReader';
import {
  QRConfig,
  QRStyle,
  QRType,
  QRErrorCorrectionLevel,
  SocialFormat,
  TemplateStyle,
} from '@/types';
import { drawQRInternal, calculateLayout, clearFluidCache, isFinderSeparatorZone } from '../index';
import { RasterContext, toContext } from './rasterContext';

const baseConfig: QRConfig = {
  value: '',
  type: QRType.TEXT,
  fgColor: '#000000',
  bgColor: '#ffffff',
  eyeColor: '#000000',
  errorCorrectionLevel: QRErrorCorrectionLevel.M,
  style: QRStyle.FLUID,
  isMazeEnabled: false,
  mazeColor: '#3b82f6',
  isMazeBridgesEnabled: false,
  showMazeSolution: false,
  logoUrl: null,
  logoSize: 0.2,
  logoPaddingStyle: 'square',
  logoPadding: 0,
  logoBackgroundColor: '#ffffff',
  isBorderEnabled: false,
  borderSize: 0.05,
  borderColor: '#000000',
  borderStyle: 'solid',
  borderText: '',
  borderTextPosition: 'bottom-center',
  borderTextColor: '#ffffff',
  borderLogoUrl: null,
  borderLogoPosition: 'bottom-center',
  socialFormat: SocialFormat.SQUARE_1_1,
  templateStyle: TemplateStyle.NONE,
};

const payloads: Array<{ name: string; value: string }> = [
  { name: 'short URL', value: 'https://qrcraftly.com' },
  { name: 'Wi-Fi', value: 'WIFI:T:WPA;S:Home Network;P:correct horse battery staple;;' },
  {
    name: 'vCard',
    value: 'BEGIN:VCARD\nVERSION:3.0\nN:Lovelace;Ada\nORG:Analytical Engines\nTEL:+15551234567\nEND:VCARD',
  },
  {
    name: 'long URL',
    value:
      'https://qrcraftly.com/fluid-scannability-verification-long-payload-with-extended-parameters-and-extra-data-for-stress-testing-density',
  },
];

const ecLevels = [
  QRErrorCorrectionLevel.L,
  QRErrorCorrectionLevel.M,
  QRErrorCorrectionLevel.Q,
  QRErrorCorrectionLevel.H,
];

interface QRModulesLike {
  size: number;
  get: (row: number, col: number) => number | boolean;
}

const QUIET_MODULES = 4;

// Software rasterising is slow on shared CI runners, so each (payload, EC, size)
// is drawn once and the result reused by every test that inspects it.
const renderCache = new Map<string, ReturnType<typeof renderFluidUncached>>();
const renderFluid = (value: string, ecLevel: QRErrorCorrectionLevel, pxPerModule = 8) => {
  const key = `${ecLevel}|${pxPerModule}|${value}`;
  let rendered = renderCache.get(key);
  if (!rendered) {
    rendered = renderFluidUncached(value, ecLevel, pxPerModule);
    renderCache.set(key, rendered);
  }
  return rendered;
};

function renderFluidUncached(value: string, ecLevel: QRErrorCorrectionLevel, pxPerModule: number) {
  const qr = QRCode.create(value, { errorCorrectionLevel: ecLevel });
  const modules = qr.modules as unknown as QRModulesLike;
  const moduleCount = modules.size;
  const size = (moduleCount + QUIET_MODULES * 2) * pxPerModule;
  const raster = new RasterContext(size, size);
  clearFluidCache();
  drawQRInternal(
    toContext(raster),
    modules as never,
    { ...baseConfig, value, errorCorrectionLevel: ecLevel },
    null,
    null,
    size,
    moduleCount
  );
  const { drawX, cellSize } = calculateLayout(baseConfig, size, moduleCount);
  return { raster, modules, moduleCount, size, origin: drawX, cell: cellSize };
}

const isDark = (rgb: [number, number, number]): boolean => rgb[0] + rgb[1] + rgb[2] < 384;

describe('Fluid Ink round-trip (real pixels)', { timeout: 60_000 }, () => {
  // Two module sizes: before the fluid eyeball became a squircle, a round eyeball made
  // jsQR (the decoder before #1178) miss the finder patterns at 8 and 16 px per module for some payloads.
  for (const { name, value } of payloads) {
    for (const ec of ecLevels) {
      it(`decodes ${name} at EC ${ec}`, () => {
        for (const px of [8, 16]) {
          const { raster, size } = renderFluid(value, ec, px);
          expect(qrReader.read(raster.data, size, size)[0]?.text, `could not decode ${name} at EC ${ec}, ${px}px/module`).toBe(value);
        }
      });
    }
  }

  for (const ec of ecLevels) {
    it(`renders every module centre with the colour of the encoded matrix at EC ${ec}`, () => {
      const { raster, modules, moduleCount, origin, cell } = renderFluid(payloads[3].value, ec);
      for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
          const inked = isDark(raster.colorAt(origin + (c + 0.5) * cell, origin + (r + 0.5) * cell));
          if (inked !== Boolean(modules.get(r, c))) {
            expect.fail(`module (${r},${c}) at EC ${ec} rendered ${inked ? 'dark' : 'light'}`);
          }
        }
      }
    });
  }

  it('actually renders fluid geometry (curves and diagonal bridges), not plain squares', () => {
    const { raster, modules, moduleCount, origin, cell } = renderFluid(payloads[3].value, QRErrorCorrectionLevel.H);
    const dark = (r: number, c: number) => Boolean(modules.get(r, c));
    let bridges = 0;
    let rounded = 0;
    for (let r = 9; r < moduleCount - 9; r++) {
      for (let c = 9; c < moduleCount - 9; c++) {
        // An isolated dark module renders as a dot: its corner is left light.
        if (dark(r, c) && !dark(r - 1, c) && !dark(r, c - 1) && !dark(r - 1, c - 1)) {
          if (!isDark(raster.colorAt(origin + (c + 0.03) * cell, origin + (r + 0.03) * cell))) rounded++;
        }
        // Two diagonal dark modules are joined by a neck through the shared corner.
        if (dark(r - 1, c - 1) && dark(r, c) && !dark(r - 1, c) && !dark(r, c - 1)) {
          if (isDark(raster.colorAt(origin + (c + 0.05) * cell, origin + (r - 0.05) * cell))) bridges++;
        }
      }
    }
    expect(rounded).toBeGreaterThan(0);
    expect(bridges).toBeGreaterThan(0);
  });

  for (const ec of ecLevels) {
    it(`keeps finder patterns intact and unbridged at EC ${ec}`, () => {
      const { raster, moduleCount, origin, cell } = renderFluid(payloads[3].value, ec);
      const at = (r: number, c: number, fr = 0.5, fc = 0.5) =>
        isDark(raster.colorAt(origin + (c + fc) * cell, origin + (r + fr) * cell));

      // 1. Every separator module is entirely light, including its corners, so no
      //    fluid neck from the data area reaches into the finder buffer.
      const fractions = [0.08, 0.3, 0.5, 0.7, 0.92];
      for (let r = 0; r < moduleCount; r++) {
        for (let c = 0; c < moduleCount; c++) {
          if (!isFinderSeparatorZone(r, c, moduleCount)) continue;
          for (const fr of fractions) {
            for (const fc of fractions) {
              expect(at(r, c, fr, fc), `separator (${r},${c}) inked at ${fr},${fc}`).toBe(false);
            }
          }
        }
      }

      // 2. Each finder keeps the 1:1:3:1:1 dark/light/dark/light/dark ratio along the
      //    horizontal and vertical centre lines that decoders scan.
      const corners: Array<[number, number]> = [
        [0, 0],
        [0, moduleCount - 7],
        [moduleCount - 7, 0],
      ];
      for (const [r0, c0] of corners) {
        const pattern = [true, false, true, true, true, false, true];
        for (let i = 0; i < 7; i++) {
          expect(at(r0 + 3, c0 + i), `finder row module (${r0 + 3},${c0 + i})`).toBe(pattern[i]);
          expect(at(r0 + i, c0 + 3), `finder column module (${r0 + i},${c0 + 3})`).toBe(pattern[i]);
        }
      }
    });
  }
});
