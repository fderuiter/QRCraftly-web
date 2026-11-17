/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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

import { createMulberry32 } from '@/packages/core/math';

/**
 * Deterministic pseudo-random number generator (Mulberry32).
 * Produces uniform 32-bit floating point numbers in [0, 1).
 */
export function createPrng(seed: number): () => number {
  return createMulberry32(seed);
}

/**
 * Computes the cumulative probability distribution for the Robust Soliton distribution.
 * @param k Total number of source blocks.
 * @param c Free parameter controlling spike location (typically 0.1 to 0.2).
 * @param delta Target bound on decoding failure probability.
 * @returns An array of cumulative probabilities of length k (indices 0 to k-1 correspond to degrees 1 to k).
 */
export function buildRobustSolitonCdf(k: number, c = 0.1, delta = 0.05): Float64Array {
  if (k <= 1) {
    const cdf = new Float64Array(1);
    cdf[0] = 1.0;
    return cdf;
  }

  // 1. Ideal Soliton distribution rho(d)
  const rho = new Float64Array(k + 1);
  rho[1] = 1.0 / k;
  for (let d = 2; d <= k; d++) {
    rho[d] = 1.0 / (d * (d - 1));
  }

  // 2. Robust modification tau(d)
  const tau = new Float64Array(k + 1);
  const R = c * Math.log(k / delta) * Math.sqrt(k);
  const pivot = Math.max(1, Math.min(k, Math.floor(k / R)));

  for (let d = 1; d < pivot && d <= k; d++) {
    tau[d] = R / (d * k);
  }
  if (pivot <= k) {
    tau[pivot] = (R * Math.log(R / delta)) / k;
  }

  // 3. Normalization beta = sum(rho + tau)
  let beta = 0;
  for (let d = 1; d <= k; d++) {
    beta += rho[d] + tau[d];
  }

  // 4. Cumulative distribution table
  const cdf = new Float64Array(k);
  let cumulative = 0;
  for (let d = 1; d <= k; d++) {
    cumulative += (rho[d] + tau[d]) / beta;
    cdf[d - 1] = Math.min(1.0, cumulative);
  }
  cdf[k - 1] = 1.0; // Ensure final entry strictly bounds 1.0

  return cdf;
}

/**
 * Samples a degree from the precomputed Robust Soliton CDF using a PRNG value.
 */
export function sampleDegreeFromCdf(cdf: Float64Array, randVal: number): number {
  const k = cdf.length;
  if (k <= 1) return 1;

  // Binary search for degree (1-indexed)
  let low = 0;
  let high = k - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (cdf[mid] < randVal) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low + 1;
}

/**
 * Deterministically determines the degree and block neighbor indices for a given sequence number.
 * First K sequence numbers (1 to K) are systematic (degree 1, selecting block seq-1) to ensure
 * instantaneous reconstruction if the channel has zero loss.
 * Sequences > K sample degrees from the Robust Soliton distribution.
 *
 * @param seq Droplet sequence number (1-based integer).
 * @param k Total source block count.
 * @param cdf Optional precomputed Soliton CDF.
 */
export function getNeighborsForSeq(
  seq: number,
  k: number,
  cdf?: Float64Array
): { degree: number; indices: number[] } {
  if (k <= 1) {
    return { degree: 1, indices: [0] };
  }

  // Systematic pass for first K frames
  if (seq <= k) {
    return { degree: 1, indices: [seq - 1] };
  }

  const activeCdf = cdf ?? buildRobustSolitonCdf(k);
  const prng = createPrng(seq);
  const degree = sampleDegreeFromCdf(activeCdf, prng());

  if (degree >= k) {
    const allIndices = new Array(k);
    for (let i = 0; i < k; i++) allIndices[i] = i;
    return { degree: k, indices: allIndices };
  }

  if (degree === 1) {
    const idx = Math.floor(prng() * k);
    return { degree: 1, indices: [idx] };
  }

  // Reservoir / Knuth sample of `degree` distinct indices from [0, k-1]
  const selected = new Set<number>();
  while (selected.size < degree) {
    const candidate = Math.floor(prng() * k);
    selected.add(candidate);
  }

  return {
    degree,
    indices: Array.from(selected).sort((a, b) => a - b),
  };
}

