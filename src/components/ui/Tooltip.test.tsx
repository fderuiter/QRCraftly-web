import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { Tooltip } from './Tooltip';
import { Button } from './Button';

function renderTooltip() {
  return render(
    <Tooltip content="Copy image">
      <Button iconOnly aria-label="Copy QR code" aria-describedby="hint">
        C
      </Button>
    </Tooltip>
  );
}

function trigger() {
  return screen.getByRole('button', { name: 'Copy QR code' });
}

describe('Tooltip', () => {
  it('renders nothing extra until shown', () => {
    renderTooltip();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-describedby', 'hint');
  });

  it('shows on hover and links the text with aria-describedby', () => {
    renderTooltip();
    fireEvent.pointerEnter(trigger());
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Copy image');
    expect(trigger().getAttribute('aria-describedby')?.split(' ')).toEqual(['hint', tooltip.id]);
    fireEvent.pointerLeave(trigger());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows on keyboard focus, hides on blur and dismisses with Escape', () => {
    renderTooltip();
    fireEvent.keyDown(document.body, { key: 'Tab' });
    act(() => trigger().focus());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    act(() => trigger().blur());
    act(() => trigger().focus());
    act(() => trigger().blur());
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('has no axe violations while shown', async () => {
    const { container } = renderTooltip();
    fireEvent.pointerEnter(trigger());
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
