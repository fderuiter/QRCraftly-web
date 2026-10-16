import { render, screen } from '@testing-library/react';
import { axe } from '../../../tests/utils/axe';
import { describe, it, expect } from 'vitest';
import { TextField } from './TextField';

describe('TextField Component', () => {
  it('applies className solely to FieldWrapper and omits it from inner input element', () => {
    const { container } = render(
      <TextField label="Username" className="custom-wrapper-class" />
    );
    const wrapper = container.firstElementChild;
    const input = screen.getByLabelText('Username');

    expect(wrapper).toHaveClass('custom-wrapper-class');
    expect(input).not.toHaveClass('custom-wrapper-class');
  });

  it('applies inputClassName solely to inner input element and omits it from FieldWrapper', () => {
    const { container } = render(
      <TextField label="Username" inputClassName="custom-input-class" />
    );
    const wrapper = container.firstElementChild;
    const input = screen.getByLabelText('Username');

    expect(input).toHaveClass('custom-input-class');
    expect(wrapper).not.toHaveClass('custom-input-class');
  });

  it('has zero accessibility violations', async () => {
    const { container } = render(
      <TextField label="Email Address" id="email-test" className="mt-4" inputClassName="bg-surface" />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
