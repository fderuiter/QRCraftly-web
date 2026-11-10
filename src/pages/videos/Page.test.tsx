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

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { SITE_VIDEOS } from '@/data/videos';
import Page from './+Page';

describe('Videos page', () => {
  it('shows a poster button per video and builds no player until one is pressed', () => {
    const { container } = render(<Page />);
    expect(screen.getByRole('heading', { level: 1, name: 'QRCraftly videos' })).toBeInTheDocument();
    expect(container.querySelectorAll('video')).toHaveLength(0);
    expect(container.querySelectorAll('track')).toHaveLength(0);
    const posters = container.querySelectorAll('img');
    expect(posters).toHaveLength(SITE_VIDEOS.length);
    posters.forEach((poster, index) => {
      expect(poster.getAttribute('src')).toMatch(/^\/media\/[a-z-]+\.jpg$/);
      expect(poster).toHaveAttribute('loading', index === 0 ? 'eager' : 'lazy');
    });
    for (const video of SITE_VIDEOS) {
      expect(screen.getByRole('button', { name: `Play ${video.title}` })).toBeInTheDocument();
    }
  });

  it('swaps in the native player with captions when play is pressed, focuses it and starts it once', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const { container } = render(<Page />);
    const [first, second] = SITE_VIDEOS;
    fireEvent.click(screen.getByRole('button', { name: `Play ${second.title}` }));
    const players = container.querySelectorAll('video');
    expect(players).toHaveLength(1);
    const player = players[0];
    expect(player).toHaveAttribute('controls');
    expect(player).toHaveAttribute('preload', 'none');
    expect(player).not.toHaveAttribute('autoplay');
    expect(play).toHaveBeenCalledTimes(1);
    expect(player).toHaveAttribute('aria-labelledby', `${second.id}-title`);
    expect(player.querySelector('source')).toHaveAttribute('src', `/media/${second.id}.mp4`);
    expect(player.querySelector('track[kind="captions"]')).toHaveAttribute('src', `/media/${second.id}.vtt`);
    expect(player).toHaveFocus();
    expect(screen.queryByRole('button', { name: `Play ${second.title}` })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `Play ${first.title}` })).toBeInTheDocument();
    play.mockRestore();
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
