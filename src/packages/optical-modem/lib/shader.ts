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

import { CHANNEL_WEIGHTS, KERNEL_MAX_SYMBOLS, SAMPLE_OFFSETS } from './kernel';

/** Vertex shader: one triangle that covers the render target, with no vertex buffer. */
export const VERTEX_SHADER = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

const glslFloat = (value: number): string => (Number.isInteger(value) ? value.toFixed(1) : String(value));

/**
 * Fragment shader of the decode kernel: one fragment is one data cell. It is a line-by-line port of
 * `sample_cell` and `classify` in `crates/modem/src/sample.rs`, and the reference kernel decides what
 * is right.
 *
 * - Pixel values and every sum, distance and confidence are integers, which are exact on a GPU.
 * - The homography uses only `+ - * /` on 32-bit floats in the same order as the reference. The
 *   GLSL ES specification does not promise IEEE rounding for `/`, and a compiler may fuse a
 *   multiply and an add, so equality is a property to be tested on each device (`selfTestGpuKernel`),
 *   not one the language gives.
 *
 * Outputs: attachment 0 holds the symbol and the confidence, attachment 1 the mean colour.
 */
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uImage;
uniform float uH[9];
uniform int uRowOffset;
uniform int uSymbols;
uniform ivec3 uPalette[${KERNEL_MAX_SYMBOLS}];

layout(location = 0) out uvec4 oSymbol;
layout(location = 1) out uvec4 oMean;

const float OFFSETS[3] = float[3](${SAMPLE_OFFSETS.map(glslFloat).join(', ')});
const ivec3 WEIGHTS = ivec3(${CHANNEL_WEIGHTS.join(', ')});
const int INT_MAX_VALUE = 2147483647;

void main() {
  ivec2 size = textureSize(uImage, 0);
  vec2 limit = vec2(float(size.x - 1), float(size.y - 1));
  float col = float(int(gl_FragCoord.x));
  float row = float(int(gl_FragCoord.y) + uRowOffset);
  ivec3 sum = ivec3(0);
  for (int j = 0; j < 3; j++) {
    float v = row + OFFSETS[j];
    for (int i = 0; i < 3; i++) {
      float u = col + OFFSETS[i];
      float w = (uH[6] * u + uH[7] * v) + 1.0;
      float x = ((uH[0] * u + uH[1] * v) + uH[2]) / w;
      float y = ((uH[3] * u + uH[4] * v) + uH[5]) / w;
      ivec2 p = ivec2(floor(clamp(vec2(x, y), vec2(0.0), limit)));
      vec3 texel = texelFetch(uImage, p, 0).rgb;
      sum += ivec3(texel * 255.0 + 0.5);
    }
  }
  ivec3 mean = (sum + 4) / 9;

  int best = 0;
  int bestDistance = INT_MAX_VALUE;
  int second = INT_MAX_VALUE;
  for (int s = 0; s < ${KERNEL_MAX_SYMBOLS}; s++) {
    if (s >= uSymbols) break;
    ivec3 d = mean - uPalette[s];
    int distance = WEIGHTS.x * d.x * d.x + WEIGHTS.y * d.y * d.y + WEIGHTS.z * d.z * d.z;
    if (distance < bestDistance) {
      second = bestDistance;
      bestDistance = distance;
      best = s;
    } else if (distance < second) {
      second = distance;
    }
  }
  int confidence = (255 * (second - bestDistance)) / (second + bestDistance + 1);
  oSymbol = uvec4(uint(best), uint(confidence), 0u, 0u);
  oMean = uvec4(uvec3(mean), 0u);
}
`;
