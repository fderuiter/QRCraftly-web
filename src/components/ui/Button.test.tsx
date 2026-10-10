import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { Button, ButtonLink } from './Button';

describe('Button pressed state', () => {
  it('omits aria-pressed when the button is not a toggle', () => {
    render(<Button>Plain</Button>);
    expect(screen.getByRole('button', { name: 'Plain' })).not.toHaveAttribute('aria-pressed');
  });

  it('sets aria-pressed from the pressed prop', () => {
    render(
      <>
        <Button pressed>On</Button>
        <Button pressed={false}>Off</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'On' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('aria-pressed', 'false');
  });

  it.each(['outline', 'secondary', 'ghost'] as const)(
    'replaces %s variant colours with selected styles for both themes',
    (variant) => {
      render(<Button variant={variant} pressed>Selected</Button>);
      const button = screen.getByRole('button', { name: 'Selected' });
      // Light and dark selected borders are present; the variant's dark border is not,
      // so it cannot override the selected border in dark mode.
      expect(button.className).toContain('border-accent-strong');
      expect(button.className).toContain('bg-accent-soft');
      expect(button.className).toContain('ring-1');
      expect(button.className).not.toContain('border-line ');
    },
  );

  it('keeps the variant styles when not pressed', () => {
    render(<Button variant="outline" pressed={false}>Idle</Button>);
    expect(screen.getByRole('button', { name: 'Idle' }).className).toContain('border-line');
  });

  it('has no axe violations in a toggle group', async () => {
    const { container } = render(
      <div role="group" aria-label="Template">
        <Button variant="outline" pressed>None</Button>
        <Button variant="outline" pressed={false}>Square</Button>
      </div>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('ButtonLink', () => {
  it('renders a real link with the button styles of its variant', () => {
    render(<ButtonLink href="/about" variant="primary">About</ButtonLink>);
    const link = screen.getByRole('link', { name: 'About' });
    expect(link).toHaveAttribute('href', '/about');
    expect(link).toHaveClass('bg-action', 'text-on-action', 'inline-flex');
  });

  it('passes link attributes through', () => {
    render(<ButtonLink href="https://github.com/fderuiter/QRCraftly-web" target="_blank" rel="noopener noreferrer">GitHub</ButtonLink>);
    const link = screen.getByRole('link', { name: 'GitHub' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('renders nothing for an unsafe URL', () => {
    render(<ButtonLink href="javascript:alert(1)">Bad</ButtonLink>);
    expect(screen.queryByRole('link', { name: 'Bad' })).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<ButtonLink href="/">Go Home</ButtonLink>);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Button loading state', () => {
  it('marks the button busy, keeps its accessible name and ignores clicks', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Download
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Download' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button.className).toContain('text-transparent!');
    expect(button.querySelector('[aria-hidden="true"] span')).toHaveClass('motion-safe:animate-spin');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('clicks normally when not loading', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Download</Button>);
    const button = screen.getByRole('button', { name: 'Download' });
    expect(button).not.toHaveAttribute('aria-busy');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has no axe violations while loading', async () => {
    const { container } = render(<Button loading>Save</Button>);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Button icon-only and shape', () => {
  it.each([
    ['xs', 'size-6'],
    ['sm', 'size-8'],
    ['md', 'size-10'],
    ['lg', 'size-11'],
  ] as const)('sizes an icon-only %s button as a square %s', (size, cls) => {
    render(
      <Button iconOnly aria-label="Close" size={size} variant="icon">
        <svg aria-hidden="true" />
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass(cls);
  });

  it('rounds the button fully with shape="round"', () => {
    render(
      <Button iconOnly aria-label="Theme" shape="round" size="lg" variant="icon">
        <svg aria-hidden="true" />
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Theme' })).toHaveClass('rounded-full');
  });

  it('presses with the standard scale only when motion is allowed', () => {
    render(<Button>Press</Button>);
    expect(screen.getByRole('button', { name: 'Press' })).toHaveClass('motion-safe:active:scale-98');
  });

  it('styles the danger and dropzone variants with tokens', () => {
    render(
      <>
        <Button variant="danger">Delete</Button>
        <Button variant="dropzone">Upload</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('text-danger', 'hover:bg-danger-soft');
    expect(screen.getByRole('button', { name: 'Upload' })).toHaveClass('border-dashed', 'data-dragover:border-accent');
  });

  it('has no axe violations as an icon-only link', async () => {
    const { container } = render(
      <ButtonLink href="/how-to" iconOnly aria-label="How to use" variant="icon" size="lg" shape="round">
        <svg aria-hidden="true" />
      </ButtonLink>,
    );
    expect(screen.getByRole('link', { name: 'How to use' })).toHaveClass('size-11', 'rounded-full');
    expect(await axe(container)).toHaveNoViolations();
  });
});
