import React from 'react';
import InputPanel from '@/components/InputPanel';
import { SidebarContent } from '@/components/SidebarContent';
import { useQRStore, useQRStoreSelector } from '@/context/QRContext';
import { SectionHeading } from '@/components/ui/SectionHeading';
import StyleControls from '@/components/StyleControls';

const ContentControl = () => {
  const store = useQRStore();
  // Select only the content slice so appearance changes do not re-render the input panel.
  const type = useQRStoreSelector(state => state.config.type);
  const value = useQRStoreSelector(state => state.config.value);
  const config = React.useMemo(() => ({ type, value }), [type, value]);
  const { updateConfig, setContentRefused } = store;
  return (
    <section>
      <SectionHeading eyebrow="Content" className="mb-4" />
      <InputPanel config={config} onChange={updateConfig} onRefusedChange={setContentRefused} />
    </section>
  );
};

/**
 * The appearance controls render with the page, so the pattern and colour pickers are in the
 * static HTML (and the first paint) instead of a placeholder that waits for hydration (#1058).
 * @returns The appearance section.
 */
const AppearanceControl = () => {
  const store = useQRStore();
  const config = useQRStoreSelector(state => state.config);
  const { updateConfig } = store;
  return (
    <section>
      <SectionHeading eyebrow="Appearance" className="mb-4" />
      <StyleControls config={config} onChange={updateConfig} />
    </section>
  );
};

const AdditionalSidebarContent = ({ toolId }: { toolId?: string }) => {
  return <SidebarContent toolId={toolId || 'index'} />;
};

/**
 * Where a generator control renders inside the shared tool workspace:
 * - `primary`: first in the control column (content entry), before the preview on mobile.
 * - `secondary`: after the preview on mobile, below the primary controls on desktop (appearance).
 * - `below`: full-width, article-width content below the workspace (how-to, FAQ).
 */
export type ControlPlacement = 'primary' | 'secondary' | 'below';

/**
 * Generator controls in render order, with their workspace placement.
 */
export const sidebarControls: Array<{ id: string; placement: ControlPlacement; component: React.ComponentType<{ toolId?: string }> }> = [
  {
    id: 'content',
    placement: 'primary',
    component: ContentControl,
  },
  {
    id: 'appearance',
    placement: 'secondary',
    component: AppearanceControl,
  },
  {
    id: 'sidebar-content',
    placement: 'below',
    component: AdditionalSidebarContent,
  },
];
