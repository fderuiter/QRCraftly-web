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

import React from 'react';
import QRTool from '@/components/QRTool';
import { DEFAULT_CONFIG } from '@/constants';
import { QRType, type QRConfig } from '@/types';
import { PresetOpenSections } from '@/components/StyleControls';
import { JsonLdScript } from '@/components/ui/JsonLdScript';
import { PageCopyContext } from '@/data/copy/PageCopyContext';
import type { ToolCopy } from '@/data/copy/types';

interface QRTypePageProps {
  /** The QR code type to pre-select. */
  type: QRType;
  /** The title to display in the QRTool header. */
  title: string;
  /** The structured data (JSON-LD) object to inject. */
  schemaData: unknown;
  /** The tool ID for loading content. */
  toolId: string;
  /** The page's how-to steps and FAQs, which its content section shows. */
  copy?: ToolCopy;
  /** Settings a landing page asks for; they win over appearance kept from earlier routes. */
  presetConfig?: Partial<QRConfig>;
  /** Appearance sections that start expanded. */
  openSections?: readonly string[];
}

/** Copy used when a page has none of its own. */
const NO_COPY: ToolCopy = {};

/** Appearance sections that start expanded when a page asks for none. */
const NO_SECTIONS: readonly string[] = [];

/**
 * A reusable page component for specific QR code type landing pages.
 * It sets up the QRTool with the correct type and injects the provided schema.org data.
 */
export const QRTypePage: React.FC<QRTypePageProps> = ({ type, title, schemaData, toolId, copy, presetConfig, openSections = NO_SECTIONS }) => {
  const config = {
    ...DEFAULT_CONFIG,
    type,
  };

  return (
    <>
      <JsonLdScript data={schemaData} />
      <PageCopyContext.Provider value={copy ?? NO_COPY}>
        <PresetOpenSections.Provider value={openSections}>
          <QRTool initialConfig={config} presetConfig={presetConfig} title={title} toolId={toolId} />
        </PresetOpenSections.Provider>
      </PageCopyContext.Provider>
    </>
  );
};

