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

import type { VCardData } from "../../types";
import { hydrateVCardData, CARD_FIELDS } from "@/packages/qr-payload";
import { announcePolitely } from "../../utils/a11y";

export interface VCardImportResult {
  updates?: Partial<VCardData>;
  error?: string;
}

const MAX_FILE_SIZE = 256 * 1024;

/**
 * Parses a .vcf or .vcard file and returns updated vCard field values.
 * Extracted into a code-split module to keep initial page bundle sizes within budget.
 */
export async function processVCardFile(file: File): Promise<VCardImportResult> {
  if (file.size > MAX_FILE_SIZE) {
    return { error: "File size exceeds 256 KB limit." };
  }

  const text = (await file.text().catch(() => "")).trim();
  const isVCard = /begin:vcard/i.test(text);
  const isMECard = /^mecard:/i.test(text);

  if (!isVCard && !isMECard) {
    return { error: "Invalid vCard file. Missing BEGIN:VCARD header." };
  }

  const hydrated = hydrateVCardData(text);
  const updates: Partial<VCardData> = {};

  for (const field of CARD_FIELDS) {
    const val = hydrated[field];
    if (typeof val === "string" && val.trim()) {
      updates[field] = val;
    }
  }

  if (isMECard) {
    updates.version = "mecard";
  } else {
    const versionMatch = text.match(/VERSION:\s*(2\.1|3\.0|4\.0)/i);
    if (versionMatch) {
      const ver = versionMatch[1];
      if (ver === "2.1" || ver === "3.0" || ver === "4.0") {
        updates.version = ver;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    announcePolitely("vCard contact details imported");
    return { updates };
  } else {
    return { error: "No contact details found in vCard file." };
  }
}
