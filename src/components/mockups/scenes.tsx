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

import type { ReactNode } from 'react';

/** Viewbox shared by every scene, so scenes line up and export at one aspect ratio. */
export const SCENE_WIDTH = 400;
export const SCENE_HEIGHT = 300;

/** Where the QR sits in a scene, in viewbox units. */
interface QrSlot {
  x: number;
  y: number;
  size: number;
  /** SVG transform applied to the QR image, for scenes where the print is turned or tipped. */
  transform?: string;
}

/** What a scene draws its two parallax layers from. */
interface SceneLayers {
  /** The QR image, already placed in the slot. */
  qr: ReactNode;
  /** SVG transform for the far layer (the wall, the desk). */
  backShift: string;
  /** SVG transform for the near layer (the object and the QR). */
  frontShift: string;
}

/** An original scene drawn in code: no photo, no font and no outside file. */
interface MockupScene {
  id: 'poster' | 'card' | 'table-tent' | 'screen' | 'sticker';
  label: string;
  /** Sentence for assistive technology describing the scene. */
  description: string;
  slot: QrSlot;
  /** Printed width the size slider starts at, in centimetres. */
  defaultCm: number;
  minCm: number;
  maxCm: number;
  /** Whether the code is printed (size and distance guidance applies) or shown on a screen. */
  printed: boolean;
  Scene: (layers: SceneLayers) => ReactNode;
}

// Scene colours depict real materials, so they stay the same in light and dark themes.
const MATERIAL = {
  wall: '#e7e2d9',
  wallShade: '#d6cfc3',
  paper: '#fbfaf7',
  ink: '#2b2f3a',
  inkSoft: '#9aa0ad',
  accent: '#0f766e',
  wood: '#a77b52',
  woodShade: '#8d6641',
  metal: '#b9bec7',
  metalShade: '#9aa0ab',
  screenBezel: '#1c1f26',
  screenGlow: '#f4f6fb',
  shadow: '#000000',
} as const;

/** Bars that stand in for lines of text. */
function TextBars({ x, y, widths, gap = 9, height = 4, color = MATERIAL.inkSoft }: { x: number; y: number; widths: number[]; gap?: number; height?: number; color?: string }) {
  return (
    <>
      {widths.map((width, index) => (
        <rect key={index} x={x} y={y + index * gap} width={width} height={height} rx={height / 2} fill={color} />
      ))}
    </>
  );
}

const POSTER: MockupScene = {
  id: 'poster',
  label: 'Poster',
  description: 'A framed poster on a plain wall with your QR code in the middle.',
  slot: { x: 150, y: 112, size: 100 },
  defaultCm: 20,
  minCm: 5,
  maxCm: 60,
  printed: true,
  Scene: ({ qr, backShift, frontShift }) => (
    <>
      <g data-layer="back" transform={backShift}>
        <rect x={-20} y={-20} width={440} height={340} fill={MATERIAL.wall} />
        <rect x={-20} y={250} width={440} height={70} fill={MATERIAL.wallShade} />
      </g>
      <g data-layer="front" transform={frontShift}>
        <rect x={112} y={22} width={184} height={264} fill={MATERIAL.shadow} opacity={0.14} />
        <rect x={104} y={14} width={184} height={264} fill={MATERIAL.paper} />
        <rect x={104} y={14} width={184} height={36} fill={MATERIAL.accent} />
        <TextBars x={120} y={24} widths={[110, 70]} height={5} color={MATERIAL.paper} />
        {qr}
        <TextBars x={140} y={230} widths={[116, 90, 104]} />
      </g>
    </>
  ),
};

const CARD: MockupScene = {
  id: 'card',
  label: 'Business card',
  description: 'A business card lying on a wooden desk with your QR code on the right.',
  slot: { x: 238, y: 100, size: 62, transform: 'rotate(-7 200 150)' },
  defaultCm: 2.5,
  minCm: 1.5,
  maxCm: 6,
  printed: true,
  Scene: ({ qr, backShift, frontShift }) => (
    <>
      <g data-layer="back" transform={backShift}>
        <rect x={-20} y={-20} width={440} height={340} fill={MATERIAL.wood} />
        {[40, 90, 150, 210, 265].map((y) => (
          <rect key={y} x={-20} y={y} width={440} height={2} fill={MATERIAL.woodShade} opacity={0.5} />
        ))}
      </g>
      <g data-layer="front" transform={frontShift}>
        <g transform="rotate(-7 200 150)">
          <rect x={80} y={84} width={250} height={140} rx={6} fill={MATERIAL.shadow} opacity={0.22} />
          <rect x={72} y={76} width={250} height={140} rx={6} fill={MATERIAL.paper} />
          <rect x={72} y={76} width={8} height={140} fill={MATERIAL.accent} />
          <TextBars x={96} y={104} widths={[90, 60]} height={7} color={MATERIAL.ink} />
          <TextBars x={96} y={160} widths={[100, 84, 92]} />
        </g>
        {qr}
      </g>
    </>
  ),
};

