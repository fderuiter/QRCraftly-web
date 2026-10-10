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

import { QRConfig, QRType } from '@/types';
import {
  REGEX_STRICT_CONTROL_CHARS,
  REGEX_PRESERVE_FORMAT_CONTROL_CHARS,
  REGEX_BIDI_CONTROL_CHARS,
} from '@/utils/security';
import { CONTAINMENT_PROFILES, identifyProtocol } from './protocol';
import { validatePayload } from './registry';

/**
 * Performs full-scale validation on a complete QR configuration profile.
 *
 * @param config - The QR code generation configuration profile.
 * @returns An array of security or structure violations.
 */
export function validateConfig(config: QRConfig): string[] {
  const violations: string[] = [];

  // 1. Mandatory validation step for rendering sinks (borders, templates)
  const checkTextSink = (str: string | undefined, field: string) => {
    if (str && CONTAINMENT_PROFILES.TEXT_NO_CONTROL.test(str)) {
      violations.push(`${field} contains invalid control or zero-width characters`);
    } else if (str && CONTAINMENT_PROFILES.BIDI_CONTROL.test(str)) {
      violations.push(`${field} contains hidden text-direction characters`);
    }
  };

  checkTextSink(config.borderText, 'Border Text');
  checkTextSink(config.templateHeadline, 'Template Headline');
  checkTextSink(config.templateSubtext, 'Template Subtext');
  checkTextSink(config.frameText, 'Frame Text');

  // 2. Validate QR payload against containment profiles & generator validators
  if (config.value) {
    const payloadViolations = validatePayload(config.value, config.type);
    violations.push(...payloadViolations);
  }

  return violations;
}

/**
 * Sanitizes all text-based fields inside a QR configuration by stripping control characters.
 * Design text loses every control character; the payload keeps tabs and line breaks.
 *
 * @param config - The original QR configuration object.
 * @returns A sanitized clone of the QR configuration.
 */
export function sanitizeConfig(config: QRConfig): QRConfig {
  const clean = { ...config };
  const stripText = (text: string) => text.replace(REGEX_STRICT_CONTROL_CHARS, '').replace(REGEX_BIDI_CONTROL_CHARS, '');
  if (clean.borderText) clean.borderText = stripText(clean.borderText);
  if (clean.templateHeadline) clean.templateHeadline = stripText(clean.templateHeadline);
  if (clean.templateSubtext) clean.templateSubtext = stripText(clean.templateSubtext);
  if (clean.frameText) clean.frameText = stripText(clean.frameText);
  if (clean.value) {
    const type = clean.type || identifyProtocol(clean.value);
    // Tabs and line breaks are content for every type (a multi-line Text code, #1269), matching
    // what validatePayload accepts; every other C0 and C1 control is removed.
    clean.value = clean.value.replace(REGEX_PRESERVE_FORMAT_CONTROL_CHARS, '');
    if (type === QRType.WIFI || type === QRType.PHONE || type === QRType.SMS) {
      clean.value = clean.value.replace(REGEX_BIDI_CONTROL_CHARS, '');
    }
  }
  return clean;
}
