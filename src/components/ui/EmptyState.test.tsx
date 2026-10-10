import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { EmptyState } from './EmptyState';
import { Button } from './Button';

describe('EmptyState', () => {
  it('renders the title as a heading with body, action and a decorative illustration', () => {
    render(
      <EmptyState
        illustration={<svg data-testid="art" />}
        title="No templates yet"
        body="Save your current style to reuse it."
        bodyId="empty-body"
        action={<Button>Save style</Button>}
      />
    );
    expect(screen.getByRole('heading', { level: 3, name: 'No templates yet' })).toBeInTheDocument();
    expect(screen.getByText('Save your current style to reuse it.')).toHaveAttribute('id', 'empty-body');
    expect(screen.getByRole('button', { name: 'Save style' })).toBeInTheDocument();
    expect(screen.getByTestId('art').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('supports another heading level and no optional parts', () => {
    render(<EmptyState level={4} title="Nothing here" />);
    expect(screen.getByRole('heading', { level: 4, name: 'Nothing here' })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<EmptyState title="Ready to scan" body="Start a transfer from the sender." />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
