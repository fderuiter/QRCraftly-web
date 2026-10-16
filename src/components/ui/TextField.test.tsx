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

  it('handles both className and inputClassName together correctly', () => {
    const { container } = render(
      <TextField
        label="Username"
        className="outer-layout-class"
        inputClassName="inner-control-class"
      />
    );
    const wrapper = container.firstElementChild;
    const input = screen.getByLabelText('Username');

    expect(wrapper).toHaveClass('outer-layout-class');
    expect(wrapper).not.toHaveClass('inner-control-class');
    expect(input).toHaveClass('inner-control-class');
    expect(input).not.toHaveClass('outer-layout-class');
  });

  it('has zero accessibility violations', async () => {
    const { container } = render(
      <TextField label="Email Address" id="email-test" className="mt-4" inputClassName="bg-surface" />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
