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

export interface ParsedCoordinates {
  latitude: string;
  longitude: string;
}

const LATITUDE_LIMIT = 90;
const LONGITUDE_LIMIT = 180;

/**
 * Validates latitude and longitude numbers and formats them as plain decimal strings.
 * Rounds to max 6 decimal places (~10 cm precision) and avoids exponent notation.
 */
function validateAndFormat(latNum: number, lngNum: number): ParsedCoordinates | null {
  if (isNaN(latNum) || isNaN(lngNum) || !isFinite(latNum) || !isFinite(lngNum)) {
    return null;
  }
  if (Math.abs(latNum) > LATITUDE_LIMIT || Math.abs(lngNum) > LONGITUDE_LIMIT) {
    return null;
  }

  const formatCoord = (num: number): string => {
    const val = Number(num.toFixed(6));
    return Object.is(val, -0) || val === 0 ? "0" : String(val);
  };

  return {
    latitude: formatCoord(latNum),
    longitude: formatCoord(lngNum),
  };
}

/**
 * Parses DMS (Degrees, Minutes, Seconds) or DMM (Degrees, Decimal Minutes) strings.
 * Examples:
 *  - 40°42'46"N 74°00'21"W
 *  - 40° 42' 46.0" N, 74° 00' 21.0" W
 *  - 40°42.766'N, 74°0.35'W
 *  - N 40° 42' 46", W 74° 00' 21"
 */
