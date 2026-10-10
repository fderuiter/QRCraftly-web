import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { ThemeToggle, getThemeToggleLabel } from './ThemeToggle';
import { ThemeProvider } from '@/context/ThemeContext';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-theme');
});

describe('ThemeToggle', () => {
  it('describes the current theme and the next one', () => {
    expect(getThemeToggleLabel('system')).toBe('Theme: System. Switch to Light theme');
    expect(getThemeToggleLabel('light')).toBe('Theme: Light. Switch to Dark theme');
    expect(getThemeToggleLabel('dark')).toBe('Theme: Dark. Switch to System theme');
  });

  it('cycles System, Light and Dark and applies the theme to the document', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const button = screen.getByRole('button', { name: /^Theme: System/ });
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: /^Theme: Light/ })).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('light');

    fireEvent.click(button);
    expect(screen.getByRole('button', { name: /^Theme: Dark/ })).toBeInTheDocument();
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('qrcraftly:theme')).toBe('dark');
  });

  it('renders outside a provider without crashing', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: /^Theme: System/ })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
