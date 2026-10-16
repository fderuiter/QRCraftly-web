import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CloudUpload, ShieldCheck } from 'lucide-react';
import { axe } from '../../../tests/utils/axe';
import { PrivacyPromiseGrid, type PrivacyPromiseItem } from './PrivacyPromiseGrid';

const TEST_PROMISES: readonly PrivacyPromiseItem[] = [
  { icon: CloudUpload, title: 'Nothing uploaded', text: 'Files stay on your device.' },
  { icon: ShieldCheck, title: 'Links checked first', text: 'Verify addresses before opening.' },
];

describe('PrivacyPromiseGrid', () => {
  it('renders grid items with titles, descriptions, and hidden icons', () => {
    const { container } = render(<PrivacyPromiseGrid items={TEST_PROMISES} />);

    expect(screen.getByText('Nothing uploaded')).toBeInTheDocument();
    expect(screen.getByText('Files stay on your device.')).toBeInTheDocument();
    expect(screen.getByText('Links checked first')).toBeInTheDocument();
    expect(screen.getByText('Verify addresses before opening.')).toBeInTheDocument();

    const listItems = screen.getAllByRole('listitem');
    expect(listItems).toHaveLength(2);

    const icons = container.querySelectorAll('svg');
    expect(icons).toHaveLength(2);
    icons.forEach((icon) => {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('renders list with 3 columns by default', () => {
    render(<PrivacyPromiseGrid items={TEST_PROMISES} ariaLabel="Privacy" />);
    const list = screen.getByRole('list', { name: 'Privacy' });
    expect(list).toBeInTheDocument();
  });

  it('supports 2 columns layout when columns prop is 2', () => {
    render(<PrivacyPromiseGrid items={TEST_PROMISES} columns={2} ariaLabel="Privacy" />);
    const list = screen.getByRole('list', { name: 'Privacy' });
    expect(list).toBeInTheDocument();
  });

  it('supports custom ariaLabel and omits aria-label when empty or omitted', () => {
    const { rerender } = render(<PrivacyPromiseGrid items={TEST_PROMISES} ariaLabel="Data Summary" />);
    expect(screen.getByRole('list', { name: 'Data Summary' })).toBeInTheDocument();

    rerender(<PrivacyPromiseGrid items={TEST_PROMISES} ariaLabel="" />);
    const list = screen.getByRole('list');
    expect(list).not.toHaveAttribute('aria-label');

    rerender(<PrivacyPromiseGrid items={TEST_PROMISES} />);
    expect(screen.getByRole('list')).not.toHaveAttribute('aria-label');
  });

  it('renders custom className on the grid container', () => {
    render(<PrivacyPromiseGrid items={TEST_PROMISES} ariaLabel="Privacy" className="mt-6 mb-10" />);
    const list = screen.getByRole('list', { name: 'Privacy' });
    expect(list).toBeInTheDocument();
  });

  it('has no axe accessibility violations', async () => {
    const { container } = render(<PrivacyPromiseGrid items={TEST_PROMISES} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
