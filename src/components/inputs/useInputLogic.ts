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
import { type QRConfig, QRType, type WifiData, type VCardData, type PaymentData, type UrlData, type MeetingData, type TextData } from "../../types";
import { INPUT_REGISTRY, type InputDataMap } from "./InputRegistry";
import { isDangerousUrl } from "../../utils/security";
import { CONTAINMENT_PROFILES } from "@/packages/qr-payload";
import { findBlockingViolation } from "./linkViolations";

/** Quiet time in milliseconds that ends a burst of typing; a burst is written when it pauses. */
const COMMIT_DELAY_MS = 100;

// `type` selects which member of the data union `data` is, so the casts below follow it.
const isInputDataValid = (type: QRType, data: InputDataMap[QRType]): boolean => {
  if (type === QRType.WIFI) {
    const wifi = data as WifiData;
    if (wifi.ssid && CONTAINMENT_PROFILES.STRICT_NO_CONTROL.test(wifi.ssid)) {
      return false;
    }
    if (wifi.password && CONTAINMENT_PROFILES.STRICT_NO_CONTROL.test(wifi.password)) {
      return false;
    }
    if (wifi.eapIdentity && CONTAINMENT_PROFILES.STRICT_NO_CONTROL.test(wifi.eapIdentity)) {
      return false;
    }
  } else if (type === QRType.VCARD) {
    const vcard = data as VCardData;
    if (vcard.website && isDangerousUrl(vcard.website)) {
      return false;
    }
  } else if (type === QRType.PAYMENT) {
    const payment = data as PaymentData;
    if (payment.address && isDangerousUrl(payment.address)) {
      return false;
    }
  } else if (type === QRType.URL || type === QRType.MEETING || type === QRType.TEXT) {
    if (findBlockingViolation(type, data as UrlData | MeetingData | TextData)) {
      return false;
    }
  }
  return true;
};

/**
 * Module-scoped cache for uncommitted form field values in volatile memory.
 * Preserves user text across generator route switches without persisting to storage.
 */
let retainedInputStates: Partial<InputDataMap> = {};

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
): { InputComponent: ElementType | null; inputProps: { data: InputDataMap[keyof InputDataMap]; onChange: (updates: Partial<InputDataMap[keyof InputDataMap]>) => void } | Record<string, never>; flush: () => void } {
  // Initialize state for all types from registry or volatile retained cache
  const [inputStates, setInputStates] = useState<InputDataMap>(() => {
    const states = {} as Partial<InputDataMap>;
    (Object.keys(INPUT_REGISTRY) as QRType[]).forEach((key) => {
      // Cast the key-specific assignment to never first to safely satisfy the discriminated union constraint
      const entry = INPUT_REGISTRY[key];
      if (retainedInputStates[key] !== undefined) {
        states[key] = { ...retainedInputStates[key] } as never;
      } else if (key === config.type && config.value && entry.hydrateFn && entry.canHydrateFn(config.value)) {
        // If this is the current type and we have a value, try to hydrate
        // This ensures that initial config values (e.g. from URL or defaults) are reflected in the inputs
        try {
          states[key] = entry.hydrateFn(config.value) as never;
        } catch (e) {
          console.warn(`Failed to hydrate state for ${key}`, e);
          states[key] = entry.initialState as never;
        }
      } else {
        states[key] = entry.initialState as never;
      }
    });
    return states as InputDataMap;
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
    const entry = INPUT_REGISTRY[config.type];
    if (!entry) return;

    const prevType = prevTypeRef.current;
    prevTypeRef.current = config.type;

    const currentLocalState = latestInputStates.current[config.type];
    if (prevType !== config.type) {
      // A form kept from an earlier visit to this type may still hold a refused value.
      onRefusedChangeRef.current?.(!isInputDataValid(config.type, currentLocalState));
    }
    const currentConstructed = entry.constructFn ? entry.constructFn(currentLocalState as never) : '';

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

      const updateStateForType = (type: QRType, nextData: unknown) => {
        setInputStates((prev) => {
          if (JSON.stringify(prev[type]) === JSON.stringify(nextData)) {
            return prev;
          }
          return {
            ...prev,
            [type]: nextData,
          };
        });
      };

      // The form now shows the new content, which was never refused.
      onRefusedChangeRef.current?.(false);
      if (entry.hydrateFn && entry.canHydrateFn(config.value)) {
        try {
          const hydrated = entry.hydrateFn(config.value);
          updateStateForType(config.type, hydrated);
          retainedInputStates[config.type] = hydrated as never;
        } catch (e) {
          console.warn(`Failed to hydrate state for ${config.type} on external change`, e);
          updateStateForType(config.type, entry.initialState);
        }
      } else {
        updateStateForType(config.type, entry.initialState);
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
    const currentData = inputStates[type];
    const newData = { ...currentData, ...updates };

    setInputStates((prev) => ({
      ...prev,
      [type]: newData,
    }));
    retainedInputStates[type] = newData as never;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    const commit = () => {
      timeoutRef.current = null;
      pendingCommitRef.current = null;
      const entry = INPUT_REGISTRY[type];
      if (entry) {
        const valid = isInputDataValid(type, newData);
        if (valid) {
          // We know entry matches type K, so constructFn handles newData (InputDataMap[K])
          // Using `never` as cast because TS struggles with correlating `entry` (Registry[K])
          // and `newData` (InputDataMap[K]) inside this generic context without more verbose typing.
          onChange({ value: entry.constructFn(newData as never) });
        }
        // A refused value is not written, so the store keeps the last accepted content; the
        // flag stops the preview and exports using it until the field is fixed (#1279).
        onRefusedChangeRef.current?.(!valid);
      }
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

  // Handle all types via registry
  const registryEntry = INPUT_REGISTRY[config.type];
  if (registryEntry) {
    return {
      InputComponent: registryEntry.Component,
      inputProps: {
        data: inputStates[config.type] || registryEntry.initialState,
        onChange: (updates: Partial<InputDataMap[keyof InputDataMap]>) => handleInputChange(config.type, updates as unknown as Partial<InputDataMap[QRType]>),
      },
      flush,
    };
  }

  return {
    InputComponent: null,
    inputProps: {},
    flush,
  };
}
