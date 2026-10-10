/*
    QRCraftly
    Copyright (C) 2025 fderuiter

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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StyleControls from './StyleControls';
import { DEFAULT_CONFIG, PRESET_LOGOS } from '../constants';
import { QRStyle, LogoPaddingStyle, QRErrorCorrectionLevel, QRConfig, SocialFormat, TemplateStyle } from '../types';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expandAppearanceSections } from '../../tests/utils/expandAppearanceSections';
import userEvent from '@testing-library/user-event';

describe('StyleControls Component', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('renders pattern options', () => {
    render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
    expandAppearanceSections();
    expect(screen.getByText(/Standard Industrial/)).toBeInTheDocument();
    expect(screen.getByText(/Modern Soft/)).toBeInTheDocument();
    expect(screen.getByText(/Swiss Dot/)).toBeInTheDocument();
  });

  it('changes pattern style', async () => {
    const user = userEvent.setup();
    render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
    expandAppearanceSections();

    // Clicking the "Swiss Dot" pattern button
    const dotsButton = screen.getByText(/Swiss Dot/);
    await user.click(dotsButton);

    expect(mockOnChange).toHaveBeenCalledWith({ style: QRStyle.SWISS });
  });

  it('renders pattern preview icons for all styles', () => {
     const { container } = render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
     expandAppearanceSections();

     // Starburst should have an SVG
     const starPath = container.querySelector('path[d^="M12 2l3.09 6.26"]');
     expect(starPath).toBeInTheDocument();

     // Hive uses SVG polygon
     const hiveElements = container.querySelectorAll('polygon[points="50,0 100,25 100,75 50,100 0,75 0,25"]');
     expect(hiveElements.length).toBeGreaterThan(0);
  });

  it('updates colors via inputs', () => {
    render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
    expandAppearanceSections();

    const fgInput = screen.getByLabelText('Foreground');
    fireEvent.change(fgInput, { target: { value: '#ff0000' } });
    expect(mockOnChange).toHaveBeenCalledWith({ fgColor: '#ff0000' });

    const bgInput = screen.getByLabelText('Background');
    fireEvent.change(bgInput, { target: { value: '#00ff00' } });
    expect(mockOnChange).toHaveBeenCalledWith({ bgColor: '#00ff00' });

    const eyeFrameInput = screen.getByLabelText('Eye Frame');
    fireEvent.change(eyeFrameInput, { target: { value: '#0000ff' } });
    expect(mockOnChange).toHaveBeenCalledWith({ eyeFrameColor: '#0000ff' });

    const eyeBallInput = screen.getByLabelText('Eye Ball');
    fireEvent.change(eyeBallInput, { target: { value: '#00ff00' } });
    expect(mockOnChange).toHaveBeenCalledWith({ eyeBallColor: '#00ff00' });
  });

  it('updates colors via hex text inputs', () => {
    render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
    expandAppearanceSections();

    const fgHexInput = screen.getByLabelText('Foreground Hex Code');
    fireEvent.change(fgHexInput, { target: { value: '#123456' } });
    expect(mockOnChange).toHaveBeenCalledWith({ fgColor: '#123456' });

    // Test 3-digit hex expansion
    fireEvent.change(fgHexInput, { target: { value: '#abc' } });
    expect(mockOnChange).toHaveBeenCalledWith({ fgColor: '#aabbcc' });

    // Test invalid hex (should not trigger onChange)
    mockOnChange.mockClear();
    fireEvent.change(fgHexInput, { target: { value: 'invalid' } });
    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it('updates colors via preset buttons', async () => {
    const user = userEvent.setup();
    render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
    expandAppearanceSections();

    const presetButtons = screen.getAllByRole('radio', { name: /Classic|Slate|Teal Brand|Royal Blue|Midnight|Forest|Rose|Purple|Cyber/i });
    if (presetButtons.length > 0) {
        await user.click(presetButtons[1]);
        expect(mockOnChange).toHaveBeenCalledWith(expect.objectContaining({
            fgColor: expect.any(String),
            bgColor: expect.any(String),
            eyeColor: expect.any(String),
        }));
    }
  });

  it('shows low contrast warning', () => {
    // Low contrast config: white text on white background
    const lowContrastConfig = { ...DEFAULT_CONFIG, fgColor: '#ffffff', bgColor: '#ffffff' };
    render(<StyleControls config={lowContrastConfig} onChange={mockOnChange} />);
    expandAppearanceSections();

    expect(screen.getByText(/Low Contrast/)).toBeInTheDocument();
    
    // Check that an alert exists and contains the warning text
    const alertEl = screen.getByRole('status');
    expect(alertEl).toBeInTheDocument();
    expect(alertEl).toHaveTextContent(/Warning: The contrast ratio is low/);
  });

  it('hides low contrast warning when contrast is good', () => {
    const highContrastConfig = { ...DEFAULT_CONFIG, fgColor: '#000000', bgColor: '#ffffff' };
    render(<StyleControls config={highContrastConfig} onChange={mockOnChange} />);
    expandAppearanceSections();

    expect(screen.queryByText(/Low Contrast/)).not.toBeInTheDocument();
  });

  it('renders logo upload section', () => {
      render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
      expandAppearanceSections();
      expect(screen.getByText('Upload Logo')).toBeInTheDocument();
  });

  it('gives the logo and Mosaic QR file inputs distinct accessible names', () => {
      render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
      expandAppearanceSections();
      expect(screen.getByLabelText('Upload logo image')).toHaveAttribute('type', 'file');
      expect(screen.getByLabelText('Upload mosaic design')).toHaveAttribute('type', 'file');
  });

  it('handles logo upload', async () => {
      const user = userEvent.setup();
      const { container } = render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
      expandAppearanceSections();

      const file = new File(['(⌐□_□)'], 'chucknorris.png', { type: 'image/png' });
      const fileInput = container.querySelector('input[type="file"]');

      const originalFileReader = global.FileReader;
      const mockFileReader = class {
          onload: any;
          readAsDataURL() {
             this.onload({ target: { result: 'data:image/png;base64,mocklogo' } });
          }
      } as any;
      global.FileReader = mockFileReader;

      if (fileInput) {
          await user.upload(fileInput as HTMLElement, file);
          await waitFor(() => {
              expect(mockOnChange).toHaveBeenCalledWith({ logoUrl: 'data:image/png;base64,mocklogo' });
          });
      } else {
        throw new Error('File input not found');
      }
      global.FileReader = originalFileReader;
  });

  it('renders logo settings when logo is present', async () => {
    const user = userEvent.setup();
    const logoConfig = { ...DEFAULT_CONFIG, logoUrl: 'data:image/png;base64,fake' };
    render(<StyleControls config={logoConfig} onChange={mockOnChange} />);
    expandAppearanceSections();

    expect(screen.getByText('Custom Logo')).toBeInTheDocument();

    const removeButton = screen.getByText('Remove');
    await user.click(removeButton);
    expect(mockOnChange).toHaveBeenCalledWith({ logoUrl: null });
  });

  it('changes logo padding style', async () => {
      const user = userEvent.setup();
      const logoConfig = { ...DEFAULT_CONFIG, logoUrl: 'data:image/png;base64,fake', logoPaddingStyle: 'square' as LogoPaddingStyle };
      render(<StyleControls config={logoConfig} onChange={mockOnChange} />);
      expandAppearanceSections();

      const circleBtn = screen.getByRole('radio', { name: 'Set logo border style to Circle' });
      await user.click(circleBtn);
      expect(mockOnChange).toHaveBeenCalledWith({ logoPaddingStyle: 'circle' });

      const noneBtn = screen.getByRole('radio', { name: 'Set logo border style to None' });
      await user.click(noneBtn);
      expect(mockOnChange).toHaveBeenCalledWith({ logoPaddingStyle: 'none' });
  });

  it('explains each logo backing and starts the padding at the smallest visible gap (#1355)', () => {
      const logoConfig = { ...DEFAULT_CONFIG, logoUrl: 'data:image/png;base64,fake', logoPaddingStyle: 'square' as LogoPaddingStyle, logoPadding: 0 };
      const { rerender } = render(<StyleControls config={logoConfig} onChange={mockOnChange} />);
      expandAppearanceSections();

      expect(screen.getByText(/A square of the backing colour sits behind the logo/)).toBeInTheDocument();
      const padding = screen.getByLabelText('Padding');
      expect(padding).toHaveAttribute('min', '0.5');
      expect(padding).toHaveValue('0.5');
      expect(screen.getByRole('radio', { name: 'Set logo border style to None' })).toHaveAttribute('aria-describedby', 'logo-border-style-hint');

      rerender(<StyleControls config={{ ...logoConfig, logoPaddingStyle: 'none' }} onChange={mockOnChange} />);
      expect(screen.getByText('The logo sits straight on the code, with no backing or gap.')).toBeInTheDocument();
      expect(screen.queryByLabelText('Padding')).not.toBeInTheDocument();
  });

  it('updates logo sliders and colors', () => {
      const logoConfig = { ...DEFAULT_CONFIG, logoUrl: 'data:image/png;base64,fake', logoPaddingStyle: 'square' as LogoPaddingStyle };
      render(<StyleControls config={logoConfig} onChange={mockOnChange} />);
      expandAppearanceSections();

      const paddingInput = screen.getByLabelText('Padding');
      fireEvent.change(paddingInput, { target: { value: '2' } });
      expect(mockOnChange).toHaveBeenCalledWith({ logoPadding: 2 });

      const sizeInput = screen.getByLabelText('Logo Size');
      fireEvent.change(sizeInput, { target: { value: '0.25' } });
      expect(mockOnChange).toHaveBeenCalledWith({ logoSize: 0.25 });

      const bgInput = screen.getByLabelText('Background Color');
      fireEvent.change(bgInput, { target: { value: '#123456' } });
      expect(mockOnChange).toHaveBeenCalledWith({ logoBackgroundColor: '#123456' });
  });

  it('hides padding and background color controls when logo padding style is none', () => {
      const logoConfig = { ...DEFAULT_CONFIG, logoUrl: 'data:image/png;base64,fake', logoPaddingStyle: 'none' as LogoPaddingStyle };
      render(<StyleControls config={logoConfig} onChange={mockOnChange} />);
      expandAppearanceSections();

      expect(screen.queryByLabelText('Padding')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Background Color')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Logo Size')).toBeInTheDocument();
  });

  // --- NEW TESTS FOR IMPROVED COVERAGE ---

  it('toggles advanced mode and changes error correction level', async () => {
      const user = userEvent.setup();
      render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
      expandAppearanceSections();

      const advancedBtn = screen.getByText('Advanced Mode');
      await user.click(advancedBtn);

      expect(screen.getByText('Error Correction Level')).toBeInTheDocument();

      const lowLevelBtn = screen.getByText('Low (~7%)');
      await user.click(lowLevelBtn);

      expect(mockOnChange).toHaveBeenCalledWith({ errorCorrectionLevel: QRErrorCorrectionLevel.L });
  });

  it('toggles border visibility', async () => {
      const user = userEvent.setup();
      render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
      expandAppearanceSections();

      const borderCheckbox = screen.getByRole('switch', { name: 'Enable Border' });
      await user.click(borderCheckbox);

      expect(mockOnChange).toHaveBeenCalledWith({ isBorderEnabled: !DEFAULT_CONFIG.isBorderEnabled });
  });

  it('updates border style, width, and color', async () => {
     const borderConfig = { ...DEFAULT_CONFIG, isBorderEnabled: true };
     render(<StyleControls config={borderConfig} onChange={mockOnChange} />);
     expandAppearanceSections();

     const styleSelect = screen.getByLabelText('Style');
     fireEvent.change(styleSelect, { target: { value: 'dashed' } });
     expect(mockOnChange).toHaveBeenCalledWith({ borderStyle: 'dashed' });

     const widthInput = screen.getByLabelText(/Width/);
     fireEvent.change(widthInput, { target: { value: '0.1' } });
     expect(mockOnChange).toHaveBeenCalledWith({ borderSize: 0.1 });

     const colorInput = screen.getByLabelText('Border Color');
     fireEvent.change(colorInput, { target: { value: '#ff00ff' } });
     expect(mockOnChange).toHaveBeenCalledWith({ borderColor: '#ff00ff' });
  });

  it('updates border text configuration', async () => {
      const borderConfig = { ...DEFAULT_CONFIG, isBorderEnabled: true };
      render(<StyleControls config={borderConfig} onChange={mockOnChange} />);
      expandAppearanceSections();

      const textInput = screen.getByPlaceholderText('Text on border...');
      fireEvent.change(textInput, { target: { value: 'Scan Me' } });
      expect(mockOnChange).toHaveBeenCalledWith({ borderText: 'Scan Me' });

      // Select for text position (combobox)
      const positionSelect = screen.getAllByRole('combobox').find(e => (e as HTMLSelectElement).value === 'bottom-center' || (e as HTMLSelectElement).value === 'top-center');
      if (positionSelect) {
         fireEvent.change(positionSelect, { target: { value: 'top-center' } });
         expect(mockOnChange).toHaveBeenCalledWith({ borderTextPosition: 'top-center' });
      }

      const textColorInput = screen.getByLabelText('Border Text Color');
      fireEvent.change(textColorInput, { target: { value: '#112233' } });
      expect(mockOnChange).toHaveBeenCalledWith({ borderTextColor: '#112233' });
  });

  it('handles border logo upload and removal', async () => {
      const user = userEvent.setup();
      const borderConfig = { ...DEFAULT_CONFIG, isBorderEnabled: true };
      const { container } = render(<StyleControls config={borderConfig} onChange={mockOnChange} />);
      expandAppearanceSections();

      // Mock FileReader
      const originalFileReader = global.FileReader;
      const mockFileReader = class {
          onload: any;
          readAsDataURL() {
             this.onload({ target: { result: 'data:image/png;base64,borderlogo' } });
          }
      } as any;
      global.FileReader = mockFileReader;

      // Click "Add Logo" or "Change" - trigger file input interaction
      // The button clicks the hidden input ref. We can just interact with the input directly for testing.
      // There are two file inputs now. The border one is the second one.
      const fileInputs = container.querySelectorAll('input[type="file"]');
      // The first file input is the main logo, the second is the border logo
      // Wait, let's verify if that's guaranteed.
      // Yes, in StyleControls, Logo section is rendered after Border section in DOM order?
      // Wait, no. Border section is at the TOP.
      // <div className="space-y-8">
      //    {/* Border Controls */}
      //    ...
      //    {/* Pattern Style */}
      //    ...
      //    {/* Colors */}
      //    ...
      //    {/* Logo */}

      // So Border section comes first.
      // However, the main logo input `fileInputRef` is rendered at the end of the Logo section.
      // The border logo input `borderLogoInputRef` is rendered inside the Border section.
      // So Border logo input should be the FIRST file input in the DOM if Border is enabled.

      // But wait, the previous test might have assumed Main Logo is first?
      // Let's check `handles logo upload` test. It does:
      // const fileInput = container.querySelector('input[type="file"]');
      // If border is disabled (default config), then there is only one file input (Main Logo).

      // In THIS test, `isBorderEnabled: true`.
      // So there are two inputs.
      // 1. Border Logo Input (inside Border section)
      // 2. Main Logo Input (inside Logo section)

      // So fileInputs[0] should be border logo input.
      const borderLogoInput = fileInputs[0];

      const file = new File(['foo'], 'border.png', { type: 'image/png' });
      await user.upload(borderLogoInput as HTMLElement, file);

      await waitFor(() => {
          expect(mockOnChange).toHaveBeenCalledWith({ borderLogoUrl: 'data:image/png;base64,borderlogo' });
      });

      global.FileReader = originalFileReader;
  });

  it('updates border logo position and removes it', async () => {
      const user = userEvent.setup();
      const borderConfig = { ...DEFAULT_CONFIG, isBorderEnabled: true, borderLogoUrl: 'data:fake' };
      render(<StyleControls config={borderConfig} onChange={mockOnChange} />);
      expandAppearanceSections();

      // Should show 'No secondary logo' text if null, but here it is present
      // Find position select.
      // It appears when logo is present.
      const positionSelects = screen.getAllByRole('combobox');
      // The last one likely, or find by value options
      // option value="bottom-right"
      const borderLogoPosSelect = positionSelects.find(s => s.innerHTML.includes('Bottom Right'));

      if (borderLogoPosSelect) {
         fireEvent.change(borderLogoPosSelect, { target: { value: 'bottom-right' } });
         expect(mockOnChange).toHaveBeenCalledWith({ borderLogoPosition: 'bottom-right' });
      }

      // Remove button (X icon)
      // It's a button with an X icon next to the logo preview
      screen.getAllByRole('button');
      // Find the one that calls onChange({ borderLogoUrl: null })
      // It has className text-rose-700
      // We can just click the one inside the border section
      // The text is visually hidden maybe? No, it has an X icon.
      // Let's rely on class or structure if text is not available.
      // Actually, looking at code: <button ...><X .../></button> inside the border section.
      // There is no text.
      // But there is another remove button for main logo which has "Remove" text.
      // The border one doesn't have text.

      // We can find it by looking for the image alt "Secondary Brand Graphic" and finding the button sibling?
      const borderLogoImg = screen.getByAltText('Secondary Brand Graphic');
      const removeBtn = borderLogoImg.nextElementSibling as HTMLElement;
      if (removeBtn) {
          await user.click(removeBtn);
          expect(mockOnChange).toHaveBeenCalledWith({ borderLogoUrl: null });
      }
  });
});

