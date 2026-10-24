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

import type { QRConfig } from '@/packages/core/types';
import { generateQRSvg } from './svgExport';
import { type ModuleRenderOptions } from '@/packages/qr-matrix';
import {
  formatCmyk,
  formatMatrix,
  formatNum,
  formatRgb,
  literalString,
  pathOperators,
  readSvgScene,
  rgbToCmyk,
  shadingDictionary,
  type SceneElement,
  type SceneImage,
  type ScenePath,
  type SceneText,
  winAnsiExtraPuts,
} from './vectorScene';
import { alphaToMask, decodeSceneImages, deflate, MissingImageError, rgbToCmykBytes, type RasterImage, type VectorExportOptions } from './vectorImages';

const PS_PATH = { move: 'moveto', line: 'lineto', curve: 'curveto', close: 'closepath' };

/** Bytes per PostScript string (the language caps strings at 65,535). */
const STRING_BYTES = 32000;

/**
 * Re-encodes Helvetica to Latin-1 so accented text prints as typed (#1362). Codes 39, 45 and 96
 * follow WinAnsi (PDF) rather than ISOLatin1Encoding's quoteright, minus and quoteleft, and
 * 0x80-0x9F get WinAnsi's dashes, curly quotes and euro sign, so EPS and PDF print the same text.
 * Built on use: a module-level call would keep the vector writers in the generator's first-load chunk.
 */
const fontProlog = (): string[] => ['Helvetica', 'Helvetica-Bold'].map(
  (name) =>
    `/${name} findfont dup length dict begin { 1 index /FID ne { def } { pop pop } ifelse } forall /Encoding ISOLatin1Encoding 256 array copy dup 45 /hyphen put dup 39 /quotesingle put dup 96 /grave put ${winAnsiExtraPuts()} def currentdict end /QR${name} exch definefont pop`
);

const hex = (bytes: Uint8Array): string => {
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 32) {
    lines.push(Array.from(bytes.subarray(i, i + 32), (b) => b.toString(16).padStart(2, '0')).join(''));
  }
  return lines.join('\n');
};

/** Image data as an array of hex strings and a procedure that hands them out in turn. */
async function dataSource(name: string, bytes: Uint8Array, out: string[]): Promise<string> {
  const packed = await deflate(bytes);
  const data = packed ?? bytes;
  out.push(`/${name}D [`);
  for (let i = 0; i < data.length; i += STRING_BYTES) out.push(`<${hex(data.subarray(i, i + STRING_BYTES))}>`);
  out.push(`] def`, `/${name}I 0 def`);
  out.push(`/${name}P { ${name}I ${name}D length lt { ${name}D ${name}I get /${name}I ${name}I 1 add def } { () } ifelse } bind def`);
  return packed ? `${name}P /FlateDecode filter` : `${name}P`;
}

function clipAndTransform(el: SceneElement, out: string[]): void {
  for (const clip of el.clips) {
    out.push('newpath', clip.map(([x, y], i) => `${formatNum(x)} ${formatNum(y)} ${i === 0 ? 'moveto' : 'lineto'}`).join('\n'), 'closepath clip');
  }
  out.push('newpath');
  if (el.matrix) out.push(`[${formatMatrix(el.matrix)}] concat`);
}

function drawPath(el: ScenePath, out: string[], colorSpace: 'rgb' | 'cmyk' = 'rgb'): void {
  const path = pathOperators(el.d, PS_PATH);
  if (el.fill && 'color' in el.fill) {
    const colorCmd = colorSpace === 'cmyk'
      ? `${formatCmyk(rgbToCmyk(el.fill.color))} setcmykcolor`
      : `${formatRgb(el.fill.color)} setrgbcolor`;
    out.push('newpath', path, colorCmd, el.evenOdd ? 'eofill' : 'fill');
  } else if (el.fill) {
    out.push('gsave', 'newpath', path, el.evenOdd ? 'eoclip' : 'clip', 'newpath');
    if (el.fill.gradient.transform) out.push(`[${formatMatrix(el.fill.gradient.transform)}] concat`);
    out.push(`${shadingDictionary(el.fill.gradient, colorSpace)} shfill`, 'grestore');
  }
  if (el.stroke) {
    const strokeCmd = colorSpace === 'cmyk'
      ? `${formatCmyk(rgbToCmyk(el.stroke.color))} setcmykcolor`
      : `${formatRgb(el.stroke.color)} setrgbcolor`;
    out.push('newpath', path, strokeCmd, `${formatNum(el.stroke.width)} setlinewidth`);
    if (el.stroke.dash.length > 0) out.push(`[${el.stroke.dash.map(formatNum).join(' ')}] 0 setdash`);
    out.push('stroke');
  }
}

