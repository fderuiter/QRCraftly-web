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
 * Paints the page of a PDF our writer produced into a software canvas (#1610), so a test can
 * decode the code a PDF download holds. It understands exactly the operators pdfExport.ts writes
 * and throws on any other, so a writer change cannot slip past it unread.
 */
import { RasterContext } from './rasterContext';

type Matrix = [number, number, number, number, number, number];
type Operand = number | string | Operand[];

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

/** Splits a content stream into operands and operators. */
function* tokens(content: string): Generator<{ op: string } | { value: Operand }> {
  let i = 0;
  const stack: Operand[][] = [];
  const emit = (value: Operand) => (stack.length ? stack[stack.length - 1].push(value) : null);
  while (i < content.length) {
    const ch = content[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '(') {
      // A literal string with balanced parentheses and backslash escapes.
      let depth = 1;
      let j = i + 1;
      for (; j < content.length && depth > 0; j++) {
        if (content[j] === '\\') j++;
        else if (content[j] === '(') depth++;
        else if (content[j] === ')') depth--;
      }
      const value = content.slice(i + 1, j - 1);
      if (emit(value) === null) yield { value };
      i = j;
    } else if (ch === '[') {
      stack.push([]);
      i++;
    } else if (ch === ']') {
      const value = stack.pop() ?? [];
      if (emit(value) === null) yield { value };
      i++;
    } else {
      const match = /^[^\s()[\]]+/.exec(content.slice(i));
      const word = match ? match[0] : ch;
      i += word.length;
      const value = /^[-+]?(\d+\.?\d*|\.\d+)$/.test(word) ? Number(word) : word;
      if (typeof value === 'number' || word.startsWith('/')) {
        if (emit(value) === null) yield { value };
      } else {
        yield { op: word };
      }
    }
  }
}

/** The page content stream and size of a single-page PDF from pdfExport.ts. */
function readPage(pdf: Uint8Array): { content: string; width: number; height: number } {
  const text = new TextDecoder('latin1').decode(pdf);
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
  if (!box) throw new Error('The PDF has no MediaBox');
  const contents = /\/Contents (\d+) 0 R/.exec(text);
  if (!contents) throw new Error('The PDF page has no content stream');
  const object = new RegExp(`(?:^|\\n)${contents[1]} 0 obj\\n<<[^>]*>>\\nstream\\n`).exec(text);
  if (!object) throw new Error('The content stream object is missing');
  const start = object.index + object[0].length;
  return { content: text.slice(start, text.indexOf('\nendstream', start)), width: Number(box[1]), height: Number(box[2]) };
}

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');

/**
 * Paints a PDF page at `width` pixels. Filled paths are drawn in their colour; images are
 * drawn as opaque grey squares, as the software canvas draws every image.
 * @returns The canvas, whose `data` the decoder can read.
 */
export function rasterizePdf(pdf: Uint8Array, width: number): RasterContext {
  const page = readPage(pdf);
  const scale = width / page.width;
  const height = Math.round(page.height * scale);
  const raster = new RasterContext(width, height);
  const states: { ctm: Matrix; fill: string }[] = [];
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let fill = '#000000';
  let inText = false;
  let operands: Operand[] = [];
  let pathOpen = false;

  const nums = (count: number): number[] => {
    const values = operands.slice(-count);
    if (values.length !== count || values.some((v) => typeof v !== 'number')) throw new Error('Bad operands');
    return values.map(Number);
  };
  const toDevice = (x: number, y: number): [number, number] => {
    const px = ctm[0] * x + ctm[2] * y + ctm[4];
    const py = ctm[1] * x + ctm[3] * y + ctm[5];
    return [px * scale, (page.height - py) * scale];
  };
  const begin = () => {
    if (!pathOpen) raster.beginPath();
    pathOpen = true;
  };
  const paint = (evenOdd: boolean) => {
    raster.fillStyle = fill;
    raster.fill(evenOdd ? 'evenodd' : 'nonzero');
    pathOpen = false;
  };

  for (const token of tokens(page.content)) {
    if ('value' in token) {
      operands.push(token.value);
      continue;
    }
    const { op } = token;
    if (inText) {
      if (op === 'ET') inText = false;
      else if (!['Tf', 'Tm', 'Tj', 'Tz', 'rg', 'k'].includes(op)) throw new Error(`Unexpected ${op} in text`);
      operands = [];
      continue;
    }
    switch (op) {
      case 'q':
        states.push({ ctm, fill });
        break;
      case 'Q':
        ({ ctm, fill } = states.pop() ?? { ctm, fill });
        break;
      case 'cm': {
        const [a, b, c, d, e, f] = nums(6);
        ctm = multiply([a, b, c, d, e, f], ctm);
        break;
      }
      case 'rg': {
        const [r, g, b] = nums(3);
        fill = hex(r, g, b);
        break;
      }
      case 'm':
        begin();
        raster.moveTo(...toDevice(...(nums(2) as [number, number])));
        break;
      case 'l':
        begin();
        raster.lineTo(...toDevice(...(nums(2) as [number, number])));
        break;
      case 'c': {
        const [x1, y1, x2, y2, x3, y3] = nums(6);
        raster.bezierCurveTo(...toDevice(x1, y1), ...toDevice(x2, y2), ...toDevice(x3, y3));
        break;
      }
      case 'h':
        raster.closePath();
        break;
      case 'f':
        paint(false);
        break;
      case 'f*':
        paint(true);
        break;
      case 'W':
      case 'W*':
      case 'n':
        // Clipping paths only bound gradient fills, which these tests do not use.
        raster.beginPath();
        pathOpen = false;
        break;
      case 'sh':
      case 'RG':
      case 'w':
      case 'd':
      case 'S':
        // Gradients and strokes (frames, borders) are not part of the code.
        break;
      case 'Do': {
        // The image fills the unit square under the current matrix.
        raster.beginPath();
        const corners = [toDevice(0, 0), toDevice(1, 0), toDevice(1, 1), toDevice(0, 1)];
        raster.moveTo(...corners[0]);
        for (const corner of corners.slice(1)) raster.lineTo(...corner);
        raster.closePath();
        raster.fillStyle = '#808080';
        raster.fill();
        pathOpen = false;
        break;
      }
      case 'BT':
        inText = true;
        break;
      default:
        throw new Error(`rasterizePdf does not know the ${op} operator`);
    }
    operands = [];
  }
  return raster;
}
