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

import type { QRConfig } from '@/packages/core/types';

/**
 * Represents a brand design template containing visual styling properties.
 */
export interface BrandTemplate {
  /** Unique identifier for the template. */
  id: string;
  /** User-friendly name of the template. */
  name: string;
  /** Optional description or category label. */
  description?: string;
  /** ISO timestamp when template was created. */
  createdAt?: string;
  /** ISO timestamp when template was last updated. */
  updatedAt?: string;
  /** Indicates whether this is a system pre-built template preset. */
  isPrebuilt?: boolean;
  /** Partial QRConfig containing visual style fields only. */
  config: Partial<QRConfig>;
}

/**
 * The standard structure for brand template export/import JSON files.
 */
export interface BrandTemplateExportPayload {
  version: string;
  type: 'qrcraftly-brand-template';
  template: BrandTemplate;
}
