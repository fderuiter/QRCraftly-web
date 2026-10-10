import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { Badge, type BadgeTone } from './Badge';

const TONES: [BadgeTone, string][] = [
  ['neutral', 'bg-surface-hover'],
  ['brand', 'bg-accent-soft'],
  ['success', 'bg-success-soft'],
  ['warning', 'bg-warning-soft'],
  ['danger', 'bg-danger-soft'],
  ['beta', 'ring-accent-line'],
];

describe('Badge', () => {
  it.each(TONES)('renders the %s tone with token classes at the 12px caption size', (tone, cls) => {
    render(<Badge tone={tone}>{tone}</Badge>);
    const badge = screen.getByText(tone);
    expect(badge).toHaveClass(cls, 'text-xs', 'rounded-full');
  });

  it('passes span attributes through', () => {
    render(
      <Badge id="sample" data-testid="badge">
        Sample
      </Badge>
    );
    expect(screen.getByTestId('badge')).toHaveAttribute('id', 'sample');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <p>
        File transfer <Badge tone="beta">Beta</Badge>
      </p>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