function parseDms(input: string): ParsedCoordinates | null {
  const dmsPattern =
    /(?:([NSEWnsew])\s*)?(\d+(?:[.,]\d+)?)\s*(?:°|deg|d)?\s*(?:(\d+(?:[.,]\d+)?)\s*(?:'|′|m|`)?)?\s*(?:(\d+(?:[.,]\d+)?)\s*(?:"|″|''|s)?)?\s*([NSEWnsew])?/g;

  const matches: Array<{ value: number; axis?: "latitude" | "longitude" }> = [];
  let match: RegExpExecArray | null;

  while ((match = dmsPattern.exec(input)) !== null) {
    const [, dirPrefix, degStr, minStr, secStr, dirSuffix] = match;
    const dir = (dirPrefix || dirSuffix || "").toUpperCase();
    const hasDmsSymbols = /[°'"`″′]|deg|d|m|s/i.test(match[0]) || Boolean(dir);

    if (!degStr || (!hasDmsSymbols && !minStr && !secStr)) {
      continue;
    }

    const deg = parseFloat(degStr.replace(",", "."));
    const min = minStr ? parseFloat(minStr.replace(",", ".")) : 0;
    const sec = secStr ? parseFloat(secStr.replace(",", ".")) : 0;

    if (isNaN(deg) || isNaN(min) || isNaN(sec)) continue;

    let decimal = deg + min / 60 + sec / 3600;
    if (dir === "S" || dir === "W") {
      decimal = -decimal;
    }

    let axis: "latitude" | "longitude" | undefined;
    if (dir === "N" || dir === "S") {
      axis = "latitude";
    } else if (dir === "E" || dir === "W") {
      axis = "longitude";
    }

    matches.push({ value: decimal, axis });
  }

  if (matches.length < 2) return null;

  let latNum: number | undefined;
  let lngNum: number | undefined;

  const latMatch = matches.find((m) => m.axis === "latitude");
  const lngMatch = matches.find((m) => m.axis === "longitude");

  if (latMatch && lngMatch) {
    latNum = latMatch.value;
    lngNum = lngMatch.value;
  } else {
    latNum = matches[0].value;
    lngNum = matches[1].value;
  }

  if (latNum === undefined || lngNum === undefined) return null;
  return validateAndFormat(latNum, lngNum);
}

/**
 * Extracts coordinate pair from a string like "40.7128, -74.0060" or "40.7128N, 74.0060W"
 */
function parseRawCoordinates(input: string): ParsedCoordinates | null {
  const pattern =
    /^\s*([-+]?\d+(?:[.,]\d+)?)\s*([NSEWnsew])?\s*[,;\s]\s*([-+]?\d+(?:[.,]\d+)?)\s*([NSEWnsew])?\s*$/i;
  const match = pattern.exec(input.trim());
  if (!match) return null;

  const [, val1Str, dir1Str, val2Str, dir2Str] = match;
  let num1 = parseFloat(val1Str.replace(",", "."));
  let num2 = parseFloat(val2Str.replace(",", "."));

  const dir1 = (dir1Str || "").toUpperCase();
  const dir2 = (dir2Str || "").toUpperCase();

  if (dir1 === "S" || dir1 === "W") num1 = -num1;
  if (dir2 === "S" || dir2 === "W") num2 = -num2;

  let latNum = num1;
  let lngNum = num2;

  if ((dir1 === "E" || dir1 === "W") && (dir2 === "N" || dir2 === "S")) {
    latNum = num2;
    lngNum = num1;
  }

  return validateAndFormat(latNum, lngNum);
}

/**
 * Extracts coordinates from query parameters or search string.
 */
function parseQueryParams(queryString: string): ParsedCoordinates | null {
  let searchStr = queryString;
  if (searchStr.includes("?")) {
    searchStr = searchStr.substring(searchStr.indexOf("?") + 1);
  }

  const params = new URLSearchParams(searchStr);
  const keysToTry = [
    "q",
    "ll",
    "c",
    "center",
    "loc",
    "location",
    "point",
    "sll",
    "cbll",
    "near",
    "destination",
    "origin",
  ];

  for (const key of keysToTry) {
    const rawVal = params.get(key);
    if (!rawVal) continue;

    let val = decodeURIComponent(rawVal).trim();
    if (val.toLowerCase().startsWith("loc:")) {
      val = val.substring(4).trim();
    }

    const rawResult = parseRawCoordinates(val);
    if (rawResult) return rawResult;

    const dmsResult = parseDms(val);
    if (dmsResult) return dmsResult;
  }

  return null;
}

/**
 * Parses a Google Maps URL, geo: URI, DMS string, or raw coordinates into latitude and longitude.
 *
 * @param input - The pasted or typed input string.
 * @returns Validated ParsedCoordinates object, or null if unparseable or out-of-bounds.
 */
export function parseLocationUrl(input: string): ParsedCoordinates | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Strategy 1: Google Maps Place Pin (!3d<lat>!4d<lng> or !4d<lng>!3d<lat>)
  const match3d = /!3d([-+]?\d+(?:[.,]\d+)?)/.exec(trimmed);
  const match4d = /!4d([-+]?\d+(?:[.,]\d+)?)/.exec(trimmed);
  if (match3d && match4d) {
    const lat = parseFloat(match3d[1].replace(",", "."));
    const lng = parseFloat(match4d[1].replace(",", "."));
    const result = validateAndFormat(lat, lng);
    if (result) return result;
  }

  // Strategy 2: Google Maps Viewport Path (/@<lat>,<lng>)
  const viewportMatch = /@([-+]?\d+(?:[.,]\d+)?),([-+]?\d+(?:[.,]\d+)?)/.exec(trimmed);
  if (viewportMatch) {
    const lat = parseFloat(viewportMatch[1].replace(",", "."));
    const lng = parseFloat(viewportMatch[2].replace(",", "."));
    const result = validateAndFormat(lat, lng);
    if (result) return result;
  }

  // Strategy 3: geo: URI (geo:<lat>,<lng>)
  const geoMatch = /^geo:([-+]?\d+(?:[.,]\d+)?),([-+]?\d+(?:[.,]\d+)?)/i.exec(trimmed);
  if (geoMatch) {
    const lat = parseFloat(geoMatch[1].replace(",", "."));
    const lng = parseFloat(geoMatch[2].replace(",", "."));
    const result = validateAndFormat(lat, lng);
    if (result) return result;
  }

  // Strategy 4: Query parameters from URL
  if (trimmed.includes("?") || trimmed.includes("=")) {
    const queryResult = parseQueryParams(trimmed);
    if (queryResult) return queryResult;
  }

  // Strategy 5: DMS / DMM strings
  const dmsResult = parseDms(trimmed);
  if (dmsResult) return dmsResult;

  // Strategy 6: Raw coordinates e.g. "40.7128, -74.0060"
  const rawResult = parseRawCoordinates(trimmed);
  if (rawResult) return rawResult;

  return null;
}
