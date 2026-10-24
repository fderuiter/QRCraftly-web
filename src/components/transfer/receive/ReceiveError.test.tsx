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
import { ReceiveError } from './ReceiveError';

describe('ReceiveError', () => {
  it.each([
    ['receiver', 'receiver-error', 'Transfer Error'],
    ['file', 'file-validation-error', 'Invalid File'],
    ['camera', 'camera-error', 'Camera unavailable'],
  ] as const)('shows a %s failure under its own title', async (source, testId, title) => {
    const { container } = render(<ReceiveError failure={{ source, message: 'It went wrong.' }} onUseVideo={vi.fn()} />);
    const alert = screen.getByTestId(testId);
    expect(alert).toHaveTextContent(title);
    expect(alert).toHaveTextContent('It went wrong.');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('offers the video file only for a camera failure', () => {
    const onUseVideo = vi.fn();
    const { rerender } = render(<ReceiveError failure={{ source: 'camera', message: 'Blocked.' }} onUseVideo={onUseVideo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use a video file instead' }));
    expect(onUseVideo).toHaveBeenCalledTimes(1);
    rerender(<ReceiveError failure={{ source: 'receiver', message: 'Bad frame.' }} onUseVideo={onUseVideo} />);
    expect(screen.queryByRole('button', { name: 'Use a video file instead' })).not.toBeInTheDocument();
  });
});
