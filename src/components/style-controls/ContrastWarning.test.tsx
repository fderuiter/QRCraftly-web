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
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ContrastBadge, ContrastBanner } from './ContrastWarning';

/** Counts the live regions inside an element, the element itself included. */
const countLiveRegions = (root: Element) =>
  [root, ...root.querySelectorAll('*')].filter(
    (el) => el.hasAttribute('aria-live') || ['status', 'alert', 'log'].includes(el.getAttribute('role') ?? ''),
  ).length;

describe('ContrastWarning', () => {
  it('banner is one stable live region with a static note inside, so it is announced once', () => {
    const { container, rerender } = render(<ContrastBanner isVisible={false} contrastRatio={1.36} messageType="color" />);
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('');

    rerender(<ContrastBanner isVisible contrastRatio={1.36} messageType="color" />);
    // The same element announces the warning; nothing inside it is a second live region.
    expect(screen.getByRole('status')).toBe(region);
    expect(region).toHaveTextContent(/contrast ratio is low \(1\.36\)/);
    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(countLiveRegions(container)).toBe(1);
  });

  it('badge announces by default and stays silent when a banner already does', () => {
    const { container, rerender } = render(<ContrastBadge isVisible contrastRatio={1.4} />);
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('Low Contrast (1.4)');

    rerender(<ContrastBadge isVisible contrastRatio={1.4} announce={false} />);
    expect(screen.getByText('Low Contrast (1.4)')).toBeVisible();
    expect(countLiveRegions(container)).toBe(0);
  });

  it('renders inline auto-fix action button when onAutoFix callback is provided and triggers callback', () => {
    const onAutoFix = vi.fn();
    render(
      <ContrastBanner
        isVisible
        contrastRatio={1.36}
        messageType="color"
        onAutoFix={onAutoFix}
      />
    );

    const fixBtn = screen.getByRole('button', { name: 'Fix contrast' });
    expect(fixBtn).toBeInTheDocument();

    fireEvent.click(fixBtn);
    expect(onAutoFix).toHaveBeenCalledTimes(1);
  });

  it('customizes the auto-fix button label when autoFixLabel is supplied', () => {
    render(
      <ContrastBanner
        isVisible
        contrastRatio={2.1}
        messageType="color"
        onAutoFix={vi.fn()}
        autoFixLabel="Auto-correct colors"
      />
    );

    expect(screen.getByRole('button', { name: 'Auto-correct colors' })).toBeInTheDocument();
  });
});
