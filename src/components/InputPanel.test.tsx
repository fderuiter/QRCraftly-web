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

import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { axe } from '../../tests/utils/axe';
import InputPanel from './InputPanel';
import { getQRTypeLabel } from '@/data/qrTypeLabels';
import { DEFAULT_CONFIG } from '../constants';
import { QRType, type QRConfig, WifiEncryption, type WifiData, type EmailData } from '../types';
import { FIXTURES } from '../../tests/fixtures/data';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { WifiInput, EmailInput } from './inputs';
import { ToastProvider } from './ui/Toast';
import type { QRScannerProps } from './QRScanner';
import { describeScan } from './scanner/describeScan';

/**
 * The scan-toast tests swap the camera scanner for a button that reports a fixed
 * vCard; every other test uses the real QRScanner.
 */
const scannerMock = vi.hoisted(() => ({ simulate: false }));

vi.mock('./QRScanner', async importOriginal => {
  const actual = await importOriginal<typeof import('./QRScanner')>();
  const Scanner = (props: QRScannerProps) =>
    scannerMock.simulate ? (
      <button type="button" onClick={() => props.onEdit?.(describeScan('BEGIN:VCARD\nVERSION:3.0\nFN:Ada Lovelace\nEND:VCARD'))}>
        Simulate scan
      </button>
    ) : (
      <actual.QRScanner {...props} />
    );
  return { ...actual, default: Scanner, QRScanner: Scanner };
});

const mockOnChange = vi.fn();

const renderPanel = (configUpdates: Partial<QRConfig> = {}) => {
  const config = { ...DEFAULT_CONFIG, ...configUpdates };
  return render(<InputPanel config={config} onChange={mockOnChange} />);
};

/** Debounced inputs are driven with fake timers; each test starts with a clean onChange spy. */
const withDebounceTimers = () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockOnChange.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
};

describe('InputPanel Component Accessibility', () => {
  withDebounceTimers();

  const typesToTest = [
    QRType.URL,
    QRType.TEXT,
    QRType.EMAIL,
    QRType.PHONE,
    QRType.SMS,
    QRType.WIFI,
    QRType.VCARD,
    QRType.EVENT,
    QRType.PAYMENT,
    QRType.LOCATION,
    QRType.MEETING,
    QRType.SOCIAL
  ];

  it.each(typesToTest)('should have zero accessibility violations for %s configuration', async (type) => {
    const { container } = renderPanel({ type });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    vi.useRealTimers();
    const results = await axe(container);
    expect(results).toHaveNoViolations();
    vi.useFakeTimers();
  });
});

