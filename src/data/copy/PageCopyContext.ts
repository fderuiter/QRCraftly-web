import { createContext } from 'react';
import type { ToolCopy } from './types';

/**
 * The how-to steps and FAQs of the page being rendered. Each page imports only its own copy
 * and provides it here, so the shared content registry stays metadata only.
 */
export const PageCopyContext = createContext<ToolCopy>({});
