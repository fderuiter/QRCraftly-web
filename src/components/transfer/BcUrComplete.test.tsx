// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BcUrComplete } from './BcUrComplete';

describe('BcUrComplete', () => {
  it('saves a bytes stream under a safe name', () => {
    const onSave = vi.fn();
    render(<BcUrComplete type="bytes" content={{ kind: 'file', bytes: new Uint8Array([1, 2, 3]) }} onSave={onSave} onReceiveAnother={vi.fn()} />);
    expect(screen.getByTestId('bcur-summary')).toHaveTextContent('3 B');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'received-ur-bytes.bin', expect.any(String));
  });

  it('shows text as plain text, never as markup or a link', () => {
    render(<BcUrComplete type="crypto-psbt" content={{ kind: 'text', text: '<a href="https://evil.example">x</a>' }} onSave={vi.fn()} onReceiveAnother={vi.fn()} />);
    expect(screen.getByTestId('bcur-text')).toHaveTextContent('<a href="https://evil.example">x</a>');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('saves other types as raw CBOR named after the type, with the type cleaned', () => {
    const onSave = vi.fn();
    render(<BcUrComplete type="crypto/../psbt" content={{ kind: 'cbor', bytes: new Uint8Array([9]) }} onSave={onSave} onReceiveAnother={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave.mock.calls[0][1]).toBe('cryptopsbt.cbor');
  });
});
