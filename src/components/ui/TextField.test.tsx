import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('forwards ref to the underlying HTML input element', () => {
    const ref = createRef<HTMLInputElement>();
    render(<TextField ref={ref} label="Ref Test" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.tagName).toBe('INPUT');
  });

  it('handles empty strings for error and contextualLabel gracefully', () => {
    const { container } = render(
      <TextField label="Test" contextualLabel="" error="" />
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const input = screen.getByLabelText('Test');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    const label = container.querySelector('label');
    expect(label?.querySelectorAll('span').length).toBe(0);
  });

  it('toggles password visibility when showPasswordToggle is enabled', async () => {
    render(<TextField label="Password" type="password" showPasswordToggle />);
    const input = screen.getByLabelText('Password');
    const toggleBtn = screen.getByRole('button', { name: 'Show password' });
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(toggleBtn);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
  });
});

