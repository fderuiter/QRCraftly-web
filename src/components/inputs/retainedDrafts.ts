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

import type { QRType } from "@/packages/core/types";
import type { InputDataMap } from "./InputRegistry";

/** Form data per QR type; a type with no entry has not been touched. */
export type InputStates = { [K in QRType]?: InputDataMap[K] };

/**
 * Module-scoped cache for uncommitted form field values in volatile memory.
 * Preserves user text across generator route switches without persisting to storage. It lives
 * apart from `useInputLogic` so pages that only hand content over (the scanner and checker) do
 * not load the input registry.
 */
let retainedInputStates: InputStates = {};

/** The drafts retained from earlier generator routes. */
export function getRetainedInputStates(): InputStates {
  return retainedInputStates;
}

/** Replaces the retained drafts. */
export function setRetainedInputStates(states: InputStates): void {
  retainedInputStates = states;
}

/**
 * Forgets input states retained from earlier generator routes.
 */
export function clearRetainedInputStates(): void {
  retainedInputStates = {};
}

/**
 * Takes content the person chose to open in the generator, such as a scan's Edit or Open in
 * generator (#1700): the draft retained from an earlier visit to its type is dropped, so the form
 * hydrates from the incoming content instead of writing the old draft back over it. Ordinary route
 * switches, which bring no content, still restore the retained draft.
 * @param type - The incoming content's QR type.
 */
export function acceptIncomingContent(type: QRType): void {
  const { [type]: _replaced, ...others } = retainedInputStates;
  retainedInputStates = others;
}
