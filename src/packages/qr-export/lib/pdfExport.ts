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

import type { QRConfig } from '@/types';
import { generateQRSvg } from './svgExport';
import { type ModuleRenderOptions } from '@/packages/qr-matrix';
import {
  formatMatrix,
  formatNum,
  formatRgb,
  literalString,
  pathOperators,
  readSvgScene,
  shadingDictionary,
  textWidth,
  type SceneElement,
  type SceneGradient,
  type ScenePath,
  type SceneText,
} from './vectorScene';
import { decodeSceneImages, deflate, MissingImageError, type RasterImage, type VectorExportOptions } from './vectorImages';

const PDF_PATH = { move: 'm', line: 'l', curve: 'c', close: 'h' };

/** PDF text string: UTF-16BE with a byte-order mark, as hex. */
const textString = (text: string): string =>
  `<FEFF${Array.from(text, (ch) => {
    const code = ch.codePointAt(0) ?? 0x3f;
    if (code <= 0xffff) return code.toString(16).padStart(4, '0');
    const v = code - 0x10000;
    return ((0xd800 + (v >> 10)).toString(16) + (0xdc00 + (v & 0x3ff)).toString(16)).padStart(8, '0');
  }).join('')}>`.toUpperCase();

class Resources {
  readonly shadings = new Map<SceneGradient, string>();
  readonly images = new Map<string, string>();

  shading(gradient: SceneGradient): string {
    let name = this.shadings.get(gradient);
    if (!name) {
      name = `Sh${this.shadings.size + 1}`;
      this.shadings.set(gradient, name);
    }
    return name;
  }

  image(href: string): string {
    let name = this.images.get(href);
    if (!name) {
      name = `Im${this.images.size + 1}`;
      this.images.set(href, name);
    }
    return name;
  }
}

function drawPath(el: ScenePath, res: Resources, out: string[]): void {
  const path = pathOperators(el.d, PDF_PATH);
  if (el.fill && 'color' in el.fill) {
    out.push(`${formatRgb(el.fill.color)} rg`, path, el.evenOdd ? 'f*' : 'f');
  } else if (el.fill) {
    out.push('q', path, el.evenOdd ? 'W* n' : 'W n');
    if (el.fill.gradient.transform) out.push(`${formatMatrix(el.fill.gradient.transform)} cm`);
    out.push(`/${res.shading(el.fill.gradient)} sh`, 'Q');
  }
  if (el.stroke) {
    out.push(`${formatRgb(el.stroke.color)} RG`, `${formatNum(el.stroke.width)} w`);
    if (el.stroke.dash.length > 0) out.push(`[${el.stroke.dash.map(formatNum).join(' ')}] 0 d`);
    out.push(path, 'S');
  }
}

function drawText(el: SceneText, out: string[]): void {
  const natural = textWidth(el.codes, el.fontSize, el.bold);
  const width = el.textLength ?? natural;
  const x = el.anchor === 'middle' ? el.x - width / 2 : el.anchor === 'end' ? el.x - width : el.x;
  out.push('BT', `/${el.bold ? 'F2' : 'F1'} ${formatNum(el.fontSize)} Tf`, `${formatRgb(el.color)} rg`);
  if (el.textLength && natural > 0) out.push(`${formatNum((el.textLength / natural) * 100)} Tz`);
  // The page is flipped to SVG's y-down space, so the text matrix flips the glyphs back.
  out.push(`1 0 0 -1 ${formatNum(x)} ${formatNum(el.y)} Tm`, `${literalString(el.codes)} Tj`, 'ET');
}

function drawElement(el: SceneElement, res: Resources, images: ReadonlyMap<string, RasterImage>, out: string[]): void {
  out.push('q');
  for (const clip of el.clips) {
    out.push(clip.map(([x, y], i) => `${formatNum(x)} ${formatNum(y)} ${i === 0 ? 'm' : 'l'}`).join('\n'), 'h W n');
  }
  if (el.matrix) out.push(`${formatMatrix(el.matrix)} cm`);
  if (el.kind === 'path') drawPath(el, res, out);
  else if (el.kind === 'text') drawText(el, out);
  else {
    if (!images.has(el.href)) throw new MissingImageError();
    // The unit square's top edge (y = 1) holds the image's first row.
    out.push(`${formatNum(el.width)} 0 0 ${formatNum(-el.height)} ${formatNum(el.x)} ${formatNum(el.y + el.height)} cm`);
    out.push(`/${res.image(el.href)} Do`);
  }
  out.push('Q');
}

