import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { ToggleSwitch } from './ToggleSwitch';

describe('ToggleSwitch Component', () => {
  it('renders with semantic role="switch" and correct states', () => {
    const mockOnChange = vi.fn();
    render(
      <ToggleSwitch
        id="test-toggle"
        label="Enable Feature"
        checked={true}
        onChange={mockOnChange}
      />
    );

    const toggle = screen.getByRole('switch', { name: /Enable Feature/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAttribute('id', 'test-toggle');
  });

  it('forwards custom HTML and ARIA attributes to the underlying input', () => {
    render(
      <ToggleSwitch
        id="test-toggle"
        label="Enable Feature"
        checked={false}
        onChange={() => {}}
        data-testid="custom-toggle-input"
        aria-describedby="desc-id"
      />
    );

    const toggle = screen.getByRole('switch', { name: /Enable Feature/i });
    expect(toggle).toHaveAttribute('data-testid', 'custom-toggle-input');
    expect(toggle).toHaveAttribute('aria-describedby', 'desc-id');
  });

  it('toggles the state when clicked', async () => {
    const user = userEvent.setup();
    const mockOnChange = vi.fn();
    render(
      <ToggleSwitch
        id="test-toggle"
        label="Enable Feature"
        checked={false}
        onChange={mockOnChange}
      />
    );

    const toggle = screen.getByRole('switch', { name: /Enable Feature/i });
    await user.click(toggle);
    expect(mockOnChange).toHaveBeenCalledWith(true);
  });

  it('toggles when focused and Spacebar is pressed', async () => {
    const user = userEvent.setup();
    const mockOnChange = vi.fn();
    render(
      <ToggleSwitch
        id="test-toggle"
        label="Enable Feature"
        checked={false}
        onChange={mockOnChange}
      />
    );

    const toggle = screen.getByRole('switch', { name: /Enable Feature/i });
    
    toggle.focus();
    expect(toggle).toHaveFocus();

    await user.keyboard(' ');
    expect(mockOnChange).toHaveBeenCalledWith(true);
  });

  it('applies minimum target sizing classes to the label container', () => {
    render(
      <ToggleSwitch
        id="test-toggle"
        label="Enable Feature"
        checked={false}
        onChange={() => {}}
      />
    );

    const toggle = screen.getByRole('switch', { name: /Enable Feature/i });
    const label = toggle.closest('label');
    expect(label).toHaveClass('min-h-6', 'min-w-6');
  });

  it('applies minimum target sizing classes when srLabel is enabled', () => {
    render(
      <ToggleSwitch
        id="test-toggle-sr"
        label="Enable Screen Reader Only Feature"
        srLabel={true}
        checked={false}
        onChange={() => {}}
      />
    );

    const toggle = screen.getByRole('switch', { name: /Enable Screen Reader Only Feature/i });
    const label = toggle.closest('label');
    expect(label).toHaveClass('min-h-6', 'min-w-6');
  });
});