describe('StyleControls Contrast Check', () => {
  const mockOnChange = vi.fn();

  it('shows contrast warning for border text', async () => {
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      isBorderEnabled: true,
      borderText: 'Low Contrast',
      borderTextColor: '#333333', // Dark Grey
      borderColor: '#303030', // Dark Grey (Low contrast)
    };

    render(<StyleControls config={config} onChange={mockOnChange} />);

    expect(screen.getByText(/Low Contrast \(/)).toBeInTheDocument();
  });

  it('does not show warning for good contrast', async () => {
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      isBorderEnabled: true,
      borderText: 'High Contrast',
      borderTextColor: '#ffffff', // White
      borderColor: '#000000', // Black
    };

    render(<StyleControls config={config} onChange={mockOnChange} />);

    expect(screen.queryByText(/Low Contrast \(/)).not.toBeInTheDocument();
  });

  it('does not show warning if no text', async () => {
    const config: QRConfig = {
      ...DEFAULT_CONFIG,
      isBorderEnabled: true,
      borderText: '', // No text
      borderTextColor: '#333333',
      borderColor: '#303030',
    };

    render(<StyleControls config={config} onChange={mockOnChange} />);

    // Might match the other warning (main QR contrast), so we need to be specific or assume standard config has good contrast
    // DEFAULT_CONFIG has good contrast for main QR.
    expect(screen.queryByText(/Low Contrast \(/)).not.toBeInTheDocument();
  });
});

describe('StyleControls Accessibility', () => {
  const mockOnChange = vi.fn();

  it('Advanced Mode toggle should have correct aria attributes', () => {
    render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);

    // Find the Advanced Mode toggle button
    const advancedToggle = screen.getByRole('button', { name: /Advanced Mode/i });

    // Initial state: not expanded
    expect(advancedToggle).toHaveAttribute('aria-expanded', 'false');
    expect(advancedToggle).toHaveAttribute('aria-controls', 'advanced-settings-panel');

    // Click to expand
    fireEvent.click(advancedToggle);

    // Expect aria-expanded to be true
    expect(advancedToggle).toHaveAttribute('aria-expanded', 'true');

    // Verify the panel exists and has the correct ID
    const panel = document.getElementById('advanced-settings-panel');
    expect(panel).toBeInTheDocument();

    // Verify content is inside the panel (e.g. Error Correction Level)
    expect(screen.getByText('Error Correction Level')).toBeInTheDocument();
    expect(panel).toContainElement(screen.getByText('Error Correction Level').closest('div')?.parentElement || null);
  });

  it('logo upload trigger is a drop zone with aria-describedby, and handles accessibility correctly', async () => {
    const user = userEvent.setup();
    const { container } = render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
    expandAppearanceSections();

    // Check if the upload logo button exists and has the correct classes and attributes
    const uploadButton = screen.getByRole('button', { name: /Upload Logo/i });
    expect(uploadButton).toBeInTheDocument();

    // A catalog drop zone (the keyboard focus ring comes from the global :focus-visible style)
    expect(uploadButton).toHaveClass('border-dashed');

    // Initially aria-describedby points to the helper text ID
    expect(uploadButton).toHaveAttribute('aria-describedby', 'logo-upload-help');

    // Try to upload an invalid file type (e.g. .txt)
    const file = new File(['hello world'], 'hello.txt', { type: 'text/plain' });
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).toBeInTheDocument();

    fireEvent.change(fileInput as HTMLElement, { target: { files: [file] } });

    // Verify error is shown with correct ID and aria role="alert"
    const errorMsg = await screen.findByText(/Only JPEG, PNG, WebP, and SVG are allowed/i);
    expect(errorMsg).toBeInTheDocument();
    expect(errorMsg).toHaveAttribute('id', 'logo-upload-error');
    expect(errorMsg).toHaveAttribute('role', 'alert');

    // aria-describedby should now link both help and error IDs
    expect(uploadButton).toHaveAttribute('aria-describedby', 'logo-upload-help logo-upload-error');

    // Ensure the upload button trigger does NOT register HTML5 drag/drop event handlers
    expect(uploadButton.ondragover).toBeNull();
    expect(uploadButton.ondrop).toBeNull();
  });
});

