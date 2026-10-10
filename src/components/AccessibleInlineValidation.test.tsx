import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TextField } from './ui/TextField';
import { WifiInput } from './inputs/WifiInput';
import { VCardInput } from './inputs/VCardInput';
import { PaymentInput } from './inputs/PaymentInput';
import { WifiEncryption, CryptoNetwork } from '../types';

describe('Accessible Inline Validation and Accessible Fields', () => {
  it('displays exactly 1 character used when numeric zero (0) is input', () => {
    render(
      <TextField
        id="zero-field"
        label="Zero Field"
        value={0}
        maxLength={10}
        showCharCount={true}
        onChange={() => {}}
      />
    );
    
    expect(screen.getByText('1 / 10')).toBeInTheDocument();
    expect(screen.getByText('1 of 10 characters used')).toBeInTheDocument();
  });

  it('preserves existing aria-describedby when custom parameters are passed', () => {
    render(
      <TextField
        id="custom-described-field"
        label="Custom Field"
        value="test"
        maxLength={10}
        showCharCount={true}
        error="Field error"
        aria-describedby="external-helper-id"
        onChange={() => {}}
      />
    );

    const input = screen.getByLabelText('Custom Field');
    const describedBy = input.getAttribute('aria-describedby');

    expect(describedBy).toContain('custom-described-field-error');
    expect(describedBy).toContain('custom-described-field-char-count');
    expect(describedBy).toContain('external-helper-id');
  });

  it('WiFi input displays local inline error when control characters are input', () => {
    const mockData = {
      ssid: 'MyWiFi\u0001Network',
      password: '',
      encryption: WifiEncryption.WPA,
      hidden: false,
      eapIdentity: '',
    };

    render(<WifiInput data={mockData} onChange={() => {}} />);

    const errorAlert = screen.getByRole('alert');
    expect(errorAlert).toHaveTextContent('Network Name cannot contain control or zero-width characters.');
  });

  it('vCard website input displays local inline error when an insecure website URL is input', () => {
    const mockData = {
      firstName: '',
      lastName: '',
      organization: '',
      title: '',
      phone: '',
      email: '',
      website: 'javascript:alert(1)',
      street: '',
      city: '',
      zip: '',
      country: '',
    };

    render(<VCardInput data={mockData} onChange={() => {}} />);

    const errorAlert = screen.getByRole('alert');
    expect(errorAlert).toHaveTextContent('Unsafe URL scheme or malicious protocol detected.');
  });

  it('Payment input displays local inline error when a dangerous address URL is input', () => {
    const mockData = {
      network: CryptoNetwork.CUSTOM,
      address: 'javascript:alert(1)',
      amount: '',
      label: '',
    };

    render(<PaymentInput data={mockData} onChange={() => {}} />);

    const errorAlert = screen.getByRole('alert');
    expect(errorAlert).toHaveTextContent('Unsafe URL scheme or malicious protocol detected.');
  });

  it('Payment input displays local inline error when an invalid SEPA IBAN is input', () => {
    const mockData = {
      network: CryptoNetwork.EPC_SEPA,
      address: 'DE88370400440532013000',
      iban: 'DE88370400440532013000',
      amount: '',
      label: '',
    };

    render(<PaymentInput data={{ ...mockData, name: 'Jane Doe' }} onChange={() => {}} />);

    const errorAlert = screen.getByRole('alert');
    expect(errorAlert).toHaveTextContent('This IBAN does not pass its checksum or format check. Double-check for typos.');
  });

  it('Payment input explains an amount the network cannot carry (#1283)', () => {
    const mockData = {
      network: CryptoNetwork.BITCOIN,
      address: 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq',
      amount: '0.123456789',
      label: '',
    };
    render(<PaymentInput data={mockData} onChange={() => {}} />);
    expect(screen.getByText('This amount can have at most 8 decimal places.')).toBeInTheDocument();
  });

  it('Payment input asks for the SEPA beneficiary name (#1367)', () => {
    const mockData = {
      network: CryptoNetwork.EPC_SEPA,
      address: 'DE89370400440532013000',
      iban: 'DE89370400440532013000',
      amount: '',
      label: '',
    };
    render(<PaymentInput data={mockData} onChange={() => {}} />);
    expect(screen.getByText("A SEPA transfer code needs the beneficiary's name.")).toBeInTheDocument();
  });
});
