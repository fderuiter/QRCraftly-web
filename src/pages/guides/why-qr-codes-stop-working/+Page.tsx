/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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

import { GuideArticle } from '@/components/GuideArticle';
import { getGuide } from '@/data/guides';

const guide = getGuide('why-qr-codes-stop-working');

/**
 * The guide at /guides/why-qr-codes-stop-working.
 * @returns The page.
 */
export default function Page() {
  return guide ? <GuideArticle guide={guide} /> : null;
}
