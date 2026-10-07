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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VCardInput } from './VCardInput';
import { VCardData } from '../../types';

describe('VCardInput', () => {
  const mockOnChange = vi.fn();
  const defaultData: VCardData = {
    firstName: 'Jane',
    lastName: 'Doe',
    organization: 'Acme Corp',
    title: 'Engineer',
    phone: '555-1234',
    email: 'jane@example.com',
    website: 'https://example.com',
    street: '123 Main St',
    city: 'Metropolis',
    zip: '10001',
    country: 'USA',
    photo: '',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with default contact details and photo upload button', () => {
    render(<VCardInput data={defaultData} onChange={mockOnChange} />);

    expect(screen.getByLabelText('First Name')).toHaveValue('Jane');
    expect(screen.getByLabelText('Last Name')).toHaveValue('Doe');
    expect(screen.getByLabelText('Company / Organization')).toHaveValue('Acme Corp');
    expect(screen.getByLabelText('Upload profile photo')).toBeInTheDocument();
    expect(screen.getByText('Upload Photo')).toBeInTheDocument();
  });

  it('handles valid image file upload', async () => {
    render(<VCardInput data={defaultData} onChange={mockOnChange} />);

    const fileInput = screen.getByLabelText('Upload profile photo') as HTMLInputElement;
    const file = new File(['dummy content'], 'photo.png', { type: 'image/png' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalledWith({ photo: expect.stringMatching(/^data:image\/png;base64,/) });
    });
  });

  it('rejects image files over 100 KB and shows validation error', () => {
    render(<VCardInput data={defaultData} onChange={mockOnChange} />);

    const fileInput = screen.getByLabelText('Upload profile photo') as HTMLInputElement;
    // Create oversized file (> 100 KB = 102400 bytes)
    const largeContent = new ArrayBuffer(105 * 1024);
    const file = new File([largeContent], 'large_photo.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(screen.getByRole('alert')).toHaveTextContent('Image size must be under 100 KB.');
    expect(mockOnChange).toHaveBeenCalledWith({ photo: '' });
  });

  it('renders photo preview and allows removing photo', () => {
    const dataWithPhoto: VCardData = {
      ...defaultData,
      photo: 'data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    };

    render(<VCardInput data={dataWithPhoto} onChange={mockOnChange} />);

    expect(screen.getByAltText('Profile preview')).toBeInTheDocument();
    const removeButton = screen.getByRole('button', { name: /remove photo/i });
    expect(removeButton).toBeInTheDocument();

    fireEvent.click(removeButton);

    expect(mockOnChange).toHaveBeenCalledWith({ photo: '' });
  });
});
