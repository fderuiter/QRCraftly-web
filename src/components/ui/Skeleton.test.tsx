import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('takes the final layout size and pulses only when motion is allowed', () => {
    const { container } = render(<Skeleton className="h-64" />);
    const skeleton = container.firstElementChild;
    expect(skeleton).toHaveClass('h-64', 'rounded-xl', 'bg-surface-hover', 'motion-safe:animate-pulse');
    expect(skeleton?.className).not.toMatch(/(^|\s)animate-pulse/);
  });

  it('is hidden from assistive technology', () => {
    const { container } = render(<Skeleton shape="text" className="h-4 w-32" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).toHaveClass('rounded-md');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div aria-busy="true" aria-label="Loading appearance controls" role="region">
        <Skeleton shape="circle" className="size-10" />
      </div>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
