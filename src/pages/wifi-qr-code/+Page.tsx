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

import { QRTypePage } from '@/components/QRTypePage';
import { QRType } from '@/types';
import { copy } from '@/data/copy/wifi-qr-code';

/**
 * WiFi QR Code Page Component
 *
 * A specialized landing page that pre-configures the `QRTool` for WiFi QR code generation.
 * This delegates page rendering and script injection to QRTypePage.
 * @returns The WiFi QR code page layout.
 */
export default function Page() {
  return <QRTypePage type={QRType.WIFI} title="WiFi QR Code" toolId="wifi-qr-code" copy={copy} />;
}
