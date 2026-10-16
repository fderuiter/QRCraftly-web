import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '../../../tests/utils/axe';
import { CryptoNetwork, type PaymentData } from '../../types';
import { PaymentInput } from './PaymentInput';

const renderPayment = (overrides: Partial<PaymentData>) => {
  const data: PaymentData = { network: CryptoNetwork.BITCOIN, address: '', amount: '', label: '', ...overrides };
  return render(<PaymentInput data={data} onChange={vi.fn()} />);
};

describe('PaymentInput', () => {
  it('judges a half-typed wallet address only once the field is left', () => {
    renderPayment({ address: 'bc1qar0' });
    expect(screen.queryByText(/does not pass its built-in check/)).not.toBeInTheDocument();
    fireEvent.blur(screen.getByLabelText('Receiver Address'));
    expect(screen.getByText(/does not pass its built-in check/)).toBeInTheDocument();
  });

  it('judges a half-typed IBAN only once the field is left', () => {
    renderPayment({ network: CryptoNetwork.EPC_SEPA, iban: 'DE89 3704', address: 'DE89 3704', name: 'Acme' });
    expect(screen.queryByText(/IBAN does not pass/)).not.toBeInTheDocument();
    fireEvent.blur(screen.getByLabelText('IBAN'));
    expect(screen.getByText(/IBAN does not pass/)).toBeInTheDocument();
  });

  it('flags an unsafe link at once', () => {
    renderPayment({ network: CryptoNetwork.CUSTOM, address: 'javascript:alert(1)' });
    expect(screen.getByText(/Unsafe URL scheme/)).toBeInTheDocument();
  });

  it('marks the empty IBAN when the rest of a SEPA code is filled in', async () => {
    const { container } = renderPayment({ network: CryptoNetwork.EPC_SEPA, name: 'Acme', amount: '10' });
    expect(screen.getByText("A SEPA transfer code needs the beneficiary's IBAN.")).toBeInTheDocument();
    expect(screen.getByLabelText('IBAN')).toHaveAttribute('aria-invalid', 'true');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows no IBAN message on an untouched SEPA form', () => {
    renderPayment({ network: CryptoNetwork.EPC_SEPA });
    expect(screen.getByLabelText('IBAN')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(/IBAN does not pass|needs the beneficiary's IBAN/)).not.toBeInTheDocument();
  });

  it('accepts a valid IBAN after the field is left', () => {
    const iban = 'DE89370400440532013000';
    renderPayment({ network: CryptoNetwork.EPC_SEPA, iban, address: iban, name: 'Acme' });
    fireEvent.blur(screen.getByLabelText('IBAN'));
    expect(screen.queryByText(/IBAN does not pass|needs the beneficiary's IBAN/)).not.toBeInTheDocument();
  });
});
