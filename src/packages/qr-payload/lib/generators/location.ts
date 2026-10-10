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

import { LocationData, QRType, QRGeneratorContract } from '@/types';
import { identifyProtocol, PLAIN_GEO_URI } from '../protocol';

/** Which coordinate a value is: latitude takes N/S, longitude takes E/W. */
export type CoordinateAxis = 'latitude' | 'longitude';

const AXIS_LETTERS: Record<CoordinateAxis, { positive: string; negative: string }> = {
  latitude: { positive: 'N', negative: 'S' },
  longitude: { positive: 'E', negative: 'W' },
};

// A sign, whole degrees, an optional `.` or `,` fraction (phones in many locales offer a decimal
// comma), an optional degree sign and an optional hemisphere letter.
// eslint-disable-next-line security/detect-unsafe-regex -- linear: anchored, bounded digit groups and single optional characters.
const COORDINATE_PATTERN = /^([-+]?)(\d{1,3})(?:[.,](\d{1,15}))?\s?°?\s?([NSEW])?$/i;

/**
 * Reads a typed coordinate as an RFC 5870 number: `[-]digits[.digits]`, with the hemisphere
 * carried by the sign. Accepts a decimal comma and N/S/E/W letters, so `52,52` is `52.52` and
 * `74.0060W` is `-74.006`.
 * @param value - The typed coordinate.
 * @param axis - Whether the value is a latitude or a longitude (decides which letters apply).
 * @returns The coordinate as a plain decimal string, or `null` when it is not a coordinate.
 */
export const normalizeCoordinate = (value: string, axis: CoordinateAxis): string | null => {
  const match = COORDINATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, sign, whole, fraction = '', letter = ''] = match;
  const hemisphere = letter.toUpperCase();
  const letters = AXIS_LETTERS[axis];
  if (hemisphere && hemisphere !== letters.positive && hemisphere !== letters.negative) return null;
  // "-40N" says two different things about the hemisphere.
  if (hemisphere && sign) return null;

  const digits = fraction.replace(/0+$/, '');
  const magnitude = `${Number(whole)}${digits ? `.${digits}` : ''}`;
  const negative = sign === '-' || hemisphere === letters.negative;
  return negative && magnitude !== '0' ? `-${magnitude}` : magnitude;
};

const LIMITS: Record<CoordinateAxis, number> = { latitude: 90, longitude: 180 };

/**
 * Says what is wrong with a typed coordinate, for the field under it.
 * @param value - The typed coordinate.
 * @param axis - Whether the value is a latitude or a longitude.
 * @returns A sentence, or `null` when the value is empty or fine.
 */
export const coordinateError = (value: string, axis: CoordinateAxis): string | null => {
  if (!value.trim()) return null;
  const normalized = normalizeCoordinate(value, axis);
  const name = axis === 'latitude' ? 'Latitude' : 'Longitude';
  if (normalized === null) {
    const { positive, negative } = AXIS_LETTERS[axis];
    return `${name} must be a number in degrees, such as ${axis === 'latitude' ? '40.7128' : '-74.0060'} or ${axis === 'latitude' ? `40.7128 ${positive}` : `74.0060 ${negative}`}.`;
  }
  if (Math.abs(Number(normalized)) > LIMITS[axis]) {
    return `${name} must be between -${LIMITS[axis]} and ${LIMITS[axis]} degrees.`;
  }
  return null;
};

/**
 * Constructs a `geo:` URI from latitude and longitude.
 *
 * Both coordinates must read as numbers (see {@link normalizeCoordinate}); they are written as
 * plain decimals, never in exponent form.
 *
 * @param data - The location data containing latitude and longitude strings.
 * @returns A `geo:LAT,LONG` URI string, or an empty string on invalid input.
 */
export const constructLocationString = (data: LocationData): string => {
  if (!data) return '';
  const lat = normalizeCoordinate(data.latitude ?? '', 'latitude');
  const lng = normalizeCoordinate(data.longitude ?? '', 'longitude');

  if (lat === null || lng === null) return '';

  return `geo:${lat},${lng}`;
};

/**
 * Hydrates LocationData from a raw string.
 */
export const hydrateLocationData = (raw: string): LocationData => {
  const result: LocationData = {
    latitude: '',
    longitude: '',
  };

  if (!raw || typeof raw !== 'string') return result;
  const match = PLAIN_GEO_URI.exec(raw.trim());
  if (match) {
    result.latitude = match[1];
    result.longitude = match[2];
  }

  return result;
};

export const LocationContract: QRGeneratorContract<LocationData> = {
  type: QRType.LOCATION,
  construct: constructLocationString,
  hydrate: hydrateLocationData,
  matches: (raw: string) => identifyProtocol(raw) === QRType.LOCATION,
  validate: (raw: string) => {
    const violations: string[] = [];
    const { latitude, longitude } = hydrateLocationData(raw);
    const lat = latitude ? Number(latitude) : null;
    const lng = longitude ? Number(longitude) : null;

    if (lat !== null && (lat < -90 || lat > 90)) {
      violations.push('LATITUDE_OUT_OF_BOUNDS_VIOLATION');
    }
    if (lng !== null && (lng < -180 || lng > 180)) {
      violations.push('LONGITUDE_OUT_OF_BOUNDS_VIOLATION');
    }
    return violations;
  },
};