describe('LayoutControls (via StyleControls)', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('renders the Export Layout section heading', () => {
    render(<StyleControls config={DEFAULT_CONFIG as QRConfig} onChange={mockOnChange} />);
    expandAppearanceSections();
    expect(screen.getByText('Export Layout')).toBeInTheDocument();
  });

  it('renders aspect-ratio format buttons', () => {
    render(<StyleControls config={DEFAULT_CONFIG as QRConfig} onChange={mockOnChange} />);
    expandAppearanceSections();
    expect(screen.getByRole('radio', { name: /Square format/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Portrait format/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Story format/i })).toBeInTheDocument();
  });

  it('renders template style buttons', () => {
    render(<StyleControls config={DEFAULT_CONFIG as QRConfig} onChange={mockOnChange} />);
    expandAppearanceSections();
    expect(screen.getByRole('radio', { name: /None template/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Minimalist template/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Gradient template/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Solid Frame template/i })).toBeInTheDocument();
  });

  it('calls onChange with STORY_9_16 when Story button is clicked', async () => {
    const user = userEvent.setup();
    render(<StyleControls config={DEFAULT_CONFIG as QRConfig} onChange={mockOnChange} />);
    expandAppearanceSections();
    await user.click(screen.getByRole('radio', { name: /Story format/i }));
    expect(mockOnChange).toHaveBeenCalledWith({ socialFormat: SocialFormat.STORY_9_16 });
  });

  it('calls onChange with PORTRAIT_4_5 when Portrait button is clicked', async () => {
    const user = userEvent.setup();
    render(<StyleControls config={DEFAULT_CONFIG as QRConfig} onChange={mockOnChange} />);
    expandAppearanceSections();
    await user.click(screen.getByRole('radio', { name: /Portrait format/i }));
    expect(mockOnChange).toHaveBeenCalledWith({ socialFormat: SocialFormat.PORTRAIT_4_5 });
  });

  it('calls onChange with MINIMALIST when Minimalist button is clicked', async () => {
    const user = userEvent.setup();
    render(<StyleControls config={DEFAULT_CONFIG as QRConfig} onChange={mockOnChange} />);
    expandAppearanceSections();
    await user.click(screen.getByRole('radio', { name: /Minimalist template/i }));
    expect(mockOnChange).toHaveBeenCalledWith({ templateStyle: TemplateStyle.MINIMALIST });
  });

  it('does NOT show text inputs when templateStyle is NONE', () => {
    render(<StyleControls config={DEFAULT_CONFIG as QRConfig} onChange={mockOnChange} />);
    expandAppearanceSections();
    expect(screen.queryByRole('textbox', { name: /headline/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /subtext/i })).not.toBeInTheDocument();
  });

  it('shows headline and subtext inputs when a template is active', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    expect(screen.getByRole('textbox', { name: /headline/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /subtext/i })).toBeInTheDocument();
  });

  it('calls onChange with templateHeadline when headline input changes', async () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      templateHeadline: '',
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    const input = screen.getByRole('textbox', { name: /headline/i });
    fireEvent.change(input, { target: { value: 'Hello' } });
    expect(mockOnChange).toHaveBeenCalledWith({ templateHeadline: 'Hello' });
  });

  it('calls onChange with templateSubtext when subtext input changes', async () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.SOLID_FRAME,
      templateSubtext: '',
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    const input = screen.getByRole('textbox', { name: /subtext/i });
    fireEvent.change(input, { target: { value: '@handle' } });
    expect(mockOnChange).toHaveBeenCalledWith({ templateSubtext: '@handle' });
  });

  it('marks the currently active format as checked', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      socialFormat: SocialFormat.STORY_9_16,
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    const storyBtn = screen.getByRole('radio', { name: /Story format/i });
    expect(storyBtn).toHaveAttribute('aria-checked', 'true');
  });
});

