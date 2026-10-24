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

// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../../tests/utils/axe';
import { AutoStoppedAlert, HandshakeErrorAlert } from './SendAlerts';
import { phaseSections } from './phaseNotice';

describe('send alerts', () => {
  it('reports an auto-stop politely', async () => {
    const { container } = render(<AutoStoppedAlert />);
    expect(screen.getByRole('status')).toHaveTextContent('Every receiver in view has the file, so the sender stopped.');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('reports a failed start as an alert', async () => {
    const { container } = render(<HandshakeErrorAlert message="Transfer QR frame failed scannability check." />);
    expect(screen.getByRole('alert')).toHaveTextContent('Transfer QR frame failed scannability check.');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('phaseSections', () => {
  it('shows the confirm, the pause hint or the auto-stop alert by phase', () => {
    const confirm = <p>confirm</p>;
    expect(phaseSections('confirmingMotion', confirm)).toEqual({ notice: confirm, alert: null });
    for (const phase of ['transmitting', 'paused'] as const) {
      render(<>{phaseSections(phase, confirm).notice}</>);
      expect(screen.getAllByTestId('pause-hint').length).toBeGreaterThan(0);
    }
    expect(phaseSections('autoStopped', confirm).notice).toBeNull();
    expect(phaseSections('autoStopped', confirm).alert).not.toBeNull();
    for (const phase of ['idle', 'ready', 'verifying', 'failed'] as const) {
      expect(phaseSections(phase, confirm)).toEqual({ notice: null, alert: null });
    }
  });
});
