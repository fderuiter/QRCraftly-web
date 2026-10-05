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

import React, { useEffect, useState } from 'react';
import './index.css';
import { ToastProvider } from '../components/ui/Toast';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ThemeProvider } from '../context/ThemeContext';
import { ServiceWorkerUpdatePrompt } from '../components/ServiceWorkerUpdatePrompt';
import { AppShell } from '../components/AppShell';
import { PageContentContext } from '../data/PageContentContext';
import type { PageContent } from '../data/pageContent';
import { usePageContext } from 'vike-react/usePageContext';

/**
 * LayoutDefault Component
 *
 * Provides the default layout for every route: theme and toast providers, the service worker
 * update prompt and the single app shell (header, main landmark, footer).
 * @param props - The component props.
 * @param props.children - The child components to render within the layout.
 * @returns The layout wrapper.
 */
export default function LayoutDefault({ children }: { children: React.ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  // The page's own content from the global `+data` hook (#1058).
  const content = (usePageContext()?.data as PageContent | undefined) ?? null;
  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <PageContentContext.Provider value={content}>
    <ThemeProvider>
    <ToastProvider>
      <ServiceWorkerUpdatePrompt enabled={!import.meta.env.DEV} />
      <AppShell hydrated={hydrated}>
        <ErrorBoundary>{children}</ErrorBoundary>
      </AppShell>
    </ToastProvider>
    </ThemeProvider>
    </PageContentContext.Provider>
  );
}