describe('InputPanel Component', () => {
  withDebounceTimers();

  it('renders URL input by default', () => {
    renderPanel();

    expect(screen.getByLabelText('Website URL')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('https://example.com')).toBeInTheDocument();
  });

  it('links to other content types without clearing the current value first', () => {
    renderPanel();
    const wifiLink = screen.getByRole('link', { name: 'WiFi' });
    expect(wifiLink).toHaveAttribute('href', '/wifi-qr-code');
    expect(screen.getByRole('link', { name: 'URL' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(wifiLink);
    expect(mockOnChange).not.toHaveBeenCalled();
  });

  it('renders WiFi inputs when WiFi type is selected', () => {
    renderPanel({ type: QRType.WIFI });
    expect(screen.getByLabelText('Network Name (SSID)')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Encryption')).toBeInTheDocument();
    expect(screen.getByLabelText('Hidden Network')).toBeInTheDocument();
  });

  it('renders Event inputs when Event type is selected', () => {
    renderPanel({ type: QRType.EVENT });
    expect(screen.getByLabelText('Event Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Start Date & Time')).toBeInTheDocument();
    expect(screen.getByLabelText('End Date & Time')).toBeInTheDocument();
    expect(screen.getByLabelText('Location')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });

  it('updates URL value', () => {
    renderPanel();
    const input = screen.getByLabelText('Website URL');
    fireEvent.change(input, { target: { value: 'https://new-url.com' } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(mockOnChange).toHaveBeenCalledWith({ value: 'https://new-url.com/' });
  });

  it('updates WiFi SSID', () => {
    renderPanel({ type: QRType.WIFI });
    const ssidInput = screen.getByLabelText('Network Name (SSID)');
    fireEvent.change(ssidInput, { target: { value: 'MyWiFi' } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Default encryption is WPA
    const expectedValue = `WIFI:T:WPA;S:MyWiFi;P:;;`;
    expect(mockOnChange).toHaveBeenCalledWith({ value: expectedValue });
  });

  it('updates WiFi Encryption and formats correctly (WPA2-EAP)', () => {
    renderPanel({ type: QRType.WIFI });

    // Change encryption to WPA2-EAP
    const encryptionSelect = screen.getByLabelText('Encryption');
    fireEvent.change(encryptionSelect, { target: { value: WifiEncryption.WPA2_EAP } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Should reveal Identity input
    const identityInput = screen.getByLabelText('Identity / Username');
    expect(identityInput).toBeInTheDocument();

    // Fill details
    const ssidInput = screen.getByLabelText('Network Name (SSID)');
    fireEvent.change(ssidInput, { target: { value: 'EnterpriseWiFi' } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    fireEvent.change(identityInput, { target: { value: 'user123' } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const passwordInput = screen.getByLabelText('Password');
    fireEvent.change(passwordInput, { target: { value: 'secretPass' } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Check final string construction
    // We need to trigger a change to see the full string construction from the component's state
    // Since state is local to InputPanel, we can only verify the output of onChange for the LAST interaction
    // The previous interactions would have called onChange with partial updates based on the local state at that time.

    // Let's verify the call for the last change (password)
    // At this point: SSID is EnterpriseWiFi, Encryption is WPA2-EAP, Identity is user123, and Password is secretPass
    const expectedValue = `WIFI:T:WPA2-EAP;S:EnterpriseWiFi;E:PEAP;PH2:MSCHAPV2;I:user123;P:secretPass;;`;
    expect(mockOnChange).toHaveBeenLastCalledWith({ value: expectedValue });
  });

  it('updates WiFi Encryption and formats correctly (nopass)', () => {
    renderPanel({ type: QRType.WIFI });

    const encryptionSelect = screen.getByLabelText('Encryption');
    fireEvent.change(encryptionSelect, { target: { value: WifiEncryption.NOPASS } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Password field should disappear
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();

    const ssidInput = screen.getByLabelText('Network Name (SSID)');
    fireEvent.change(ssidInput, { target: { value: 'OpenWiFi' } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const expectedValue = `WIFI:T:nopass;S:OpenWiFi;;`;
    expect(mockOnChange).toHaveBeenLastCalledWith({ value: expectedValue });
  });

  it('updates WiFi Hidden Network toggle', () => {
      renderPanel({ type: QRType.WIFI });

      fireEvent.change(screen.getByLabelText('Network Name (SSID)'), { target: { value: 'HomeNet' } });
      const hiddenCheckbox = screen.getByLabelText('Hidden Network');

      // Toggle ON
      fireEvent.click(hiddenCheckbox);

      act(() => {
        vi.advanceTimersByTime(100);
      });

      // We expect the LAST call to have H:true
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      expect(lastCall.value).toContain('H:true');

      // Toggle OFF
      fireEvent.click(hiddenCheckbox);

      act(() => {
        vi.advanceTimersByTime(100);
      });

      const veryLastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      expect(veryLastCall.value).not.toContain('H:true');
      expect(veryLastCall.value).not.toContain('H:false');
  });

  it('updates Text content', () => {
      renderPanel({ type: QRType.TEXT });

      const textArea = screen.getByLabelText('Content');
      fireEvent.change(textArea, { target: { value: 'Some text content' } });

      act(() => {
        vi.advanceTimersByTime(100);
      });

      expect(mockOnChange).toHaveBeenCalledWith({ value: 'Some text content' });
  });

  it('clears password in WIFI string when encryption is changed to nopass after setting password', () => {
    renderPanel({ type: QRType.WIFI });

    // 1. Enter a password with WPA (default)
    const passwordInput = screen.getByLabelText('Password');
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // 2. Change encryption to nopass
    const encryptionSelect = screen.getByLabelText('Encryption');
    fireEvent.change(encryptionSelect, { target: { value: WifiEncryption.NOPASS } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // 3. Verify the output string does NOT contain the password
    const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
    expect(lastCall.value).not.toContain('P:secret123');
    // It should NOT have a password field at all
    expect(lastCall.value).not.toContain('P:');
  });

  it('formats Email correctly', () => {
      renderPanel({ type: QRType.EMAIL });

      const emailInput = screen.getByLabelText('Email Address');
      const ccInput = screen.getByLabelText('CC');
      const bccInput = screen.getByLabelText('BCC');
      const subjectInput = screen.getByLabelText('Subject');
      const bodyInput = screen.getByLabelText('Body');

      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
      act(() => { vi.advanceTimersByTime(100); });

      fireEvent.change(ccInput, { target: { value: 'cc@example.com' } });
      act(() => { vi.advanceTimersByTime(100); });

      fireEvent.change(bccInput, { target: { value: 'bcc@example.com' } });
      act(() => { vi.advanceTimersByTime(100); });

      fireEvent.change(subjectInput, { target: { value: 'Hello World' } });
      act(() => { vi.advanceTimersByTime(100); });

      fireEvent.change(bodyInput, { target: { value: 'This is a test.' } });
      act(() => { vi.advanceTimersByTime(100); });

      const expectedValue = `mailto:test@example.com?cc=cc%40example.com&bcc=bcc%40example.com&subject=Hello%20World&body=This%20is%20a%20test.`;
      expect(mockOnChange).toHaveBeenLastCalledWith({ value: expectedValue });
  });

  it('formats Phone correctly', () => {
      renderPanel({ type: QRType.PHONE });

      const phoneInput = screen.getByLabelText('Phone Number');
      fireEvent.change(phoneInput, { target: { value: '+1234567890' } });

      act(() => { vi.advanceTimersByTime(100); });

      expect(mockOnChange).toHaveBeenCalledWith({ value: 'tel:+1234567890' });
  });

  it('formats SMS correctly', () => {
      renderPanel({ type: QRType.SMS });

      const phoneInput = screen.getByLabelText('Phone Number');
      const msgInput = screen.getByLabelText('Pre-filled Message');

      fireEvent.change(phoneInput, { target: { value: '+1234567890' } });
      act(() => { vi.advanceTimersByTime(100); });

      fireEvent.change(msgInput, { target: { value: 'Hello there' } });
      act(() => { vi.advanceTimersByTime(100); });

      expect(mockOnChange).toHaveBeenLastCalledWith({ value: 'sms:+1234567890?body=Hello%20there' });
  });

  it('formats vCard correctly', () => {
      renderPanel({ type: QRType.VCARD });

      fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'John' } });
      fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Doe' } });
      fireEvent.change(screen.getByLabelText('Company / Organization'), { target: { value: 'Acme Corp' } });
      fireEvent.change(screen.getByLabelText('Job Title'), { target: { value: 'Engineer' } });
      fireEvent.change(screen.getByLabelText('Mobile Phone'), { target: { value: '555-0199' } });
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'john@example.com' } });
      fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://example.com' } });

      // Address
      fireEvent.change(screen.getByLabelText('Street'), { target: { value: '123 Main St' } });
      fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Metropolis' } });
      fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'USA' } });

      act(() => { vi.advanceTimersByTime(1000); }); // Wait for all updates

      const expectedVCard = FIXTURES.vCard.johnDoe;

      expect(mockOnChange).toHaveBeenLastCalledWith({ value: expectedVCard });
  });

  it('escapes special characters in vCard fields', () => {
      renderPanel({ type: QRType.VCARD });

      fireEvent.change(screen.getByLabelText('First Name'), { target: { value: 'John;Bad' } });
      fireEvent.change(screen.getByLabelText('Last Name'), { target: { value: 'Doe,Jr' } });
      fireEvent.change(screen.getByLabelText('Company / Organization'), { target: { value: 'Acme\\Corp' } });

      act(() => { vi.advanceTimersByTime(1000); });

      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      const vcard = lastCall.value;

      expect(vcard).toContain('John\\;Bad');
      expect(vcard).toContain('Doe\\,Jr');
      expect(vcard).toContain('Acme\\\\Corp');
  });

  it('formats Payment (Crypto) correctly', () => {
    renderPanel({ type: QRType.PAYMENT });

    const addressInput = screen.getByLabelText('Receiver Address');
    fireEvent.change(addressInput, { target: { value: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' } });
    act(() => { vi.advanceTimersByTime(100); });

    // Default is Bitcoin
    expect(mockOnChange).toHaveBeenLastCalledWith({ value: 'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' });

    // Add amount
    const amountInput = screen.getByLabelText(/Amount/i);
    fireEvent.change(amountInput, { target: { value: '0.005' } });
    act(() => { vi.advanceTimersByTime(100); });
    expect(mockOnChange).toHaveBeenLastCalledWith({ value: 'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.005' });

    // Add label
    const labelInput = screen.getByLabelText(/Label \/ Note/i);
    fireEvent.change(labelInput, { target: { value: 'Donation for Coffee' } });
    act(() => { vi.advanceTimersByTime(100); });
    expect(mockOnChange).toHaveBeenLastCalledWith({ value: 'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.005&label=Donation%20for%20Coffee' });

    // Change Network to Ethereum
    const networkSelect = screen.getByLabelText('Currency / Network');
    fireEvent.change(networkSelect, { target: { value: 'ethereum' } });
    act(() => { vi.advanceTimersByTime(100); });
    // State persists, so params are re-applied to new network scheme
    expect(mockOnChange).toHaveBeenLastCalledWith({ value: 'ethereum:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?value=5000000000000000&label=Donation%20for%20Coffee' });

    // Change to Custom
    fireEvent.change(networkSelect, { target: { value: 'custom' } });
    act(() => { vi.advanceTimersByTime(100); });
    // Should output raw address/string
    expect(mockOnChange).toHaveBeenLastCalledWith({ value: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa' });
  });

  it('formats Event data as iCalendar', () => {
    renderPanel({ type: QRType.EVENT });

    fireEvent.change(screen.getByLabelText('Event Title'), { target: { value: 'Launch Party' } });
    act(() => { vi.advanceTimersByTime(100); });

    fireEvent.change(screen.getByLabelText('Start Date & Time'), { target: { value: '2026-05-01T18:30' } });
    act(() => { vi.advanceTimersByTime(100); });

    fireEvent.change(screen.getByLabelText('End Date & Time'), { target: { value: '2026-05-01T21:00' } });
    act(() => { vi.advanceTimersByTime(100); });

    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Main Hall, HQ' } });
    act(() => { vi.advanceTimersByTime(100); });

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Line 1\nLine 2' } });
    act(() => { vi.advanceTimersByTime(100); });

    const expected = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//QRCraftly//EN',
      'BEGIN:VEVENT',
      'UID:<uid>',
      'DTSTAMP:<stamp>',
      'SUMMARY:Launch Party',
      'DTSTART:20260501T183000',
      'DTEND:20260501T210000',
      'LOCATION:Main Hall\\, HQ',
      'DESCRIPTION:Line 1\\nLine 2',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const lastValue: string = mockOnChange.mock.lastCall?.[0].value ?? '';
    // UID is content-derived and DTSTAMP is the session clock (RFC 5545 required properties)
    const normalized = lastValue
      .replace(/^UID:[0-9a-f]{16}@qrcraftly\.com$/m, 'UID:<uid>')
      .replace(/^DTSTAMP:\d{8}T\d{6}Z$/m, 'DTSTAMP:<stamp>');
    expect(normalized).toBe(expected);
  });

  it('shows character count for TEXT input', () => {
      renderPanel({ type: QRType.TEXT, value: 'Hello' });
      expect(screen.getByText('5 / 2500')).toBeInTheDocument();
  });

});

describe('Input Character Counts', () => {
  it('renders character count for Wifi SSID', () => {
    const data: WifiData = {
      ssid: '',
      password: '',
      encryption: WifiEncryption.WPA,
      hidden: false,
    };

    render(<WifiInput data={data} onChange={mockOnChange} />);

    // SSID has maxLength 32
    expect(screen.getByText('0 / 32')).toBeInTheDocument();
  });

  it('renders character count for Wifi Password', () => {
    const data: WifiData = {
      ssid: 'Test Network',
      password: '',
      encryption: WifiEncryption.WPA,
      hidden: false,
    };

    render(<WifiInput data={data} onChange={mockOnChange} />);

    // Password has maxLength 63
    expect(screen.getByText('0 / 63')).toBeInTheDocument();
  });

  it('renders character count for Email Subject', () => {
    const data: EmailData = {
      email: 'test@example.com',
      subject: '',
      body: '',
    };

    render(<EmailInput data={data} onChange={mockOnChange} />);

    // Subject has maxLength 200
    expect(screen.getByText('0 / 200')).toBeInTheDocument();
  });
});

describe('InputPanel Edge Cases', () => {
  withDebounceTimers();

  it('escapes special characters in WiFi SSID and Password', () => {
    renderPanel({ type: QRType.WIFI });

    const ssidInput = screen.getByLabelText('Network Name (SSID)');
    const passwordInput = screen.getByLabelText('Password');

    // Characters that need escaping: \ ; , " :
    const trickySSID = 'My "Special" WiFi;\\:';
    const trickyPass = 'P@ssw,or;d\\';

    fireEvent.change(ssidInput, { target: { value: trickySSID } });
    act(() => { vi.advanceTimersByTime(100); });

    fireEvent.change(passwordInput, { target: { value: trickyPass } });
    act(() => { vi.advanceTimersByTime(100); });

    // Expect backslashes before special chars
    // SSID: My "Special" WiFi;\: -> My \"Special\" WiFi\;\\\:
    // Pass: P@ssw,or;d\ -> P@ssw\,or\;d\\

    // Construct the expected WiFi string
    // Format: WIFI:T:WPA;S:<ssid>;P:<pass>;H:false;;
    const expectedSSID = 'My \\"Special\\" WiFi\\;\\\\\\:';
    const expectedPass = 'P@ssw\\,or\\;d\\\\';

    const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
    expect(lastCall.value).toContain(`S:${expectedSSID}`);
    expect(lastCall.value).toContain(`P:${expectedPass}`);
  });

  it('cleans formatting characters from Phone number', () => {
    renderPanel({ type: QRType.PHONE });

    const phoneInput = screen.getByLabelText('Phone Number');

    // Input with spaces, colons (which should be stripped)
    fireEvent.change(phoneInput, { target: { value: '+1 555 : 123 456' } });
    act(() => { vi.advanceTimersByTime(100); });

    // Should result in clean number
    expect(mockOnChange).toHaveBeenCalledWith({ value: 'tel:+1555123456' });
  });

  it('handles empty cleaned phone number gracefully', () => {
    renderPanel({ type: QRType.PHONE });

    const phoneInput = screen.getByLabelText('Phone Number');

    // Input with only stripped characters
    fireEvent.change(phoneInput, { target: { value: ' : ' } });
    act(() => { vi.advanceTimersByTime(100); });

    // No digits, no code: the generator shows its sample instead of an empty tel: (#1272)
    expect(mockOnChange).toHaveBeenLastCalledWith({ value: '' });
  });

  it('handles colons in SMS message correctly', () => {
    renderPanel({ type: QRType.SMS });

    const phoneInput = screen.getByLabelText('Phone Number');
    const msgInput = screen.getByLabelText('Pre-filled Message');

    fireEvent.change(phoneInput, { target: { value: '123' } });
    act(() => { vi.advanceTimersByTime(100); });

    fireEvent.change(msgInput, { target: { value: 'Time: 12:30 PM' } });
    act(() => { vi.advanceTimersByTime(100); });

    // Format: sms:number?body=encodedMessage
    expect(mockOnChange).toHaveBeenLastCalledWith({ value: 'sms:123?body=Time%3A%2012%3A30%20PM' });
  });

  it('escapes special characters in WPA2-EAP Identity', () => {
    renderPanel({ type: QRType.WIFI });

    fireEvent.change(screen.getByLabelText('Network Name (SSID)'), { target: { value: 'Corp' } });
    act(() => { vi.advanceTimersByTime(100); });

    // Switch to WPA2-EAP
    const encryptionSelect = screen.getByLabelText('Encryption');
    fireEvent.change(encryptionSelect, { target: { value: 'WPA2-EAP' } });
    act(() => { vi.advanceTimersByTime(100); });

    const identityInput = screen.getByLabelText('Identity / Username');

    const trickyIdentity = 'domain\\user;name';
    fireEvent.change(identityInput, { target: { value: trickyIdentity } });
    act(() => { vi.advanceTimersByTime(100); });

    const expectedIdentity = 'domain\\\\user\\;name';

    const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
    expect(lastCall.value).toContain(`I:${expectedIdentity}`);
  });
});

describe('InputPanel Security (Input Limits)', () => {
  withDebounceTimers();

  it('enforces maxLength on URL input', () => {
    render(<InputPanel config={{ ...DEFAULT_CONFIG, type: QRType.URL }} onChange={mockOnChange} />);
    const input = screen.getByLabelText('Website URL');
    expect(input).toHaveAttribute('maxLength', '2048');
  });

  it('enforces maxLength on Text content', () => {
    render(<InputPanel config={{ ...DEFAULT_CONFIG, type: QRType.TEXT }} onChange={mockOnChange} />);
    const input = screen.getByLabelText('Content');
    expect(input).toHaveAttribute('maxLength', '2500');
  });

  it('enforces maxLength on WiFi inputs', () => {
    render(<InputPanel config={{ ...DEFAULT_CONFIG, type: QRType.WIFI }} onChange={mockOnChange} />);

    const ssid = screen.getByLabelText('Network Name (SSID)');
    expect(ssid).toHaveAttribute('maxLength', '32');

    const wifiPasswordInput = screen.getByLabelText('Password');
    expect(wifiPasswordInput).toHaveAttribute('maxLength', '63');
  });

  it('enforces maxLength on Email inputs', () => {
    render(<InputPanel config={{ ...DEFAULT_CONFIG, type: QRType.EMAIL }} onChange={mockOnChange} />);

    const emailAddressInput = screen.getByLabelText('Email Address');
    expect(emailAddressInput).toHaveAttribute('maxLength', '254'); // RFC 5321

    const ccInput = screen.getByLabelText('CC');
    expect(ccInput).toHaveAttribute('maxLength', '254');

    const bccInput = screen.getByLabelText('BCC');
    expect(bccInput).toHaveAttribute('maxLength', '254');

    const subject = screen.getByLabelText('Subject');
    expect(subject).toHaveAttribute('maxLength', '200');

    const body = screen.getByLabelText('Body');
    expect(body).toHaveAttribute('maxLength', '2000');
  });

  it('rejects dangerous protocols in URL input', () => {
    const config = { ...DEFAULT_CONFIG, type: QRType.URL, value: 'https://safe.com' };
    render(<InputPanel config={config} onChange={mockOnChange} />);

    const input = screen.getByLabelText('Website URL');

    // Safe update
    fireEvent.change(input, { target: { value: 'https://safe.com/test' } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(mockOnChange).toHaveBeenCalledWith({ value: 'https://safe.com/test' });

    mockOnChange.mockClear();

    // Dangerous update
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(mockOnChange).not.toHaveBeenCalled();
  });
});

describe('InputPanel UX', () => {
  it('renders visible labels for vCard address fields', () => {
    render(<InputPanel config={{ ...DEFAULT_CONFIG, type: QRType.VCARD }} onChange={mockOnChange} />);

    // These should exist as visible <label> elements
    // Currently they do not (they are aria-labels on inputs)
    expect(screen.getByText('Street', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('City', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByText('Country', { selector: 'label' })).toBeInTheDocument();

    // Also verify they are associated with inputs
    const streetLabel = screen.getByText('Street', { selector: 'label' });
    const streetInput = screen.getByLabelText('Street');
    expect(streetLabel.getAttribute('for')).toBe(streetInput.id);
  });
});


describe('InputPanel scanner dialog (#978, #1101, #1102)', () => {
  // The scanner loads on demand; loading it once up front keeps the first dialog test from
  // racing the import on a busy machine.
  beforeAll(async () => {
    await import('./QRScanner');
  }, 30000);

  beforeEach(() => {
    scannerMock.simulate = true;
  });

  afterEach(() => {
    scannerMock.simulate = false;
  });

  it('opens the scanner as a dialog that takes focus, closes on Escape and returns focus (#1102)', async () => {
    renderPanel();

    const scanBtn = screen.getByRole('button', { name: /scan qr code/i });
    scanBtn.focus();
    fireEvent.click(scanBtn);

    const dialog = screen.getByRole('dialog', { name: 'Scan a QR code' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The scanner loads on demand, so it arrives a moment after the dialog opens.
    expect(await screen.findByRole('button', { name: 'Simulate scan' })).toBeInTheDocument();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(scanBtn);
  });

  it('closes the scanner from its close button', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /scan qr code/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Close scanner' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('names every QR type in human-readable form', () => {
    for (const type of Object.values(QRType)) {
      expect(getQRTypeLabel(type)).toBeTruthy();
      expect(getQRTypeLabel(type)).not.toMatch(/^[A-Z]{4,}$/);
    }
    expect(getQRTypeLabel(QRType.VCARD)).toBe('vCard contact');
  });

  it('names the detected type, not the raw enum value, and loads an empty generator without Undo', async () => {
    const onChange = vi.fn();
    render(
      <ToastProvider>
        <InputPanel config={{ ...DEFAULT_CONFIG, value: '' }} onChange={onChange} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /scan qr code/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Simulate scan' }));
    expect(onChange).toHaveBeenCalledWith({ type: QRType.VCARD, value: expect.stringContaining('Ada Lovelace') });
    expect(screen.getByText(/scanned vCard contact code/)).toBeInTheDocument();
    expect(screen.queryByText(/VCARD code/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('offers Undo when a scan replaces existing content (#1101)', async () => {
    const onChange = vi.fn();
    render(
      <ToastProvider>
        <InputPanel config={{ ...DEFAULT_CONFIG, type: QRType.TEXT, value: 'My draft' }} onChange={onChange} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /scan qr code/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Simulate scan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onChange).toHaveBeenLastCalledWith({ type: QRType.TEXT, value: 'My draft' });
  });
});
