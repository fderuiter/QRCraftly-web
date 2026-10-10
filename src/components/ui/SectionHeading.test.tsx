import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { Eyebrow, SectionHeading } from './SectionHeading';

describe('SectionHeading', () => {
  it('renders an eyebrow-only heading at the requested level', () => {
    render(<SectionHeading eyebrow="Content" level={3} icon={<svg aria-hidden="true" />} />);
    const heading = screen.getByRole('heading', { level: 3, name: 'Content' });
    expect(heading).toHaveClass('uppercase', 'text-xs', 'text-fg-muted');
  });

  it('renders eyebrow, title and description', () => {
    render(<SectionHeading eyebrow="Step 1" title="Choose a file" description="Up to 50 MB." tone="accent" id="h" />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Choose a file' });
    expect(heading).toHaveAttribute('id', 'h');
    expect(screen.getByText('Step 1')).toHaveClass('text-accent', 'uppercase');
    expect(screen.getByText('Up to 50 MB.')).toBeInTheDocument();
  });

  it('applies the strong tone', () => {
    render(<SectionHeading eyebrow="Tools" tone="strong" />);
    expect(screen.getByRole('heading', { name: 'Tools' })).toHaveClass('text-fg');
  });

  it('Eyebrow is a caption, not a heading', () => {
    render(<Eyebrow>Live readout</Eyebrow>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('Live readout')).toHaveClass('uppercase');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <>
        <SectionHeading eyebrow="Appearance" />
        <SectionHeading eyebrow="Pledge" title="Free forever" description="No ads." />
      </>
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