const TABLE_TENT: MockupScene = {
  id: 'table-tent',
  label: 'Table tent',
  description: 'A folded table tent standing on a café table, with your QR code on the front panel.',
  slot: { x: 150, y: 96, size: 100, transform: 'skewY(-2) translate(0 4)' },
  defaultCm: 8,
  minCm: 3,
  maxCm: 20,
  printed: true,
  Scene: ({ qr, backShift, frontShift }) => (
    <>
      <g data-layer="back" transform={backShift}>
        <rect x={-20} y={-20} width={440} height={340} fill={MATERIAL.wall} />
        <rect x={-20} y={218} width={440} height={102} fill={MATERIAL.wood} />
        <rect x={-20} y={218} width={440} height={4} fill={MATERIAL.woodShade} />
      </g>
      <g data-layer="front" transform={frontShift}>
        <ellipse cx={200} cy={252} rx={116} ry={10} fill={MATERIAL.shadow} opacity={0.22} />
        <polygon points="116,60 284,52 296,232 104,238" fill={MATERIAL.paper} />
        <polygon points="104,238 296,232 292,246 108,250" fill={MATERIAL.inkSoft} opacity={0.55} />
        <TextBars x={140} y={72} widths={[110, 70]} height={5} color={MATERIAL.accent} />
        {qr}
        <TextBars x={138} y={206} widths={[124]} />
      </g>
    </>
  ),
};

const SCREEN: MockupScene = {
  id: 'screen',
  label: 'Phone screen',
  description: 'A phone held upright showing your QR code on its screen.',
  slot: { x: 156, y: 98, size: 88 },
  defaultCm: 5,
  minCm: 3,
  maxCm: 8,
  printed: false,
  Scene: ({ qr, backShift, frontShift }) => (
    <>
      <g data-layer="back" transform={backShift}>
        <rect x={-20} y={-20} width={440} height={340} fill={MATERIAL.wallShade} />
      </g>
      <g data-layer="front" transform={frontShift}>
        <rect x={134} y={14} width={132} height={274} rx={20} fill={MATERIAL.screenBezel} />
        <rect x={142} y={26} width={116} height={250} rx={12} fill={MATERIAL.screenGlow} />
        <rect x={180} y={18} width={40} height={5} rx={2.5} fill={MATERIAL.ink} />
        <TextBars x={154} y={44} widths={[60, 40]} height={5} color={MATERIAL.ink} />
        {qr}
        <rect x={158} y={206} width={84} height={20} rx={10} fill={MATERIAL.accent} />
        <TextBars x={158} y={240} widths={[84, 60]} />
      </g>
    </>
  ),
};

const STICKER: MockupScene = {
  id: 'sticker',
  label: 'Sticker',
  description: 'A round-cornered sticker on a laptop lid with your QR code in the middle.',
  slot: { x: 160, y: 108, size: 80, transform: 'rotate(5 200 150)' },
  defaultCm: 5,
  minCm: 2,
  maxCm: 12,
  printed: true,
  Scene: ({ qr, backShift, frontShift }) => (
    <>
      <g data-layer="back" transform={backShift}>
        <rect x={-20} y={-20} width={440} height={340} fill={MATERIAL.wallShade} />
        <rect x={40} y={20} width={320} height={236} rx={14} fill={MATERIAL.metal} />
        <rect x={40} y={20} width={320} height={236} rx={14} fill="none" stroke={MATERIAL.metalShade} strokeWidth={3} />
      </g>
      <g data-layer="front" transform={frontShift}>
        <g transform="rotate(5 200 150)">
          <rect x={146} y={98} width={112} height={112} rx={16} fill={MATERIAL.shadow} opacity={0.2} />
          <rect x={142} y={92} width={112} height={112} rx={16} fill={MATERIAL.paper} />
        </g>
        {qr}
      </g>
    </>
  ),
};

/** The scenes, in the order the segmented control lists them. */
export const MOCKUP_SCENES: readonly MockupScene[] = [POSTER, CARD, TABLE_TENT, SCREEN, STICKER];

export type { MockupScene };
