import { render, screen } from '@testing-library/react';
import { axe } from '../../../tests/utils/axe';
import { describe, it, expect, vi } from 'vitest';
import { RangeInput } from './RangeInput';

describe('RangeInput Component Accessibility', () => {
  it('should have zero accessibility violations', async () => {
    const handleChange = vi.fn();
    const { container } = render(
      <RangeInput
        id="test-range"
        label="Test Range Label"
        value={50}
        min={0}
        max={100}
        step={1}
        onChange={handleChange}
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('should support direct focus on range slider instead of focus-within container', () => {
    const handleChange = vi.fn();
    render(
      <RangeInput
        id="test-range"
        label="Test Range Label"
        value={50}
        min={0}
        max={100}
        step={1}
        onChange={handleChange}
      />
    );

    // Find the range input element
    const rangeInput = screen.getByLabelText(/test range label/i);
    expect(rangeInput).toBeInTheDocument();

    // Find the container wrapping the range input
    const wrapper = rangeInput.parentElement;
    expect(wrapper).toBeInTheDocument();

    // Verify container does NOT have focus-within classes
    expect(wrapper).not.toHaveClass('focus-within:ring-rose-500');
    expect(wrapper).not.toHaveClass('focus-within:ring-2');
    expect(wrapper).not.toHaveClass('focus-within:ring-offset-2');

    // Verify container still has standard layout classes
    expect(wrapper).toHaveClass('p-1');
    expect(wrapper).toHaveClass('-m-1');

    // Verify range input itself does NOT suppress default focus ring
    expect(rangeInput).not.toHaveClass('focus-visible:ring-0');
  });

  it('should hide the visual numeric value from assistive technologies while keeping the slider accessible', () => {
    const handleChange = vi.fn();
    render(
      <RangeInput
        id="test-range"
        label="Test Range Label"
        value={45}
        min={0}
        max={100}
        step={1}
        onChange={handleChange}
        formatValue={(val) => `${val} units`}
      />
    );

    // Find the visual numeric text element
    const visualText = screen.getByText('45 units');
    expect(visualText).toBeInTheDocument();
    expect(visualText).toHaveAttribute('aria-hidden', 'true');

    // Find the slider input
    const sliderInput = screen.getByRole('slider', { name: /test range label/i });
    expect(sliderInput).toBeInTheDocument();
    expect(sliderInput).toHaveAttribute('aria-valuetext', '45 units');
  });
});
