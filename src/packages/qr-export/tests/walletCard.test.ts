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

import { describe, expect, it } from 'vitest';
import { qrEncoder } from '../../../../tests/fixtures/qrEncoder';
import { loadQrReader } from '@/packages/qr-decode';
import { QRType } from '@/types';
import {
  cleanCardText,
  paintWalletCard,
  planWalletCard,
  walletRefusalReason,
  WALLET_CARD_SIZE,
  type MeasureText,
  type WalletCardContext,
  type WalletCardPlan,
} from '../index';

/** A monospace stand-in for the canvas: every character is half the font size wide. */
const measure: MeasureText = (text, font) => text.length * (Number(/(\d+)px/.exec(font)?.[1]) / 2);

function modulesOf(value: string) {
  return qrEncoder.create(value, { errorCorrectionLevel: 'M' }).modules;
}

/** A context that paints rectangles into an RGBA buffer (text is skipped; only the rectangles matter for decoding). */
function rasterContext(plan: WalletCardPlan) {
  const data = new Uint8ClampedArray(plan.width * plan.height * 4);
  let fill = '#ffffff';
  const ctx: WalletCardContext = {
    set fillStyle(value: string) {
      fill = value;
    },
    get fillStyle() {
      return fill;
    },
    font: '',
    textAlign: 'center',
    textBaseline: 'alphabetic',
    fillText: () => undefined,
    fillRect: (x: number, y: number, w: number, h: number) => {
      const level = fill === '#000000' ? 0 : 255;
      for (let row = y; row < y + h; row++) data.fill(level, (row * plan.width + x) * 4, (row * plan.width + x + w) * 4);
    },
  } as WalletCardContext;
  const pixels = () => {
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    return data;
  };
  return { ctx, pixels };
}

/** Paints a plan into an RGBA buffer with `paintWalletCard`. */
function rasterize(plan: WalletCardPlan) {
  const { ctx, pixels } = rasterContext(plan);
  paintWalletCard(ctx, plan);
  return pixels();
}

/** Paints a plan the old way, one `moduleSize` square per dark module, as the reference. */
function rasterizeReference(plan: WalletCardPlan) {
  const { ctx, pixels } = rasterContext(plan);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, plan.width, plan.height);
  ctx.fillStyle = '#000000';
  const { modules, moduleSize, originX, originY } = plan;
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col)) ctx.fillRect(originX + col * moduleSize, originY + row * moduleSize, moduleSize, moduleSize);
    }
  }
  return pixels();
}

function countDarkRuns(modules: WalletCardPlan['modules']): number {
  let runs = 0;
  for (let r = 0; r < modules.size; r++) {
    let inRun = false;
    for (let c = 0; c < modules.size; c++) {
      if (modules.get(r, c)) {
        if (!inRun) {
          inRun = true;
          runs++;
        }
      } else {
        inRun = false;
      }
    }
  }
  return runs;
}

describe('Wallet card (ADR 0048)', () => {
  it('draws a plain code that our reader decodes', async () => {
    const value = 'WIFI:T:WPA;S:Home Network;P:correct horse battery staple;;';
    const plan = planWalletCard(modulesOf(value), { title: 'Home Wi-Fi', subtitle: 'Scan to join' }, measure);
    const reader = await loadQrReader();
    const [code] = reader.read(rasterize(plan), plan.width, plan.height);
    expect(code?.text).toBe(value);
  });

  it('keeps a four-module quiet zone inside the card and whole-pixel modules', () => {
    const modules = modulesOf('https://qrcraftly.com');
    const plan = planWalletCard(modules, { title: 'QRCraftly' }, measure);
    const quiet = plan.moduleSize * 4;
    expect(Number.isInteger(plan.moduleSize)).toBe(true);
    expect(plan.originX - quiet).toBeGreaterThanOrEqual(0);
    expect(plan.originX + plan.moduleSize * modules.size + quiet).toBeLessThanOrEqual(WALLET_CARD_SIZE.width);
    expect(plan.originY + plan.moduleSize * modules.size + quiet).toBeLessThanOrEqual(WALLET_CARD_SIZE.height);
    // The code starts below the last line of text.
    expect(plan.originY - quiet).toBeGreaterThan(plan.lines[plan.lines.length - 1].y);
  });

  it('wraps long titles to two lines and ends a cut line with an ellipsis', () => {
    const title = 'A very long event name that will never fit on one line of the card at all';
    const plan = planWalletCard(modulesOf('x'), { title }, measure);
    expect(plan.lines).toHaveLength(2);
    expect(plan.lines[1].text.endsWith('…')).toBe(true);
    for (const line of plan.lines) expect(measure(line.text, line.font)).toBeLessThanOrEqual(WALLET_CARD_SIZE.width - 192);
  });

  it('centres the code when there is no text', () => {
    const modules = modulesOf('plain');
    const plan = planWalletCard(modules, {}, measure);
    expect(plan.lines).toEqual([]);
    const left = plan.originX;
    const right = WALLET_CARD_SIZE.width - (plan.originX + plan.moduleSize * modules.size);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it('strips control and hidden direction characters from the text', () => {
    expect(cleanCardText(`Hi${String.fromCharCode(0x202e)}there${String.fromCharCode(7)} now`, 60)).toBe('Hithere now');
    expect(cleanCardText('  spaced   out  ', 60)).toBe('spaced out');
    expect(cleanCardText('x'.repeat(100), 60)).toHaveLength(60);
    expect(cleanCardText(undefined, 60)).toBe('');
  });

  it('refuses payment codes and bulk batches', () => {
    expect(walletRefusalReason(QRType.PAYMENT)).toMatch(/lock screen/);
    expect(walletRefusalReason(QRType.BULK_CSV)).not.toBeNull();
    expect(walletRefusalReason(QRType.WIFI)).toBeNull();
    expect(walletRefusalReason(QRType.URL)).toBeNull();
  });

  it('consolidates dark module runs into single fillRect calls and produces pixel-identical output', () => {
    const shortPlan = planWalletCard(modulesOf('https://qrcraftly.com'), { title: 'QRCraftly' }, measure);
    const shortBuffer = rasterize(shortPlan);
    const shortRefBuffer = rasterizeReference(shortPlan);
    expect(Buffer.from(shortBuffer.buffer).equals(Buffer.from(shortRefBuffer.buffer))).toBe(true);

    const largePlan = planWalletCard(modulesOf('A'.repeat(1900)), { title: 'Large QR Code', subtitle: 'Version 30+' }, measure);
    expect(largePlan.modules.size).toBeGreaterThanOrEqual(137);
    const largeBuffer = rasterize(largePlan);
    const largeRefBuffer = rasterizeReference(largePlan);
    expect(Buffer.from(largeBuffer.buffer).equals(Buffer.from(largeRefBuffer.buffer))).toBe(true);

    let fillRectCount = 0;
    const ctx: WalletCardContext = {
      fillStyle: '',
      font: '',
      textAlign: 'center',
      textBaseline: 'alphabetic',
      fillText: () => undefined,
      fillRect: () => {
        fillRectCount++;
      },
    };
    paintWalletCard(ctx, shortPlan);
    const moduleFillRects = fillRectCount - 1;
    expect(moduleFillRects).toBe(countDarkRuns(shortPlan.modules));
  });
});
