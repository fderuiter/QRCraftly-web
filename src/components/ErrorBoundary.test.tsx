import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '../../tests/utils/axe';
import { ErrorBoundary } from './ErrorBoundary';
import { ToolWorkspaceLayout } from './ToolWorkspaceLayout';

let shouldThrow = true;

function Crashing() {
  if (shouldThrow) throw new Error('Simulated panel crash');
  return <p>Preview is back</p>;
}

function renderWorkspace() {
  return render(
    <ErrorBoundary>
      <ToolWorkspaceLayout
        header={<h1>Tool</h1>}
        controls={<label>Content <input /></label>}
        preview={<Crashing />}
        secondary={<p>Appearance controls</p>}
        controlsLabel="Settings"
        previewLabel="Preview"
      />
    </ErrorBoundary>
  );
}

describe('Panel error boundaries (#1055)', () => {
  beforeEach(() => {
    shouldThrow = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a crash in one tool panel shows the panel fallback, not the global error page', async () => {
    const { container } = renderWorkspace();

    const fallback = screen.getByRole('alert');
    expect(fallback).toHaveTextContent('This panel hit a snag. Your design is safe in this tab.');
    expect(screen.queryByText('Application Error')).not.toBeInTheDocument();
    // The other panels keep working.
    expect(screen.getByRole('textbox', { name: 'Content' })).toBeInTheDocument();
    expect(screen.getByText('Appearance controls')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Reload panel renders the panel again', () => {
    renderWorkspace();
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reload panel' }));
    expect(screen.getByText('Preview is back')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a crash outside the panels still reaches the root boundary', () => {
    render(
      <ErrorBoundary>
        <Crashing />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Application Error');
    expect(screen.getByRole('button', { name: 'Reload Page' })).toBeInTheDocument();
  });
});