function drawText(el: SceneText, out: string[], colorSpace: 'rgb' | 'cmyk' = 'rgb'): void {
  const text = literalString(el.codes);
  // Back to y-up for the glyphs; the baseline sits on y.
  out.push(`${formatNum(el.x)} ${formatNum(el.y)} translate 1 -1 scale`);
  out.push(`/QR${el.bold ? 'Helvetica-Bold' : 'Helvetica'} findfont ${formatNum(el.fontSize)} scalefont setfont`);
  const colorCmd = colorSpace === 'cmyk'
    ? `${formatCmyk(rgbToCmyk(el.color))} setcmykcolor`
    : `${formatRgb(el.color)} setrgbcolor`;
  out.push(colorCmd);
  if (el.textLength) out.push(`${formatNum(el.textLength)} ${text} stringwidth pop div 1 scale`);
  const shift = el.anchor === 'middle' ? ' 2 div neg' : el.anchor === 'end' ? ' neg' : null;
  out.push(shift ? `${text} stringwidth pop${shift} 0 moveto ${text} show` : `0 0 moveto ${text} show`);
}

async function drawImage(el: SceneImage, image: RasterImage, id: number, out: string[], colorSpace: 'rgb' | 'cmyk' = 'rgb'): Promise<void> {
  const name = `qrImg${id}`;
  const bytes = colorSpace === 'cmyk' ? rgbToCmykBytes(image.rgb) : image.rgb;
  const data = await dataSource(name, bytes, out);
  const mask = image.alpha ? await dataSource(`${name}M`, alphaToMask(image, image.alpha), out) : null;
  out.push('gsave');
  clipAndTransform(el, out);
  // Unit square to the image box; the first row lands at the top (smaller y).
  out.push(`${formatNum(el.x)} ${formatNum(el.y)} translate ${formatNum(el.width)} ${formatNum(el.height)} scale`);
  const cs = colorSpace === 'cmyk' ? '/DeviceCMYK setcolorspace' : '/DeviceRGB setcolorspace';
  const decode = colorSpace === 'cmyk' ? '[0 1 0 1 0 1 0 1]' : '[0 1 0 1 0 1]';
  out.push(cs, `/${name}I 0 def`);
  const size = `/Width ${image.width} /Height ${image.height} /ImageMatrix [${image.width} 0 0 ${image.height} 0 0]`;
  const dataDict = `<< /ImageType 1 ${size} /BitsPerComponent 8 /Decode ${decode} /DataSource ${data} >>`;
  if (mask) {
    // Masked image: mask samples of 1 are painted, 0 left clear.
    out.push(`/${name}MI 0 def`);
    out.push(
      `<< /ImageType 3 /InterleaveType 3 /DataDict ${dataDict} /MaskDict << /ImageType 1 ${size} /BitsPerComponent 1 /Decode [1 0] /DataSource ${mask} >> >> image`
    );
  } else {
    out.push(`${dataDict} image`);
  }
  out.push('grestore');
}

/**
 * Converts the export SVG into Encapsulated PostScript. Paths, gradients and text stay
 * vector; logos are embedded as images, with transparency as a hard mask.
 * @param svgString - SVG built by `generateQRSvg`.
 * @param options - Image decoder override.
 * @returns The EPS file text (ASCII).
 * @throws {MissingImageError} When a logo cannot be decoded, rather than leave it out.
 */
export async function convertSvgToEps(svgString: string, options: VectorExportOptions = {}): Promise<string> {
  const scene = readSvgScene(svgString);
  const images = await decodeSceneImages(scene, options.decodeImage);
  const colorSpace = options.colorSpace ?? 'rgb';

  const body: string[] = [];
  let imageCount = 0;
  let needsLevel3 = false;
  for (const el of scene.elements) {
    if (el.kind === 'image') {
      const image = images.get(el.href);
      if (!image) throw new MissingImageError();
      needsLevel3 = true;
      await drawImage(el, image, ++imageCount, body, colorSpace);
      continue;
    }
    if (el.kind === 'path' && el.fill && 'gradient' in el.fill) needsLevel3 = true;
    body.push('gsave');
    clipAndTransform(el, body);
    if (el.kind === 'path') drawPath(el, body, colorSpace);
    else drawText(el, body, colorSpace);
    body.push('grestore');
  }

  const { width, height } = scene;
  const header = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.ceil(width)} ${Math.ceil(height)}`,
    `%%HiResBoundingBox: 0 0 ${formatNum(width)} ${formatNum(height)}`,
    `%%Title: ${scene.title.replace(/[^\x20-\x7E]/g, '')}`,
    '%%Creator: QRCraftly',
    // Smooth shading (shfill) and Flate-compressed images are LanguageLevel 3 features.
    ...(needsLevel3 ? ['%%LanguageLevel: 3'] : []),
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    ...fontProlog(),
    '%%EndProlog',
    '%%Page: 1 1',
    `${8 + imageCount * 8} dict begin`,
    'gsave',
    // Match SVG's top-left origin.
    `0 ${formatNum(height)} translate 1 -1 scale`,
  ];
  return [...header, ...body, 'grestore', 'end', 'showpage', '%%Trailer', '%%EOF', ''].join('\n');
}

/**
 * Generates an Encapsulated PostScript (.eps) file for a QR configuration.
 */
export async function generateQREps(
  config: QRConfig,
  options?: { onLogoOmitted?: () => void; renderOptions?: ModuleRenderOptions; skipPayloadValidation?: boolean } & VectorExportOptions
): Promise<string> {
  const svg = await generateQRSvg(config, options);
  return convertSvgToEps(svg, options);
}
