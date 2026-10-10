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

/**
 * Props for the SanitizedHtml component.
 */
export interface SanitizedHtmlProps {
  /** The HTML string to render safely. */
  html: string;
  /** Optional class name to apply to the wrapper element. */
  className?: string;
  /** Optional id of the wrapper element. */
  id?: string;
  /** The HTML tag to use for the wrapper element. Defaults to 'div'. */
  as?: 'div' | 'span' | 'section' | 'article';
}

/**
 * Renders HTML that the build produced from the repository's own Markdown (the /security page's
 * docs). It does not sanitize: never pass it user input, scanned text or anything read at run
 * time from outside the build. `tests/xss_sink_inventory.test.ts` keeps it to that one page.
 * @param props - The component props.
 * @param props.html - Build-time HTML.
 * @param props.className - CSS class name for styling.
 * @param props.id - Optional id of the wrapper element.
 * @param props.as - The tag name for the wrapper element.
 * @returns The wrapper element holding the HTML.
 */
export const SanitizedHtml: React.FC<SanitizedHtmlProps> = ({
  html,
  className,
  id,
  as: Component = 'div',
}) => {
  return (
    <Component
      id={id}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
