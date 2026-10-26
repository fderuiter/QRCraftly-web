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

/* eslint-disable react/no-danger */

import React from 'react';
import { safeJsonLdStringify } from '@/packages/core/security';
import { reviewedHtml } from '@/packages/core/trustedTypes';

/**
 * Props for the JsonLdScript component.
 */
export interface JsonLdScriptProps {
  /** The structured data object to serialize and inject as JSON-LD. */
  data: unknown;
}

/**
 * A dedicated, centralized wrapper component for safely injecting JSON-LD metadata.
 * This ensures dynamic schema script injection is isolated and properly escaped.
 * @param props - The component props.
 * @param props.data - The structured data object.
 * @returns The rendered script tag containing safely serialized JSON-LD.
 */
export const JsonLdScript: React.FC<JsonLdScriptProps> = ({ data }) => {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: reviewedHtml(safeJsonLdStringify(data)) }}
    />
  );
};