// ---------------------------------------------------------------------------
// Advanced Template Settings: RangeInput + ColorInput
// ---------------------------------------------------------------------------

describe('Advanced Template Settings (via StyleControls)', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('does NOT show Advanced Settings section when templateStyle is NONE', () => {
    render(<StyleControls config={DEFAULT_CONFIG as QRConfig} onChange={mockOnChange} />);
    expandAppearanceSections();
    expect(screen.queryByText('Advanced Settings')).not.toBeInTheDocument();
  });

  it('shows Advanced Settings section when a template is selected', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    expect(screen.getByText('Advanced Settings')).toBeInTheDocument();
  });

  it('shows the QR Scale range slider when a template is active', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.GRADIENT_BLUR,
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    expect(screen.getByLabelText('QR Scale')).toBeInTheDocument();
    expect(screen.getByLabelText('QR Scale')).toHaveAttribute('type', 'range');
  });

  it('calls onChange with templateQrScale when the scale slider changes', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      templateQrScale: 1.0,
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    const slider = screen.getByLabelText('QR Scale');
    fireEvent.change(slider, { target: { value: '0.75' } });
    expect(mockOnChange).toHaveBeenCalledWith({ templateQrScale: 0.75 });
  });

  it('shows the Override template background color switch', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.SOLID_FRAME,
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    expect(
      screen.getByRole('switch', { name: /Override template background color/i })
    ).toBeInTheDocument();
  });

  it('shows the Override template text color switch', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.SOLID_FRAME,
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    expect(
      screen.getByRole('switch', { name: /Override template text color/i })
    ).toBeInTheDocument();
  });

  it('enables background override and calls onChange with bgColor as initial templateBgColor', async () => {
    const user = userEvent.setup();
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      bgColor: '#aabbcc',
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    const checkbox = screen.getByRole('switch', { name: /Override template background color/i });
    await user.click(checkbox);
    expect(mockOnChange).toHaveBeenCalledWith({ templateBgColor: '#aabbcc' });
  });

  it('disables background override and calls onChange with undefined', async () => {
    const user = userEvent.setup();
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      templateBgColor: '#1a1a2e',
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    const checkbox = screen.getByRole('switch', { name: /Override template background color/i });
    // Switch should be checked (override active)
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(mockOnChange).toHaveBeenCalledWith({ templateBgColor: undefined });
  });

  it('shows the custom background ColorInput only when override is active', () => {
    // Without override
    const configNoOverride: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      templateBgColor: undefined,
    };
    const { rerender } = render(
      <StyleControls config={configNoOverride} onChange={mockOnChange} />
    );
    // templateBgColor ColorInput is identified by id="templateBgColor"
    expect(document.getElementById('templateBgColor')).not.toBeInTheDocument();

    // With override
    const configWithOverride: QRConfig = {
      ...configNoOverride,
      templateBgColor: '#112233',
    };
    rerender(<StyleControls config={configWithOverride} onChange={mockOnChange} />);
    expect(document.getElementById('templateBgColor')).toBeInTheDocument();
  });

  it('shows the custom text ColorInput only when override is active', () => {
    const configNoOverride: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      templateTextColor: undefined,
    };
    const { rerender } = render(
      <StyleControls config={configNoOverride} onChange={mockOnChange} />
    );
    expect(document.getElementById('templateTextColor')).not.toBeInTheDocument();

    const configWithOverride: QRConfig = {
      ...configNoOverride,
      templateTextColor: '#ff6600',
    };
    rerender(<StyleControls config={configWithOverride} onChange={mockOnChange} />);
    expect(document.getElementById('templateTextColor')).toBeInTheDocument();
  });

  it('calls onChange with new templateBgColor when color input changes', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      templateBgColor: '#000000',
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    // The color input for templateBgColor (type=color)
    const colorInput = document.getElementById('templateBgColor') as HTMLInputElement;
    expect(colorInput).toBeInTheDocument();
    fireEvent.change(colorInput, { target: { value: '#ff0000' } });
    expect(mockOnChange).toHaveBeenCalledWith({ templateBgColor: '#ff0000' });
  });

  it('calls onChange with new templateTextColor when text color input changes', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
      templateTextColor: '#000000',
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    const colorInput = document.getElementById('templateTextColor') as HTMLInputElement;
    expect(colorInput).toBeInTheDocument();
    fireEvent.change(colorInput, { target: { value: '#0000ff' } });
    expect(mockOnChange).toHaveBeenCalledWith({ templateTextColor: '#0000ff' });
  });

  it('Advanced Settings section is hidden again when switching back to None', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.MINIMALIST,
    };
    const { rerender } = render(
      <StyleControls config={config} onChange={mockOnChange} />
    );
    expect(screen.getByText('Advanced Settings')).toBeInTheDocument();

    rerender(
      <StyleControls
        config={{ ...config, templateStyle: TemplateStyle.NONE }}
        onChange={mockOnChange}
      />
    );
    expect(screen.queryByText('Advanced Settings')).not.toBeInTheDocument();
  });

  it('QR Scale slider has correct min, max, and step attributes', () => {
    const config: QRConfig = {
      ...(DEFAULT_CONFIG as QRConfig),
      templateStyle: TemplateStyle.GRADIENT_BLUR,
    };
    render(<StyleControls config={config} onChange={mockOnChange} />);
    expandAppearanceSections();
    const slider = screen.getByLabelText('QR Scale');
    expect(slider).toHaveAttribute('min', '0.5');
    expect(slider).toHaveAttribute('max', '1.5');
    expect(slider).toHaveAttribute('step', '0.05');
  });
});

