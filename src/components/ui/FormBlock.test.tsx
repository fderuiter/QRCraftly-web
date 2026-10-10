import { render, screen } from '@testing-library/react';
import { axe } from '../../../tests/utils/axe';
import { describe, it, expect } from 'vitest';
import { FormBlock } from './FormBlock';

describe('FormBlock Component', () => {
  it('should render children successfully', () => {
    render(<FormBlock>Form Inputs</FormBlock>);
    expect(screen.getByText('Form Inputs')).toBeInTheDocument();
  });

  it('should render optional legend if provided', () => {
    render(<FormBlock legend="Test Legend">Form Inputs</FormBlock>);
    expect(screen.getByText('Test Legend')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Test Legend' })).toBeInTheDocument();
  });

  it('should have zero accessibility violations', async () => {
    const { container } = render(
      <FormBlock legend="Accessibility Test">Form Inputs</FormBlock>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('should apply appropriate default styles for sub-fieldset', () => {
    const { container } = render(
      <FormBlock legend="Sub Legend" isSubFieldset={true}>
        Form Inputs
      </FormBlock>
    );
    const fieldset = container.querySelector('fieldset');
    const legend = container.querySelector('legend');

    expect(fieldset).toHaveClass('border-t');
    expect(legend).toHaveClass('font-bold');
  });
});
