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

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../tests/utils/axe';
import { TransferModeSwitcher } from './TransferModeSwitcher';

describe('TransferModeSwitcher', () => {
  it('renders Send File and Receive File links with proper hrefs', () => {
    render(<TransferModeSwitcher currentMode="send" />);
    const nav = screen.getByRole('navigation', { name: 'Transfer mode' });
    const sendLink = screen.getByRole('link', { name: /Send File/ });
    const receiveLink = screen.getByRole('link', { name: /Receive File/ });

    expect(nav).toBeInTheDocument();
    expect(sendLink).toHaveAttribute('href', '/file-transfer');
    expect(receiveLink).toHaveAttribute('href', '/file-transfer/receive');
  });

  it('marks Send File with aria-current="page" when currentMode is send', () => {
    render(<TransferModeSwitcher currentMode="send" />);
    const sendLink = screen.getByRole('link', { name: /Send File/ });
    const receiveLink = screen.getByRole('link', { name: /Receive File/ });

    expect(sendLink).toHaveAttribute('aria-current', 'page');
    expect(receiveLink).not.toHaveAttribute('aria-current');
  });

  it('marks Receive File with aria-current="page" when currentMode is receive', () => {
    render(<TransferModeSwitcher currentMode="receive" />);
    const sendLink = screen.getByRole('link', { name: /Send File/ });
    const receiveLink = screen.getByRole('link', { name: /Receive File/ });

    expect(receiveLink).toHaveAttribute('aria-current', 'page');
    expect(sendLink).not.toHaveAttribute('aria-current');
  });

  it('maintains 44px minimum touch targets on both links', () => {
    render(<TransferModeSwitcher currentMode="send" />);
    screen.getAllByRole('link').forEach((link) => {
      expect(link.className).toContain('min-h-11');
    });
  });

  it('has no axe accessibility violations', async () => {
    const { container } = render(<TransferModeSwitcher currentMode="send" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