describe('Appearance sections remember their state during the visit (#802)', () => {
  it('keeps a section expanded or collapsed after StyleControls remounts, e.g. on QR type change', () => {
    const first = render(<StyleControls config={DEFAULT_CONFIG as QRConfig} onChange={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Layout & Border' });
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    first.unmount();

    const second = render(<StyleControls config={DEFAULT_CONFIG as QRConfig} onChange={vi.fn()} />);
    const remounted = screen.getByRole('button', { name: 'Layout & Border' });
    expect(remounted).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(remounted);
    second.unmount();

    render(<StyleControls config={DEFAULT_CONFIG as QRConfig} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Layout & Border' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Style Gallery section (#1059)', () => {
  it('starts collapsed and loads the gallery only when it is first opened', async () => {
    render(<StyleControls config={DEFAULT_CONFIG as QRConfig} onChange={vi.fn()} />);
    const toggle = screen.getByRole('button', { name: 'Style Gallery' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('radiogroup', { name: 'Patterns' })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(await screen.findByRole('radiogroup', { name: 'Patterns' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Surprise me/ })).toBeInTheDocument();
  });
});

describe('Preset Logo Gallery', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  it('renders preset category filter tabs and preset brand logos', () => {
    render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
    expandAppearanceSections();

    // Check category tabs
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Social' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Messaging' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Payment' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument();

    // Check preset buttons
    expect(screen.getByRole('button', { name: 'Select Network logo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select Chat logo' })).toBeInTheDocument();
  });

  it('ships only generic preset marks, never third-party brand lookalikes (#1368)', () => {
    const brands = /instagram|twitter|facebook|linkedin|youtube|tiktok|github|whatsapp|telegram|messenger|discord|paypal/i;
    for (const preset of PRESET_LOGOS) {
      expect(preset.id).not.toMatch(brands);
      expect(preset.label).not.toMatch(brands);
    }
  });

  it('filters preset icons when clicking category tabs', async () => {
    const user = userEvent.setup();
    render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
    expandAppearanceSections();

    // Click "Messaging" tab
    await user.click(screen.getByRole('tab', { name: 'Messaging' }));

    // Messaging icons should be present
    expect(screen.getByRole('button', { name: 'Select Chat logo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Select Send logo' })).toBeInTheDocument();

    // Social icons should be hidden
    expect(screen.queryByRole('button', { name: 'Select Network logo' })).not.toBeInTheDocument();
  });

  it('selects a preset logo when clicked', async () => {
    const user = userEvent.setup();
    render(<StyleControls config={DEFAULT_CONFIG} onChange={mockOnChange} />);
    expandAppearanceSections();

    const networkBtn = screen.getByRole('button', { name: 'Select Network logo' });
    await user.click(networkBtn);

    expect(mockOnChange).toHaveBeenCalledWith({
      logoUrl: expect.stringContaining('data:image/svg+xml'),
    });
  });

  it('displays preset logo name and highlights selected preset icon when logo is active', () => {
    // Import PRESET_LOGOS to get the Network preset's dataUrl
    const networkPreset = PRESET_LOGOS.find((p) => p.id === 'network');
    const networkConfig = { ...DEFAULT_CONFIG, logoUrl: networkPreset!.dataUrl };

    render(<StyleControls config={networkConfig} onChange={mockOnChange} />);
    expandAppearanceSections();

    // Preset button should be pressed/selected
    const networkBtn = screen.getByRole('button', { name: 'Select Network logo' });
    expect(networkBtn).toHaveAttribute('aria-pressed', 'true');

    // Logo card should reflect preset label
    expect(screen.getByText('Network Logo')).toBeInTheDocument();
  });

  it('removes selected preset logo when Remove is clicked', async () => {
    const user = userEvent.setup();
    const networkPreset = PRESET_LOGOS.find((p) => p.id === 'network');
    const networkConfig = { ...DEFAULT_CONFIG, logoUrl: networkPreset!.dataUrl };

    render(<StyleControls config={networkConfig} onChange={mockOnChange} />);
    expandAppearanceSections();

    const removeBtn = screen.getByRole('button', { name: /Remove/i });
    await user.click(removeBtn);

    expect(mockOnChange).toHaveBeenCalledWith({ logoUrl: null });
  });
});

