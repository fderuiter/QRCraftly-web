/*
    QRCraftly
    Copyright (C) 2026 fderuiter

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

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { PairingGuide } from './PairingGuide';
import { TransferComplete } from './TransferComplete';

const props = {
  fileName: 'holiday.png',
  fileSize: 48 * 1024,
  mimeType: 'image/png',
  sha256: 'c67d1359e2dbf94943e81f0e0d9edbc3614e6bc3ec2bec04f527ed4c3f845886',
  verified: true,
  data: new Uint8Array([1, 2, 3]),
  saved: false,
  onSave: vi.fn(),
  onReceiveAnother: vi.fn(),
};

describe('TransferComplete', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:local-1'), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the file, a verified badge and a thumbnail made from a local object URL', () => {
    render(<TransferComplete {...props} />);
    const summary = screen.getByTestId('received-file-summary');
    expect(summary).toHaveTextContent('holiday.png');
    expect(summary).toHaveTextContent('.png, image/png');
    expect(summary).toHaveTextContent('48 KB');
    expect(summary.querySelector('[title]')).toHaveAttribute('title', props.sha256);
    expect(screen.getByText('Checksum verified')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Preview of the received file' })).toHaveAttribute('src', 'blob:local-1');
  });

  it('offers Open, Save and Receive another, and saving runs the callback', () => {
    render(<TransferComplete {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(props.onSave).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Receive another file' }));
    expect(props.onReceiveAnother).toHaveBeenCalledOnce();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(open).toHaveBeenCalledWith('blob:local-1', '_blank', 'noopener');
  });

  it('revokes the thumbnail URL on unmount', () => {
    const { unmount } = render(<TransferComplete {...props} />);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-1');
  });

  it('never renders or opens a type a browser could run, and makes no URL without bytes', () => {
    const { rerender } = render(<TransferComplete {...props} mimeType="text/html" fileName="page.html" />);
    expect(screen.queryByRole('img', { name: /preview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    rerender(<TransferComplete {...props} mimeType="image/svg+xml" fileName="logo.svg" />);
    expect(screen.queryByRole('img', { name: /preview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    rerender(<TransferComplete {...props} data={null} />);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('leaves the badge off when the checksum was not checked and says Save again after a save', () => {
    render(<TransferComplete {...props} verified={false} saved data={null} mimeType="application/zip" fileName="a.zip" />);
    expect(screen.queryByText('Checksum verified')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save again' })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<TransferComplete {...props} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('PairingGuide', () => {
  it('tells the person what to do on the other phone and links to Receive', () => {
    render(<PairingGuide />);
    expect(screen.getByText('Point your other phone here')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Receive' })).toHaveAttribute('href', '/file-transfer/receive');
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<PairingGuide />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the whole name wrapped, with the extension on its own line (#1155)', () => {
    render(<TransferComplete {...props} fileName="a-very-long-name-that-would-have-been-cut-off-by-truncate-but-ends-in.pdf.exe" mimeType="application/x-msdownload" />);
    expect(screen.getByTestId('received-file-name')).toHaveTextContent('a-very-long-name-that-would-have-been-cut-off-by-truncate-but-ends-in.pdf.exe');
    expect(screen.getByTestId('received-file-name').className).not.toContain('truncate');
    expect(screen.getByTestId('received-file-type')).toHaveTextContent('.exe, application/x-msdownload');
    expect(screen.getByTestId('received-file-notices')).toHaveTextContent('The real type is .exe');
  });

  it('needs a second click to save a risky type, and Cancel backs out (#1155)', () => {
    const onSave = vi.fn();
    render(<TransferComplete {...props} fileName="setup.exe" mimeType="application/x-msdownload" data={null} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('risky-file-confirmation')).toHaveTextContent('can run programs on your device');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('risky-file-confirmation')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it.each([['notes.txt', 'text/plain'], ['scan.pdf', 'application/pdf'], ['photo.jpg', 'image/jpeg']])('saves %s in one click', (fileName, mimeType) => {
    const onSave = vi.fn();
    render(<TransferComplete {...props} fileName={fileName} mimeType={mimeType} data={null} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('risky-file-confirmation')).not.toBeInTheDocument();
  });

  it('does not show a thumbnail or Open when the announced type disagrees with the extension', () => {
    render(<TransferComplete {...props} fileName="holiday.png" mimeType="application/pdf" />);
    expect(screen.queryByRole('img', { name: /preview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
    expect(screen.getByTestId('received-file-type')).toHaveTextContent('application/octet-stream');
  });
});
