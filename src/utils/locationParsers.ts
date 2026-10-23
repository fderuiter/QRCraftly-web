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

function validateAndFormat(lat: number, lng: number): ParsedCoordinates | null {
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const fmt = (n: number) => {
    const v = Number(n.toFixed(6));
    return Object.is(v, -0) || v === 0 ? "0" : String(v);
  };
  return { latitude: fmt(lat), longitude: fmt(lng) };
}

function parsePair(latStr: string, lngStr: string): ParsedCoordinates | null {
  return validateAndFormat(parseFloat(latStr.replace(",", ".")), parseFloat(lngStr.replace(",", ".")));
}

function parseDms(input: string): ParsedCoordinates | null {
  const pattern =
    /(?:([NSEWnsew])\s*)?(\d+(?:[.,]\d+)?)\s*(?:°|deg|d)?\s*(?:(\d+(?:[.,]\d+)?)\s*(?:'|′|m|`)?)?\s*(?:(\d+(?:[.,]\d+)?)\s*(?:"|″|''|s)?)?\s*([NSEWnsew])?/g;
  const matches: Array<{ val: number; axis?: "lat" | "lng" }> = [];
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(input)) !== null) {
    const [, pre, degS, minS, secS, suf] = m;
    const dir = (pre || suf || "").toUpperCase();
    if (!degS || (!/[°'"`″′]|deg|d|m|s/i.test(m[0]) && !dir && !minS && !secS)) continue;

    const deg = parseFloat(degS.replace(",", "."));
    const min = minS ? parseFloat(minS.replace(",", ".")) : 0;
    const sec = secS ? parseFloat(secS.replace(",", ".")) : 0;
    if (isNaN(deg) || isNaN(min) || isNaN(sec)) continue;

    let dec = deg + min / 60 + sec / 3600;
    if (dir === "S" || dir === "W") dec = -dec;
    const axis = dir === "N" || dir === "S" ? "lat" : dir === "E" || dir === "W" ? "lng" : undefined;
    matches.push({ val: dec, axis });
  }

  if (matches.length < 2) return null;
  const latMatch = matches.find((m) => m.axis === "lat");
  const lngMatch = matches.find((m) => m.axis === "lng");
  const lat = latMatch ? latMatch.val : matches[0].val;
  const lng = lngMatch ? lngMatch.val : matches[1].val;
  return validateAndFormat(lat, lng);
}

function parseRawCoordinates(input: string): ParsedCoordinates | null {
  const pattern =
    /^\s*([-+]?\d+(?:[.,]\d+)?)\s*([NSEWnsew])?\s*[,;\s]\s*([-+]?\d+(?:[.,]\d+)?)\s*([NSEWnsew])?\s*$/i;
  const match = pattern.exec(input.trim());
  if (!match) return null;

  const [, v1, d1Str, v2, d2Str] = match;
  let n1 = parseFloat(v1.replace(",", "."));
  let n2 = parseFloat(v2.replace(",", "."));
  const d1 = (d1Str || "").toUpperCase();
  const d2 = (d2Str || "").toUpperCase();

  if (d1 === "S" || d1 === "W") n1 = -n1;
  if (d2 === "S" || d2 === "W") n2 = -n2;

  let lat = n1;
  let lng = n2;
  if ((d1 === "E" || d1 === "W") && (d2 === "N" || d2 === "S")) {
    lat = n2;
    lng = n1;
  }
  return validateAndFormat(lat, lng);
}

export function parseLocationUrl(input: string): ParsedCoordinates | null {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const m3 = /!3d([-+]?\d+(?:[.,]\d+)?)/.exec(trimmed);
  const m4 = /!4d([-+]?\d+(?:[.,]\d+)?)/.exec(trimmed);
  if (m3 && m4) {
    const res = parsePair(m3[1], m4[1]);
    if (res) return res;
  }

  const match =
    /@([-+]?\d+(?:[.,]\d+)?),([-+]?\d+(?:[.,]\d+)?)/.exec(trimmed) ||
    /^geo:([-+]?\d+(?:[.,]\d+)?),([-+]?\d+(?:[.,]\d+)?)/i.exec(trimmed);
  if (match) {
    const res = parsePair(match[1], match[2]);
    if (res) return res;
  }

  if (trimmed.includes("?") || trimmed.includes("=")) {
    try {
      let s = trimmed;
      if (s.includes("?")) s = s.substring(s.indexOf("?") + 1);
      const params = new URLSearchParams(s);
      const keys = /^(q|ll|c|center|loc|location|point|sll|cbll|near|destination|origin)$/i;
      for (const [k, v] of params.entries()) {
        if (!keys.test(k) || !v) continue;
        let val = v.trim();
        if (/^loc:/i.test(val)) val = val.slice(4).trim();
        const res = parseRawCoordinates(val) || parseDms(val);
        if (res) return res;
      }
    } catch {
      // Ignore query parsing errors (e.g. malformed URIs) and continue to fallback parsers
    }
  }

  return parseDms(trimmed) || parseRawCoordinates(trimmed);
}
