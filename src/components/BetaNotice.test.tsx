import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../tests/utils/axe';
import { BetaNotice } from './BetaNotice';

describe('BetaNotice (#1055)', () => {
  it('shows one short note, and stays dismissed for the session without storage', async () => {
    const setItem = Storage.prototype.setItem;
    const writes: string[] = [];
    Storage.prototype.setItem = function (key: string, value: string) {
      writes.push(key);
      setItem.call(this, key, value);
    };
    try {
      const { container, unmount } = render(<BetaNotice />);
      expect(screen.getByRole('note')).toHaveTextContent(/Beta:/);
      expect(await axe(container)).toHaveNoViolations();

      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
      unmount();

      // Another file-transfer page in the same session renders no notice.
      render(<BetaNotice />);
      expect(screen.queryByRole('note')).not.toBeInTheDocument();
      expect(writes).toEqual([]);
    } finally {
      Storage.prototype.setItem = setItem;
    }
  });
});
