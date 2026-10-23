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

import { describe, it, expect } from "vitest";
import { parseLocationUrl } from "./locationParsers";

describe("locationParsers utility", () => {
  describe("Google Maps place pin links (!3d & !4d)", () => {
    it("extracts place pin coordinates when !3d and !4d are present in data param", () => {
      const url =
        "https://www.google.com/maps/place/Statue+of+Liberty/@40.6892494,-74.0466891,17z/data=!3m1!4b1!4m6!3m5!1s0x89c25090129c363d:0x40c6a5770d25022b!8m2!3d40.6892494!4d-74.0445004!16z%2Fg%2F11bc5bfm_p";
      const result = parseLocationUrl(url);
      expect(result).toEqual({
        latitude: "40.689249",
        longitude: "-74.0445",
      });
    });

    it("handles !3d and !4d with comma decimal separators", () => {
      const url = "https://maps.google.com/?data=!3d52,520000!4d13,405000";
      const result = parseLocationUrl(url);
      expect(result).toEqual({
        latitude: "52.52",
        longitude: "13.405",
      });
    });
  });

  describe("Google Maps viewport path (/@lat,lng)", () => {
    it("extracts coordinates from @lat,lng path", () => {
      const url = "https://www.google.com/maps/@40.7128,-74.0060,15z";
      const result = parseLocationUrl(url);
      expect(result).toEqual({
        latitude: "40.7128",
        longitude: "-74.006",
      });
    });

    it("handles southern and western hemisphere negative coordinates in viewport path", () => {
      const url = "https://www.google.com/maps/@-33.8688197,151.2092955,12z";
      const result = parseLocationUrl(url);
      expect(result).toEqual({
        latitude: "-33.86882",
        longitude: "151.209295",
      });
    });
  });

  describe("Google Maps query parameters (?q=, ?ll=, etc.)", () => {
    it("extracts coordinates from ?q= parameter", () => {
      const url = "https://maps.google.com/?q=40.7128,-74.0060";
      const result = parseLocationUrl(url);
      expect(result).toEqual({
        latitude: "40.7128",
        longitude: "-74.006",
      });
    });

    it("extracts coordinates from ?q=loc: parameter", () => {
      const url = "https://www.google.com/maps?q=loc:51.5074,-0.1278";
      const result = parseLocationUrl(url);
      expect(result).toEqual({
        latitude: "51.5074",
        longitude: "-0.1278",
      });
    });

    it("extracts coordinates from ?ll= parameter", () => {
      const url = "https://maps.google.com/?ll=35.6762,139.6503";
      const result = parseLocationUrl(url);
      expect(result).toEqual({
        latitude: "35.6762",
        longitude: "139.6503",
      });
    });

    it("extracts coordinates from URL-encoded ?q= parameter containing DMS string", () => {
      const url = "https://maps.google.com/?q=40%C2%B042%2746%22N+74%C2%B000%2721%22W";
      const result = parseLocationUrl(url);
      expect(result).toEqual({
        latitude: "40.712778",
        longitude: "-74.005833",
      });
    });
  });

  describe("geo: URIs", () => {
    it("extracts coordinates from plain geo: URI", () => {
      const result = parseLocationUrl("geo:37.7749,-122.4194");
      expect(result).toEqual({
        latitude: "37.7749",
        longitude: "-122.4194",
      });
    });

    it("extracts coordinates from geo: URI with extra parameters", () => {
      const result = parseLocationUrl("geo:51.5074,-0.1278;crs=wgs84;u=35");
      expect(result).toEqual({
        latitude: "51.5074",
        longitude: "-0.1278",
      });
    });
  });

  describe("DMS (Degrees Minutes Seconds) strings", () => {
    it("parses DMS string with N and W indicators", () => {
      const result = parseLocationUrl('40°42\'46"N 74°00\'21"W');
      expect(result).toEqual({
        latitude: "40.712778",
        longitude: "-74.005833",
      });
    });

    it("parses DMS string with decimal seconds and commas", () => {
      const result = parseLocationUrl('40°42\'46.0"N, 74°00\'21.0"W');
      expect(result).toEqual({
        latitude: "40.712778",
        longitude: "-74.005833",
      });
    });

    it("parses DMM (Degrees Decimal Minutes) string", () => {
      const result = parseLocationUrl("40°42.766'N 74°0.35'W");
      expect(result).toEqual({
        latitude: "40.712767",
        longitude: "-74.005833",
      });
    });
  });

  describe("Raw coordinates", () => {
    it("parses raw comma-separated decimal coordinates", () => {
      const result = parseLocationUrl("40.7128, -74.0060");
      expect(result).toEqual({
        latitude: "40.7128",
        longitude: "-74.006",
      });
    });

    it("parses raw space-separated decimal coordinates", () => {
      const result = parseLocationUrl("40.7128 -74.0060");
      expect(result).toEqual({
        latitude: "40.7128",
        longitude: "-74.006",
      });
    });

    it("parses decimal coordinates with hemisphere letters", () => {
      const result = parseLocationUrl("40.7128N, 74.0060W");
      expect(result).toEqual({
        latitude: "40.7128",
        longitude: "-74.006",
      });
    });
  });

  describe("Invalid inputs & edge cases", () => {
    it("returns null for empty or whitespace string", () => {
      expect(parseLocationUrl("")).toBeNull();
      expect(parseLocationUrl("   ")).toBeNull();
    });

    it("returns null for non-string or null input", () => {
      // @ts-expect-error Testing runtime invalid argument
      expect(parseLocationUrl(null)).toBeNull();
      // @ts-expect-error Testing runtime invalid argument
      expect(parseLocationUrl(undefined)).toBeNull();
    });

    it("returns null for out-of-bounds latitude (> 90)", () => {
      expect(parseLocationUrl("95.1234, -74.0060")).toBeNull();
      expect(parseLocationUrl("https://maps.google.com/?q=95.1234,-74.0060")).toBeNull();
    });

    it("returns null for out-of-bounds longitude (> 180)", () => {
      expect(parseLocationUrl("40.7128, 185.1234")).toBeNull();
    });

    it("returns null for short URLs without embedded coordinates", () => {
      expect(parseLocationUrl("https://maps.app.goo.gl/ABCDEF123")).toBeNull();
    });

    it("returns null for arbitrary text", () => {
      expect(parseLocationUrl("Hello World")).toBeNull();
      expect(parseLocationUrl("https://example.com/about")).toBeNull();
    });

    it("handles URL with a stray % without throwing URIError", () => {
      expect(() => parseLocationUrl("https://maps.google.com/?q=Cafe 100%")).not.toThrow();
      expect(parseLocationUrl("https://maps.google.com/?q=Cafe 100%")).toBeNull();
    });
  });
});