/** Collects PDF objects and writes them with a byte-exact cross-reference table. */
class PdfWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;
  private readonly offsets: number[] = [];
  private readonly encoder = new TextEncoder();

  write(data: string | Uint8Array): void {
    const bytes = typeof data === 'string' ? this.encoder.encode(data) : data;
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  /** Reserves the next object number. */
  reserve(): number {
    this.offsets.push(-1);
    return this.offsets.length;
  }

  object(id: number, dict: string, stream?: Uint8Array): void {
    this.offsets[id - 1] = this.length;
    if (!stream) {
      this.write(`${id} 0 obj\n${dict}\nendobj\n`);
      return;
    }
    this.write(`${id} 0 obj\n${dict.replace(/>>$/, `/Length ${stream.length} >>`)}\nstream\n`);
    this.write(stream);
    this.write('\nendstream\nendobj\n');
  }

  finish(root: number, info: number): Uint8Array<ArrayBuffer> {
    const start = this.length;
    const entries = this.offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    this.write(`xref\n0 ${this.offsets.length + 1}\n0000000000 65535 f \n${entries}`);
    this.write(`trailer\n<< /Size ${this.offsets.length + 1} /Root ${root} 0 R /Info ${info} 0 R >>\nstartxref\n${start}\n%%EOF\n`);
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

async function imageObjects(pdf: PdfWriter, image: RasterImage): Promise<number> {
  const base = `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /BitsPerComponent 8`;
  let smask = '';
  if (image.alpha) {
    const alphaId = pdf.reserve();
    const packed = await deflate(image.alpha);
    pdf.object(alphaId, `<< ${base} /ColorSpace /DeviceGray${packed ? ' /Filter /FlateDecode' : ''} >>`, packed ?? image.alpha);
    smask = ` /SMask ${alphaId} 0 R`;
  }
  const id = pdf.reserve();
  const packed = await deflate(image.rgb);
  pdf.object(id, `<< ${base} /ColorSpace /DeviceRGB${smask}${packed ? ' /Filter /FlateDecode' : ''} >>`, packed ?? image.rgb);
  return id;
}

/**
 * Converts the export SVG into a one-page vector PDF. Paths, gradients and text stay vector;
 * logos are embedded as images with their transparency.
 * @param svgString - SVG built by `generateQRSvg`.
 * @param options - Image decoder override.
 * @returns The PDF file bytes.
 * @throws {MissingImageError} When a logo cannot be decoded, rather than leave it out.
 */
export async function convertSvgToPdf(svgString: string, options: VectorExportOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  const scene = readSvgScene(svgString);
  const images = await decodeSceneImages(scene, options.decodeImage);

  const res = new Resources();
  const ops: string[] = [`1 0 0 -1 0 ${formatNum(scene.height)} cm`];
  for (const el of scene.elements) drawElement(el, res, images, ops);
  const content = new TextEncoder().encode(ops.join('\n'));

  const pdf = new PdfWriter();
  // The comment line of high bytes marks the file as binary for transfer tools.
  pdf.write('%PDF-1.4\n%');
  pdf.write(new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const catalog = pdf.reserve();
  const pages = pdf.reserve();
  const page = pdf.reserve();
  const contents = pdf.reserve();
  const info = pdf.reserve();

  const shadingRefs: string[] = [];
  for (const [gradient, name] of res.shadings) {
    const id = pdf.reserve();
    pdf.object(id, shadingDictionary(gradient));
    shadingRefs.push(`/${name} ${id} 0 R`);
  }
  const imageRefs: string[] = [];
  for (const [href, name] of res.images) {
    const image = images.get(href);
    if (image) imageRefs.push(`/${name} ${await imageObjects(pdf, image)} 0 R`);
  }

  const font = (base: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`;
  const resources = [
    `/Font << /F1 ${font('Helvetica')} /F2 ${font('Helvetica-Bold')} >>`,
    shadingRefs.length ? `/Shading << ${shadingRefs.join(' ')} >>` : '',
    imageRefs.length ? `/XObject << ${imageRefs.join(' ')} >>` : '',
  ]
    .filter(Boolean)
    .join(' ');

  pdf.object(catalog, `<< /Type /Catalog /Pages ${pages} 0 R >>`);
  pdf.object(pages, `<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  pdf.object(
    page,
    `<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${formatNum(scene.width)} ${formatNum(scene.height)}] /Resources << ${resources} >> /Contents ${contents} 0 R >>`
  );
  pdf.object(contents, '<< >>', content);
  pdf.object(info, `<< /Title ${textString(scene.title)} /Producer (QRCraftly) >>`);
  return pdf.finish(catalog, info);
}

/**
 * Generates a vector PDF for a QR configuration.
 */
export async function generateQRPdf(
  config: QRConfig,
  options?: { onLogoOmitted?: () => void; renderOptions?: ModuleRenderOptions; skipPayloadValidation?: boolean } & VectorExportOptions
): Promise<Uint8Array<ArrayBuffer>> {
  const svg = await generateQRSvg(config, options);
  return convertSvgToPdf(svg, options);
}
