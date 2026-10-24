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
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigate } from 'vike/client/router';
import { QRProvider } from '@/context/QRContext';
import { QRErrorCorrectionLevel, QRType } from '@/packages/core/types';
import { clearStagedArcadeTarget, getStagedArcadeTarget } from '@/packages/arcade/handoff';
import { StressTestButton } from './StressTestButton';

vi.mock('vike/client/router', () => ({ navigate: vi.fn(() => Promise.resolve()) }));

afterEach(() => {
  clearStagedArcadeTarget();
  vi.mocked(navigate).mockClear();
});

describe('Stress Test in Arcade CTA (#927)', () => {
  it('stages the current design in memory and navigates to /arcade without payload in the URL', () => {
    render(
      <QRProvider initialConfig={{ type: QRType.URL, value: 'example.org/private?token=abc', errorCorrectionLevel: QRErrorCorrectionLevel.Q, fgColor: '#112233', bgColor: '#fafafa', eyeColor: '#445566' }}>
        <StressTestButton />
      </QRProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stress Test in Arcade' }));
    expect(navigate).toHaveBeenCalledWith('/arcade');
    const staged = getStagedArcadeTarget();
    expect(staged).toMatchObject({ ecc: 'Q', fgColor: '#112233', bgColor: '#fafafa', eyeColor: '#445566' });
    // URL payloads are normalised exactly as the generator encodes them.
    expect(staged?.payload).toMatch(/^https?:\/\/example\.org\/private\?token=abc/);
    for (const [url] of vi.mocked(navigate).mock.calls) expect(url).not.toContain('example.org');
  });
});
