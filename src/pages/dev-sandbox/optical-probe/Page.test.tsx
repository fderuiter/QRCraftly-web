import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OpticalProbePage from './+Page';

describe('optical channel probe page', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows only a notice when the flag is off, and loads none of the tool', () => {
    render(<OpticalProbePage />);
    expect(screen.getByRole('heading', { name: 'Optical channel probe' })).toBeInTheDocument();
    expect(screen.getByText(/switched off in this build/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start the camera/i })).not.toBeInTheDocument();
  });

  it('shows the sender and the receiver when the flag is on, with the flashing warning', async () => {
    vi.stubEnv('VITE_OPTICAL_MODEM', 'true');
    render(<OpticalProbePage />);
    expect(await screen.findByRole('button', { name: /start the camera/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start the sequence/i })).toBeInTheDocument();
    expect(screen.getByText(/flash a rapidly changing pattern/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/also play the flicker patterns/i)).not.toBeChecked();
  });

  it('puts a stop control on screen as soon as the sender starts', async () => {
    vi.stubEnv('VITE_OPTICAL_MODEM', 'true');
    const user = userEvent.setup();
    render(<OpticalProbePage />);
    await user.click(await screen.findByRole('button', { name: /start the sequence/i }));
    expect(screen.getByRole('button', { name: /stop \(escape\)/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /stop \(escape\)/i }));
    expect(screen.queryByRole('button', { name: /stop \(escape\)/i })).not.toBeInTheDocument();
  });
});
