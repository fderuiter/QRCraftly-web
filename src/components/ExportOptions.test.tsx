import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../tests/utils/axe';
import { QRType } from '@/types';
import { ExportOptions, clampSize, printHint } from './ExportOptions';
import { suggestFilename } from './QRTool';

function renderOptions(format: 'png' | 'svg' = 'png', size = 2048) {
  const handlers = { onFormatChange: vi.fn(), onSizeChange: vi.fn(), onFilenameChange: vi.fn(), onCopySvg: vi.fn() };
  const view = render(
    <ExportOptions id="opts" format={format} size={size} filename="url-example.com" copySvgBusy={false} {...handlers} />
  );
  return { ...view, ...handlers };
}

describe('ExportOptions (#1052)', () => {
  it('has no axe violations and reports each choice', async () => {
    const { container, onFormatChange, onSizeChange, onFilenameChange, onCopySvg } = renderOptions();
    expect(await axe(container)).toHaveNoViolations();

    fireEvent.click(screen.getByRole('radio', { name: 'JPEG' }));
    expect(onFormatChange).toHaveBeenCalledWith('jpeg');
    fireEvent.click(screen.getByRole('radio', { name: 'Screen' }));
    expect(onSizeChange).toHaveBeenCalledWith(512);
    fireEvent.change(screen.getByLabelText('File name'), { target: { value: 'menu' } });
    expect(onFilenameChange).toHaveBeenCalledWith('menu');
    fireEvent.click(screen.getByRole('button', { name: 'Copy as SVG' }));
    expect(onCopySvg).toHaveBeenCalled();
  });

  it('takes a custom width and hides the size for SVG, EPS, and PDF', () => {
    renderOptions('png' as any, 1000);
    expect(screen.getByRole('radio', { name: 'Custom' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Width in pixels')).toHaveValue(1000);
    renderOptions('svg' as any);
    expect(screen.getByText(/SVG is vector/)).toBeInTheDocument();
    renderOptions('eps' as any);
    expect(screen.getByText(/EPS is vector/)).toBeInTheDocument();
    renderOptions('pdf' as any);
    expect(screen.getByText(/PDF is vector/)).toBeInTheDocument();
  });

  it('clamps widths and describes the printed size', () => {
    expect(clampSize(50)).toBe(128);
    expect(clampSize(99999)).toBe(8192);
    expect(clampSize(Number.NaN)).toBe(2048);
    expect(printHint(600)).toBe('Prints 5.1 cm (2.0 in) wide at 300 dpi and scans from about 0.5 m.');
  });

  it('suggests a file name from the type and a harmless hint, never a password', () => {
    expect(suggestFilename({ type: QRType.WIFI, value: 'WIFI:T:WPA;S:Home Network;P:secret;;' })).toBe('wifi-Home-Network');
    expect(suggestFilename({ type: QRType.URL, value: 'https://www.example.com/a?b=c' })).toBe('url-example.com');
    expect(suggestFilename({ type: QRType.TEXT, value: 'private note' })).toBe('text-qr-code');
    expect(suggestFilename({ type: QRType.URL, value: 'not a url' })).toBe('url-qr-code');
  });

  it('renders a reassurance card saying the static code never expires', () => {
    renderOptions();
    const card = screen.getByTestId('export-reassurance-card');
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent('Never expires');
    expect(card).toHaveTextContent(/static code/i);
    expect(card).toHaveTextContent(/no account, scan limit or subscription/i);
  });
});
