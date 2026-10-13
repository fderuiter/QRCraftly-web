import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../tests/utils/axe';
import { InstallAppButton } from './InstallAppButton';

/**
 * Fires a fake `beforeinstallprompt` event, as a Chromium browser would.
 * @param outcome - What the person picks in the browser's install dialog.
 * @returns The prompt spy.
 */
function offerInstall(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return { prompt, event };
}

describe('InstallAppButton', () => {
  it('shows nothing until the browser offers an install', () => {
    const { container } = render(<InstallAppButton />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the browser install dialog once, then hides', async () => {
    render(<InstallAppButton />);
    const { prompt, event } = offerInstall();
    expect(event.defaultPrevented).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install QRCraftly' }));
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Install QRCraftly' })).toBeNull();
  });

  it('hides when the app is installed some other way', () => {
    render(<InstallAppButton />);
    offerInstall();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByRole('button', { name: 'Install QRCraftly' })).toBeNull();
  });

  it('has no accessibility violations when shown', async () => {
    const { container } = render(<InstallAppButton />);
    offerInstall();
    expect(await axe(container)).toHaveNoViolations();
  });
});
