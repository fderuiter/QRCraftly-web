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
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../../tests/utils/axe';
import { SenderKeyPanel } from './SenderKeyPanel';
import { TransferStats, type TransferStatsProps } from './TransferStats';

const fountain: TransferStatsProps = {
  percent: 40,
  fountain: true,
  currentFrameIndex: 12,
  framesNeeded: 30,
  totalFrames: 0,
  currentPass: 1,
  frameBufferMemory: '1.00 MB',
  fingerprint: 'bafe lomu kiza tose',
  steerStatus: null,
};

describe('TransferStats', () => {
  it('counts a fountain stream against the frames a receiver needs, with the transfer code', async () => {
    const { container } = render(<TransferStats {...fountain} />);
    expect(screen.getByText('First pass:')).toBeInTheDocument();
    expect(screen.getByTestId('sender-frames')).toHaveTextContent('12 of ~30');
    expect(screen.getByTestId('sender-fingerprint')).toHaveTextContent('bafe lomu kiza tose');
    expect(screen.queryByTestId('steer-status')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('counts a plain stream by pass, and says what steering does', () => {
    render(<TransferStats {...fountain} fountain={false} fingerprint={null} totalFrames={8} currentPass={2} steerStatus="Listening" />);
    expect(screen.getByTestId('sender-frames')).toHaveTextContent('12 / 8(Shuffled)');
    expect(screen.queryByTestId('sender-fingerprint')).toBeNull();
    expect(screen.getByTestId('steer-status')).toHaveTextContent('Listening');
  });
});

describe('SenderKeyPanel', () => {
  it('shows the words only while their button is held', async () => {
    const { container } = render(<SenderKeyPanel keyCode="one two three" showingKeyQr={false} keyCanvasRef={{ current: null }} onShowKeyQr={vi.fn()} onHideKeyQr={vi.fn()} />);
    const hold = screen.getByRole('button', { name: 'Hold to show key code' });
    expect(screen.getByTestId('sender-key-code-hidden')).toBeInTheDocument();
    fireEvent.pointerDown(hold);
    expect(screen.getByTestId('sender-key-code')).toHaveTextContent('one two three');
    fireEvent.pointerUp(hold);
    expect(screen.queryByTestId('sender-key-code')).toBeNull();
    fireEvent.keyDown(hold, { key: 'Enter' });
    expect(screen.getByTestId('sender-key-code')).toBeInTheDocument();
    fireEvent.blur(hold);
    expect(screen.queryByTestId('sender-key-code')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('asks for the key QR while its button is held', () => {
    const onShowKeyQr = vi.fn();
    const onHideKeyQr = vi.fn();
    render(<SenderKeyPanel keyCode="w" showingKeyQr keyCanvasRef={{ current: null }} onShowKeyQr={onShowKeyQr} onHideKeyQr={onHideKeyQr} />);
    const hold = screen.getByRole('button', { name: 'Hold to show key QR' });
    fireEvent.pointerDown(hold);
    fireEvent.pointerLeave(hold);
    expect(onShowKeyQr).toHaveBeenCalledTimes(1);
    expect(onHideKeyQr).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('img', { name: 'Key code QR' })).not.toHaveClass('hidden');
  });
});
