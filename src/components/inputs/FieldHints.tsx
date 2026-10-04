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

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import type { LinkFinding } from '@/packages/link-safety';

/** How long typing pauses before an address is read. */
const TYPING_PAUSE_MS = 500;

/** The first web address in a block of text, or an empty string. */
export function firstWebAddress(text: string): string {
  return /https?:\/\/[^\s<>"']+/i.exec(text)?.[0] ?? '';
}

/** The id a field points at with `aria-describedby` to have its hints read out. */
export const hintsId = (fieldId: string): string => `${fieldId}-hints`;

interface HintListProps {
  id: string;
  findings: readonly { code: string; severity: LinkFinding['severity']; message: string }[];
}

/** Hints shown under a field. They never block: the person can ignore every one of them. */
const HintList: React.FC<HintListProps> = ({ id, findings }) => (
  <ul id={id} className="mt-1 space-y-1 text-xs" aria-live="polite" data-testid="field-hints">
    {findings.map((finding) => (
      <li key={finding.code} className={`flex gap-1.5 ${finding.severity === 'caution' ? 'text-warning' : 'text-fg-muted'}`}>
        {finding.severity === 'caution' ? (
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        )}
        {finding.message}
      </li>
    ))}
  </ul>
);

interface LinkHintsProps {
  /** The id of the field these hints describe. Give the field `aria-describedby={hintsId(fieldId)}`. */
  fieldId: string;
  /** The web address the person typed. */
  address: string;
}

/**
 * Phishing hints under a link field (#1159): says when the address looks like a lookalike, a
 * shortener, an IP address and so on. Waits for a pause in typing and loads the analysis on
 * demand, so the generator's first load does not carry it.
 * @param props - Component properties.
 * @returns The hint list, or nothing while there is nothing to say.
 */
export const LinkHints: React.FC<LinkHintsProps> = ({ fieldId, address }) => {
  const [findings, setFindings] = useState<LinkFinding[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!address.trim()) {
      setFindings([]);
      return undefined;
    }
    const timer = setTimeout(() => {
      import('@/packages/link-safety')
        .then(({ analyseLink }) => {
          if (!cancelled) setFindings(analyseLink(address));
        })
        .catch(() => {
          if (!cancelled) setFindings([]);
        });
    }, TYPING_PAUSE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [address]);

  if (findings.length === 0) return null;
  return <HintList id={hintsId(fieldId)} findings={findings} />;
};

interface FieldNotesProps {
  fieldId: string;
  /** Plain sentences, shown as cautions. */
  notes: readonly string[];
}

/**
 * Cautions under a field that need no analysis, such as a dialer code in a phone number.
 * @param props - Component properties.
 * @returns The note list, or nothing when there are no notes.
 */
export const FieldNotes: React.FC<FieldNotesProps> = ({ fieldId, notes }) =>
  notes.length === 0 ? null : <HintList id={hintsId(fieldId)} findings={notes.map((message) => ({ code: message, severity: 'caution', message }))} />;
