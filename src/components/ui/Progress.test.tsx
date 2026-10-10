import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { Progress } from './Progress';

describe('Progress', () => {
  it('exposes a determinate linear value', () => {
    render(<Progress label="Decoding rank" value={3} max={12} />);
    const bar = screen.getByRole('progressbar', { name: 'Decoding rank' });
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '12');
    expect(bar.firstElementChild).toHaveStyle({ width: '25%' });
  });

  it('clamps the fill to the range', () => {
    render(<Progress label="Over" value={20} max={10} />);
    expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({ width: '100%' });
  });

  it('omits the value when indeterminate', () => {
    render(<Progress label="Loading" />);
    const bar = screen.getByRole('progressbar', { name: 'Loading' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar.firstElementChild).toHaveClass('motion-safe:animate-pulse');
  });

  it('can be named by a visible label and drawn as a ring', () => {
    render(
      <>
        <p id="status">3 of 4 generated</p>
        <Progress variant="ring" labelledBy="status" value={3} max={4} />
      </>
    );
    const ring = screen.getByRole('progressbar', { name: '3 of 4 generated' });
    expect(ring.querySelector('svg')).not.toBeNull();
    expect(ring).toHaveAttribute('aria-valuenow', '3');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <>
        <Progress label="Linear" value={50} />
        <Progress label="Ring" variant="ring" />
      </>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
