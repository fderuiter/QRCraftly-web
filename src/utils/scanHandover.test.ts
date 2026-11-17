// @vitest-environment jsdom
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

import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { navigate } from 'vike/client/router';
import { QRType } from '@/packages/core/types';
import { QR_TYPE_ROUTES } from '@/data/navigation';
import {
  clearRetainedInputStates,
  getRetainedInputStates,
  setRetainedInputStates,
  type InputStates,
} from '@/components/inputs/retainedDrafts';
import { QRProvider, useQRStore } from '@/context/QRContext';
import type { ScanDescription } from '@/components/scanner/describeScan';
import { openInGenerator } from './scanHandover';

vi.mock('vike/client/router', () => ({ navigate: vi.fn(() => Promise.resolve()) }));

function makeScan(type: QRType, text: string): ScanDescription {
  return {
    type,
    text,
    typeLabel: type,
    summary: [],
    cautions: [],
    displayText: text,
    revealedText: text,
    shareText: text,
    hasSecret: false,
    link: null,
    blocked: false,
  };
}

describe('openInGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRetainedInputStates();
  });

  const allQrTypes = Object.values(QRType);

  it.each(allQrTypes)(
    'stages content, accepts incoming draft, and navigates for QRType.%s',
    (type) => {
      const payloadText = `test-payload-for-${type}`;
      const otherType = type === QRType.URL ? QRType.TEXT : QRType.URL;

      // Seed retained drafts for both this type and another type
      const initialDrafts: InputStates = {
        [type]: { dummy: 'old-draft' } as never,
        [otherType]: { dummy: 'keep-me' } as never,
      };
      setRetainedInputStates(initialDrafts);

      openInGenerator(makeScan(type, payloadText));

      // 1. Navigation verification: navigated to canonical route, without exposing payload in URL
      expect(navigate).toHaveBeenCalledWith(QR_TYPE_ROUTES[type]);
      expect(vi.mocked(navigate).mock.lastCall?.[0]).not.toContain(payloadText);

      // 2. Draft reset verification: the target type draft is accepted/dropped, other types are kept
      const retained = getRetainedInputStates();
      expect(retained[type]).toBeUndefined();
      expect(retained[otherType]).toEqual({ dummy: 'keep-me' });

      // 3. Staging verification: the next mounted generator of this type consumes the staged content
      const { result } = renderHook(() => useQRStore(), {
        wrapper: ({ children }: { children?: React.ReactNode }) =>
          React.createElement(
            QRProvider,
            { initialConfig: { type }, retainAppearance: true } as never,
            children,
          ),
      });

      expect(result.current.getState().config.value).toBe(payloadText);
    },
  );

  it('resets retained form state before client navigation completes', () => {
    let draftResetDuringNavigation = false;
    vi.mocked(navigate).mockImplementationOnce(() => {
      // Check if retained draft was already dropped when navigate was invoked
      if (getRetainedInputStates()[QRType.URL] === undefined) {
        draftResetDuringNavigation = true;
      }
      return Promise.resolve();
    });

    setRetainedInputStates({ [QRType.URL]: { url: 'https://old.example' } as never });
    openInGenerator(makeScan(QRType.URL, 'https://new.example'));

    expect(draftResetDuringNavigation).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
