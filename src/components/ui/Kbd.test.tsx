import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { Kbd } from './Kbd';

describe('Kbd', () => {
  it('renders a kbd element with token classes at the 12px caption size', () => {
    render(<Kbd>K</Kbd>);
    const key = screen.getByText('K');
    expect(key.tagName).toBe('KBD');
    expect(key).toHaveClass('bg-surface-sunken', 'text-xs', 'rounded-md');
  });

  it('passes attributes and extra classes through', () => {
    render(
      <Kbd data-testid="key" className="ml-1">
        Ctrl
      </Kbd>
    );
    expect(screen.getByTestId('key')).toHaveClass('ml-1');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <p>
        Press <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd>
      </p>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
