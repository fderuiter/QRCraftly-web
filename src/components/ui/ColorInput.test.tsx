import { render, screen } from '@testing-library/react';
import { axe } from '../../../tests/utils/axe';
import { describe, it, expect, vi } from 'vitest';
import { ColorInput } from './ColorInput';

describe('ColorInput Component Accessibility', () => {
  it('should have zero accessibility violations', async () => {
    const handleChange = vi.fn();
    const { container } = render(
      <ColorInput
        id="test-color"
        label="Test Color Label"
        value="#ff0000"
        onChange={handleChange}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('should support direct focus on child input elements instead of focus-within container', () => {
    const handleChange = vi.fn();
    render(
      <ColorInput
        id="test-color"
        label="Test Color Label"
        value="#ff0000"
        onChange={handleChange}
      />
    );

    // Find the container wrapping the input elements
    const colorInput = screen.getByLabelText(/^test color label$/i);
    const wrapper = colorInput.parentElement;
    expect(wrapper).toBeInTheDocument();

    // Verify container does NOT have focus-within classes
    expect(wrapper).not.toHaveClass('focus-within:ring-rose-500');
    expect(wrapper).not.toHaveClass('focus-within:ring-2');
    expect(wrapper).not.toHaveClass('focus-within:ring-offset-2');

    // Verify container still has standard layout classes
    expect(wrapper).toHaveClass('p-1');
    expect(wrapper).toHaveClass('-m-1');

    // Verify inputs do NOT suppress default focus ring
    const textInput = screen.getByLabelText(/test color label hex code/i);
    expect(colorInput).not.toHaveClass('focus-visible:ring-0');
    expect(textInput).not.toHaveClass('focus-visible:ring-0');
  });

  it('should render standard label and display error message when error is provided', () => {
    const handleChange = vi.fn();
    render(
      <ColorInput
        id="test-color-error"
        label="Test Error Label"
        value="#00ff00"
        onChange={handleChange}
        error="Invalid hex code provided"
      />
    );

    // Check that error text is rendered
    expect(screen.getByText('Invalid hex code provided')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('should simultaneously disable both color picker and text field when disabled prop is true', () => {
    const handleChange = vi.fn();
    render(
      <ColorInput
        id="test-color-disabled"
        label="Test Disabled Label"
        value="#0000ff"
        onChange={handleChange}
        disabled
      />
    );

    const colorInput = screen.getByLabelText(/^test disabled label$/i);
    const textInput = screen.getByLabelText(/test disabled label hex code/i);

    expect(colorInput).toBeDisabled();
    expect(textInput).toBeDisabled();

    // Verify styling changes
    expect(colorInput).toHaveClass('disabled:opacity-50');
    expect(colorInput).toHaveClass('cursor-not-allowed');
    expect(textInput).toHaveClass('disabled:opacity-50');
    expect(textInput).toHaveClass('disabled:cursor-not-allowed');
  });

  it('should set aria-invalid and aria-describedby correctly when error is provided', () => {
    const handleChange = vi.fn();
    render(
      <ColorInput
        id="test-aria"
        label="Test Aria"
        value="#ffffff"
        onChange={handleChange}
        error="Please enter a valid hex color"
      />
    );

    const colorInput = screen.getByLabelText(/^test aria$/i);
    const textInput = screen.getByLabelText(/test aria hex code/i);

    expect(colorInput).toHaveAttribute('aria-invalid', 'true');
    expect(textInput).toHaveAttribute('aria-invalid', 'true');

    expect(colorInput).toHaveAttribute('aria-describedby', 'test-aria-error');
    expect(textInput).toHaveAttribute('aria-describedby', 'test-aria-error');
  });

  it('should render standard error styling borders on text input component when error is defined', () => {
    const handleChange = vi.fn();
    render(
      <ColorInput
        id="test-styles"
        label="Test Styles"
        value="#123456"
        onChange={handleChange}
        error="Some validation error"
      />
    );

    const textInput = screen.getByLabelText(/test styles hex code/i);
    // Should have ERROR_INPUT_CLASSES class (border-danger)
    expect(textInput).toHaveClass('border-danger');
  });

  it('should support visually hiding the input label while keeping it programmatically accessible with sr-only', () => {
    const handleChange = vi.fn();
    render(
      <ColorInput
        id="test-hidden-label"
        label="My Hidden Color Label"
        value="#aabbcc"
        onChange={handleChange}
        hideLabel={true}
      />
    );

    // Label should still exist in DOM and be programmatically accessible
    const labelElement = screen.getByText('My Hidden Color Label');
    expect(labelElement).toBeInTheDocument();
    expect(labelElement.tagName.toLowerCase()).toBe('label');
    expect(labelElement).toHaveClass('sr-only');

    // The text input should have correct ARIA label
    const textInput = screen.getByLabelText('My Hidden Color Label Hex Code');
    expect(textInput).toBeInTheDocument();
  });

  it('should construct accessible names cleanly and fallback correctly for empty or whitespace labels', () => {
    const handleChange = vi.fn();
    const { rerender } = render(
      <ColorInput
        id="test-empty-label"
        label=""
        value="#aabbcc"
        onChange={handleChange}
      />
    );

    // Text field should construct accessible name as fallback "Hex Code" with no broken text
    expect(screen.getByLabelText('Hex Code')).toBeInTheDocument();

    // Rerender with whitespace label
    rerender(
      <ColorInput
        id="test-empty-label"
        label="   "
        value="#aabbcc"
        onChange={handleChange}
      />
    );
    expect(screen.getByLabelText('Hex Code')).toBeInTheDocument();
  });
});
