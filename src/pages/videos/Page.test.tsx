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

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { SITE_VIDEOS } from '@/data/videos';
import Page from './+Page';

describe('Videos page', () => {
  it('lists every video with a player that loads nothing until played', () => {
    const { container } = render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name: 'QRCraftly videos' })).toBeInTheDocument();
    const players = container.querySelectorAll('video');
    expect(players).toHaveLength(SITE_VIDEOS.length);
    for (const player of players) {
      expect(player).toHaveAttribute('preload', 'none');
      expect(player).not.toHaveAttribute('autoplay');
      expect(player.querySelector('source')?.getAttribute('src')).toMatch(/^\/media\/[a-z-]+\.mp4$/);
      expect(player.querySelector('track[kind="captions"]')?.getAttribute('src')).toMatch(/^\/media\/[a-z-]+\.vtt$/);
    }
  });

  it('names each player by its title', () => {
    render(<Page />);
    for (const video of SITE_VIDEOS) {
      expect(screen.getByRole('heading', { level: 2, name: video.title })).toBeInTheDocument();
    }
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<Page />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
