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

import { useState, useRef, useEffect, type ElementType } from "react";
import { type QRConfig, QRType } from "@/packages/core/types";
import { INPUT_REGISTRY, constructInput, hydrateInput, validateInput, type InputDataMap, type InputProps } from "./InputRegistry";
import { usePresetLogoPlacement } from "./usePresetLogoPlacement";

/** Quiet time in milliseconds that ends a burst of typing; a burst is written when it pauses. */
const COMMIT_DELAY_MS = 100;

/** Form data per QR type; a type with no entry has not been touched. */
type InputStates = { [K in QRType]?: InputDataMap[K] };

/** Stores one type's form data, keeping the key and the data's type tied together. */
const withState = <K extends QRType>(states: InputStates, type: K, data: InputDataMap[K]): InputStates => ({ ...states, [type]: data });

/** A type's form data, or its starting state when the form has not been touched. */
const stateFor = <K extends QRType>(states: InputStates, type: K): InputDataMap[K] => states[type] ?? INPUT_REGISTRY[type].initialState;

/**
 * Module-scoped cache for uncommitted form field values in volatile memory.
 * Preserves user text across generator route switches without persisting to storage.
 */
let retainedInputStates: InputStates = {};

/**
 * Forgets input states retained from earlier generator routes.
 */
export function clearRetainedInputStates(): void {
  retainedInputStates = {};
}

/**
 * Hook to encapsulate the state management and component selection logic for the InputPanel.
 * It maintains the state for each input type so that data is preserved when switching types.
 * @param config - The current QR configuration.
 * @param onChange - Callback to update the configuration.
 * @param onRefusedChange - Told whether the form now holds a value it refuses to encode. The
 *   config keeps the last accepted content meanwhile, so the preview must not show it (#1279).
 * @returns An object containing the component to render and its props.
 */
export function useInputLogic(
  config: Pick<QRConfig, 'type' | 'value'>,
  onChange: (updates: Partial<QRConfig>) => void,
  onRefusedChange?: (refused: boolean) => void,
): { InputComponent: ElementType; inputProps: InputProps<QRType>; flush: () => void } {
  usePresetLogoPlacement(config.type);
  // Initialize state for all types from registry or volatile retained cache
  const [inputStates, setInputStates] = useState<InputStates>(() => {
    let states: InputStates = {};
    for (const key of Object.values(QRType)) {
      const retained = retainedInputStates[key];
      if (retained !== undefined) {
        states = withState(states, key, { ...retained });
      } else if (key === config.type && config.value) {
        // Initial config values (e.g. from the URL or defaults) are reflected in the inputs.
        try {
          const hydrated = hydrateInput(key, config.value);
          if (hydrated) states = withState(states, key, hydrated);
        } catch (e) {
          console.warn(`Failed to hydrate state for ${key}`, e);
        }
      }
    }
    return states;
  });

  const latestInputStates = useRef(inputStates);
  useEffect(() => {
    latestInputStates.current = inputStates;
  }, [inputStates]);
  const onRefusedChangeRef = useRef(onRefusedChange);
  useEffect(() => {
    onRefusedChangeRef.current = onRefusedChange;
  }, [onRefusedChange]);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The debounced write waiting in timeoutRef, so flush() can apply it immediately.
  const pendingCommitRef = useRef<(() => void) | null>(null);
  const prevTypeRef = useRef<QRType | null>(null);
  // When the last edit was written, so an edit after a quiet spell is written at once.
  const lastEditAtRef = useRef(Number.NEGATIVE_INFINITY);

  // Synchronize input states reactively when config changes externally (e.g., undo/redo or preset loaded)
  useEffect(() => {
    const prevType = prevTypeRef.current;
    prevTypeRef.current = config.type;

    const currentLocalState = stateFor(latestInputStates.current, config.type);
    if (prevType !== config.type) {
      // A form kept from an earlier visit to this type may still hold a refused value.
      onRefusedChangeRef.current?.(validateInput(config.type, currentLocalState) !== null);
    }
    const currentConstructed = constructInput(config.type, currentLocalState);

    if (currentConstructed !== config.value) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      pendingCommitRef.current = null;

      // If we switched types, or on initial mount where retained state exists for this type:
      // Preserve local retained state and push its constructed value to global state.
      if (retainedInputStates[config.type] !== undefined && (prevType !== config.type || prevType === null)) {
        onChange({ value: currentConstructed });
        return;
      }

      // If we switched types, and the target type has a non-empty local state,
      // and the incoming config.value is empty (usually from tab select),
      // then preserve the local state and push its constructed value to the global state.
      if (prevType !== null && prevType !== config.type && config.value === '' && currentConstructed !== '') {
        onChange({ value: currentConstructed });
        return;
      }

      const updateStateForType = <K extends QRType>(type: K, nextData: InputDataMap[K]) => {
        setInputStates((prev) => {
          if (JSON.stringify(stateFor(prev, type)) === JSON.stringify(nextData)) {
            return prev;
          }
          return withState(prev, type, nextData);
        });
      };

      // The form now shows the new content, which was never refused.
      onRefusedChangeRef.current?.(false);
      try {
        const hydrated = hydrateInput(config.type, config.value);
        if (hydrated) {
          updateStateForType(config.type, hydrated);
          retainedInputStates = withState(retainedInputStates, config.type, hydrated);
        } else {
          updateStateForType(config.type, INPUT_REGISTRY[config.type].initialState);
        }
      } catch (e) {
        console.warn(`Failed to hydrate state for ${config.type} on external change`, e);
        updateStateForType(config.type, INPUT_REGISTRY[config.type].initialState);
      }
    }
  }, [config.type, config.value, onChange]);

  // Clear timeout if type changes to prevent race conditions (simulating unmount of previous input)
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      pendingCommitRef.current = null;
    };
  }, [config.type]);

  // Generic handler for all inputs
  const handleInputChange = <K extends QRType>(
    type: K,
    updates: Partial<InputDataMap[K]>,
  ) => {
    const newData: InputDataMap[K] = { ...stateFor(inputStates, type), ...updates };

    setInputStates((prev) => withState(prev, type, newData));
    retainedInputStates = withState(retainedInputStates, type, newData);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const commit = () => {
      timeoutRef.current = null;
      pendingCommitRef.current = null;
      const valid = validateInput(type, newData) === null;
      if (valid) {
        onChange({ value: constructInput(type, newData) });
      }
      // A refused value is not written, so the store keeps the last accepted content; the
      // flag stops the preview and exports using it until the field is fixed (#1279).
      onRefusedChangeRef.current?.(!valid);
    };
    // A first edit after a quiet spell goes straight to the preview, in the same render as the
    // field; only a burst of typing is held back until it pauses.
    const now = performance.now();
    const quiet = now - lastEditAtRef.current >= COMMIT_DELAY_MS;
    lastEditAtRef.current = now;
    if (quiet) {
      commit();
      return;
    }
    pendingCommitRef.current = commit;
    timeoutRef.current = setTimeout(commit, COMMIT_DELAY_MS);
  };

  // Applies a pending debounced edit now, so an action taken right after typing (for example
  // a button that reads the store) sees the latest content.
  const flush = () => {
    const commit = pendingCommitRef.current;
    if (!commit) return;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    commit();
  };

  return {
    InputComponent: INPUT_REGISTRY[config.type].Component,
    inputProps: {
      data: stateFor(inputStates, config.type),
      onChange: (updates) => handleInputChange(config.type, updates),
    },
    flush,
  };
}
