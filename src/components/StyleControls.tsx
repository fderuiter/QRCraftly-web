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


import React, { createContext, lazy, Suspense, useContext, useState } from 'react';
import { QRConfig } from '../types';
import {
  BorderControls,
  FrameControls,
  PatternControls,
  ColorControls,
  LogoControls,
  MosaicControls,
  AdvancedControls,
  LayoutControls,
  BrandTemplateGallery
} from './style-controls';
import { Accordion, AccordionItem } from './ui/Accordion';
import { Skeleton } from './ui/Skeleton';

// The gallery draws a thumbnail of the person's QR for every look, so it loads (and draws)
// only once its section is first opened.
const StyleGallery = lazy(() => import('./style-controls/StyleGallery'));

/**
 * Appearance sections the person has expanded or collapsed during this visit. Held in memory
 * only (never persisted), so the open sections survive switching QR type without a reload.
 */
const sectionOpenState = new Map<string, boolean>([
  ['Brand Templates', true],
  ['Pattern & Colors', true]
]);

/**
 * Appearance sections a landing page asks to start expanded (for example Logo on the logo
 * page). A section the person already opened or closed this visit keeps that choice.
 */
export const PresetOpenSections = createContext<readonly string[]>([]);

/**
 * Remembers a section's expanded state for the rest of the visit.
 * @param title - Section title.
 * @returns Toggle handler for the section.
 */
const rememberSection = (title: string) => (open: boolean) => {
  sectionOpenState.set(title, open);
};

/**
 * Props for the StyleControls component.
 */
interface StyleControlsProps {
  /** The current QR code configuration. */
  config: QRConfig;
  /** Callback to update the configuration. */
  onChange: (updates: Partial<QRConfig>) => void;
}

/**
 * A component providing UI controls for styling the QR code.
 * Allows users to change patterns, colors, and upload logos.
 * Also checks and warns about low contrast ratios.
 * @param props - The component props.
 * @param props.config - The current configuration.
 * @param props.onChange - Callback to update configuration.
 * @returns The StyleControls component.
 */
const StyleControls: React.FC<StyleControlsProps> = ({ config, onChange }) => {
  const presetOpen = useContext(PresetOpenSections);
  const [galleryOpened, setGalleryOpened] = useState(false);
  return (
    <Accordion>
      {/* Brand Template Gallery */}
      <AccordionItem title="Brand Templates" headingLevel={3} defaultOpen={sectionOpenState.get('Brand Templates') ?? true} onOpenChange={rememberSection('Brand Templates')}>
        <div className="pt-1">
          <BrandTemplateGallery config={config} onChange={onChange} />
        </div>
      </AccordionItem>

      {/* Live gallery: pattern and colour looks on the person's own QR code, loaded when first opened. */}
      <AccordionItem title="Style Gallery" headingLevel={3} defaultOpen={false} onOpenChange={(open) => open && setGalleryOpened(true)}>
        <div className="pt-1">
          {galleryOpened && (
            <Suspense fallback={<Skeleton className="h-40 w-full" />}>
              <StyleGallery config={config} onChange={onChange} />
            </Suspense>
          )}
        </div>
      </AccordionItem>

      {/* Primary appearance controls: expanded by default. */}
      <AccordionItem title="Pattern & Colors" headingLevel={3} defaultOpen={sectionOpenState.get('Pattern & Colors') ?? presetOpen.includes('Pattern & Colors')} onOpenChange={rememberSection('Pattern & Colors')}>
        <div className="space-y-6 pt-1">
          <PatternControls config={config} onChange={onChange} />
          <div className="border-t border-line pt-5">
            <ColorControls config={config} onChange={onChange} />
          </div>
        </div>
      </AccordionItem>

      {/* Export layout (social media templates) and border */}
      <AccordionItem title="Layout & Border" headingLevel={3} defaultOpen={sectionOpenState.get('Layout & Border') ?? presetOpen.includes('Layout & Border')} onOpenChange={rememberSection('Layout & Border')}>
        <div className="space-y-6 pt-1">
          <LayoutControls config={config} onChange={onChange} />
          <div className="border-t border-line pt-5">
            <BorderControls config={config} onChange={onChange} />
          </div>
          <div className="border-t border-line pt-5">
            <FrameControls config={config} onChange={onChange} />
          </div>
        </div>
      </AccordionItem>

      <AccordionItem title="Logo" headingLevel={3} defaultOpen={sectionOpenState.get('Logo') ?? presetOpen.includes('Logo')} onOpenChange={rememberSection('Logo')}>
        <div className="pt-1">
          <LogoControls config={config} onChange={onChange} />
          <div className="border-t border-line pt-5">
            <MosaicControls config={config} onChange={onChange} />
          </div>
        </div>
      </AccordionItem>

      {/* Advanced Mode (error correction, maze overlay) */}
      <AdvancedControls config={config} onChange={onChange} />
    </Accordion>
  );
};

/**
 * Comparison function for React.memo.
 * Returns true if the next props are equivalent to the previous props (skipping re-render).
 * It ignores changes to 'value' and 'type' as they don't affect visual style controls.
 */
function arePropsEqual(prev: StyleControlsProps, next: StyleControlsProps) {
  // If the onChange handler changed, we must re-render
  if (prev.onChange !== next.onChange) return false;

  // Check referential equality first
  if (prev.config === next.config) return true;

  // Compare all config properties except 'value' and 'type'
  // We iterate over keys of next.config to ensure we catch any new properties
  const keys = Object.keys(next.config) as (keyof QRConfig)[];

  for (const key of keys) {
    // Skip content-related properties
    if (key === 'value' || key === 'type') continue;

    // If any style property differs, re-render
    if (prev.config[key] !== next.config[key]) {
      return false;
    }
  }

  return true;
}

export default React.memo(StyleControls, arePropsEqual);
