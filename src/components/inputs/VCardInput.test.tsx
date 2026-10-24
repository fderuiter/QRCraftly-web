/*
    QRCraftly
    Copyright (C) 2025-2026 fderuiter

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { VCardInput } from './VCardInput';
import type { VCardData } from '@/packages/qr-payload';

const blankCard = (overrides: Partial<VCardData> = {}): VCardData => ({
  version: '3.0',
  firstName: '',
  lastName: '',
  organization: '',
  title: '',
  phone: '',
  email: '',
  website: '',
  street: '',
  city: '',
  zip: '',
  country: '',
  x: '',
  linkedin: '',
  instagram: '',
  facebook: '',
  github: '',
  ...overrides,
});

const NOT_ON_GITHUB = /not on github\.com/i;

/** Holds the card in state, the way the form does, so typed values reach the field. */
const StatefulVCardInput = ({ initial }: { initial: VCardData }) => {
  const [data, setData] = useState(initial);
  return <VCardInput data={data} onChange={(updates) => setData((prev) => ({ ...prev, ...updates }))} />;
};

describe('VCardInput social profile fields (#1470)', () => {
  it('shows an optional text field for each social network in vCard 3.0', () => {
    render(<VCardInput data={blankCard()} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /^X\b/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^LinkedIn\b/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Instagram\b/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Facebook\b/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^GitHub\b/ })).toBeInTheDocument();
  });

  it('reports a typed handle through onChange for its own field', () => {
    const onChange = vi.fn();
    render(<VCardInput data={blankCard()} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox', { name: /^GitHub\b/ }), { target: { value: '@jane' } });
    expect(onChange).toHaveBeenLastCalledWith({ github: '@jane' });
  });

  it('does not show a profile link error while the user is still typing', () => {
    render(<StatefulVCardInput initial={blankCard()} />);
    const github = screen.getByRole('textbox', { name: /^GitHub\b/ });
    fireEvent.change(github, { target: { value: 'https://example.com/jane' } });
    expect(screen.queryByText(NOT_ON_GITHUB)).not.toBeInTheDocument();
    expect(github).toHaveAttribute('aria-invalid', 'false');
  });

  it('shows the profile link error after the field loses focus', () => {
    render(<StatefulVCardInput initial={blankCard()} />);
    const github = screen.getByRole('textbox', { name: /^GitHub\b/ });
    fireEvent.change(github, { target: { value: 'https://example.com/jane' } });
    fireEvent.blur(github);
    expect(screen.getByText(NOT_ON_GITHUB)).toBeInTheDocument();
    expect(github).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows no error on blur for a valid handle or a blank field', () => {
    render(<StatefulVCardInput initial={blankCard()} />);
    const github = screen.getByRole('textbox', { name: /^GitHub\b/ });
    const linkedin = screen.getByRole('textbox', { name: /^LinkedIn\b/ });
    fireEvent.change(github, { target: { value: '@jane' } });
    fireEvent.blur(github);
    fireEvent.blur(linkedin);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a dangerous-scheme error for an X field only after blur', () => {
    render(<StatefulVCardInput initial={blankCard()} />);
    const x = screen.getByRole('textbox', { name: /^X\b/ });
    fireEvent.change(x, { target: { value: 'javascript:alert(1)' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.blur(x);
    expect(screen.getByRole('alert')).toHaveTextContent(/unsafe url scheme/i);
  });

  it('leaves the social fields out in MECard mode and says why', () => {
    render(<VCardInput data={blankCard({ version: 'mecard' })} onChange={vi.fn()} />);
    expect(screen.queryByRole('textbox', { name: /^X\b/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^LinkedIn\b/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^Instagram\b/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^Facebook\b/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /^GitHub\b/ })).not.toBeInTheDocument();
    expect(screen.getByText(/vCard formats only/i)).toBeInTheDocument();
  });

  it('renders profile photo input and expectation hint in vCard 3.0 mode, and hides it in MECard mode', () => {
    const { rerender } = render(<VCardInput data={blankCard({ version: '3.0' })} onChange={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /Profile Photo URL/i })).toBeInTheDocument();
    expect(screen.getByText(/Some phones don't load linked photos/i)).toBeInTheDocument();

    rerender(<VCardInput data={blankCard({ version: 'mecard' })} onChange={vi.fn()} />);
    expect(screen.queryByRole('textbox', { name: /Profile Photo URL/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Some phones don't load linked photos/i)).not.toBeInTheDocument();
  });

  it('passes the axe check in vCard 3.0 with blank and filled social fields', async () => {
    const blank = render(<VCardInput data={blankCard()} onChange={vi.fn()} />);
    expect((await axe(blank.container)).violations).toEqual([]);
    blank.unmount();

    const filled = render(
      <VCardInput data={blankCard({ x: 'jane', github: 'https://example.com/jane' })} onChange={vi.fn()} />,
    );
    expect((await axe(filled.container)).violations).toEqual([]);
  });

  it('passes the axe check in MECard mode', async () => {
    const { container } = render(<VCardInput data={blankCard({ version: 'mecard' })} onChange={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });
});
