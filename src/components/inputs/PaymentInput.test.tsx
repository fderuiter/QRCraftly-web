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

const UPI_ID_ERROR = 'Enter a UPI ID in the form name@bank, such as jane@okaxis.';
const PAYEE_NAME_ERROR = "A UPI payment code needs the payee's name.";

const upi = (overrides: Partial<PaymentData> = {}): PaymentData => ({
  network: CryptoNetwork.UPI,
  address: '',
  name: '',
  amount: '',
  label: '',
  ...overrides,
});

describe('PaymentInput UPI preset', () => {
  it('shows the UPI ID, a required Payee Name and Amount (INR) once UPI is chosen', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PaymentInput data={{ ...upi(), network: CryptoNetwork.BITCOIN }} onChange={onChange} />
    );
    expect(screen.queryByLabelText('Payee Name')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Currency / Network'), { target: { value: CryptoNetwork.UPI } });
    expect(onChange).toHaveBeenLastCalledWith({ network: CryptoNetwork.UPI });

    rerender(<PaymentInput data={upi()} onChange={onChange} />);
    expect(screen.getByLabelText('UPI ID')).toBeInTheDocument();
    expect(screen.getByLabelText('Payee Name')).toHaveAttribute('required');
    expect(screen.getByLabelText(/^Amount \(INR\)/)).toBeInTheDocument();
  });

  it('reports UPI ID, payee name and amount changes', () => {
    const onChange = vi.fn();
    render(<PaymentInput data={upi()} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText('UPI ID'), { target: { value: 'jane@okaxis' } });
    expect(onChange).toHaveBeenLastCalledWith({ address: 'jane@okaxis' });

    fireEvent.change(screen.getByLabelText('Payee Name'), { target: { value: 'Jane Doe' } });
    expect(onChange).toHaveBeenLastCalledWith({ name: 'Jane Doe' });

    fireEvent.change(screen.getByLabelText(/^Amount \(INR\)/), { target: { value: '250.50' } });
    expect(onChange).toHaveBeenLastCalledWith({ amount: '250.50' });
  });

  it('does not show the UPI ID error while the ID is still being typed, but shows it after blur', () => {
    const { rerender } = render(<PaymentInput data={upi({ address: '' })} onChange={vi.fn()} />);

    rerender(<PaymentInput data={upi({ address: 'jane' })} onChange={vi.fn()} />);
    expect(screen.queryByText(UPI_ID_ERROR)).not.toBeInTheDocument();
    expect(screen.getByLabelText('UPI ID')).toHaveAttribute('aria-invalid', 'false');

    fireEvent.blur(screen.getByLabelText('UPI ID'));
    expect(screen.getByText(UPI_ID_ERROR)).toBeInTheDocument();
    expect(screen.getByLabelText('UPI ID')).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the UPI ID error once the ID has the name@bank shape', () => {
    const { rerender } = render(<PaymentInput data={upi({ address: 'jane' })} onChange={vi.fn()} />);
    fireEvent.blur(screen.getByLabelText('UPI ID'));
    expect(screen.getByText(UPI_ID_ERROR)).toBeInTheDocument();

    rerender(<PaymentInput data={upi({ address: 'jane@okaxis' })} onChange={vi.fn()} />);
    expect(screen.queryByText(UPI_ID_ERROR)).not.toBeInTheDocument();
    expect(screen.getByLabelText('UPI ID')).toHaveAttribute('aria-invalid', 'false');
  });

  it('shows the payee name error only after the name field is blurred empty', () => {
    const { rerender } = render(<PaymentInput data={upi({ address: 'jane@okaxis' })} onChange={vi.fn()} />);
    expect(screen.queryByText(PAYEE_NAME_ERROR)).not.toBeInTheDocument();

    fireEvent.blur(screen.getByLabelText('Payee Name'));
    expect(screen.getByText(PAYEE_NAME_ERROR)).toBeInTheDocument();
    expect(screen.getByLabelText('Payee Name')).toHaveAttribute('aria-invalid', 'true');

    rerender(<PaymentInput data={upi({ address: 'jane@okaxis', name: 'Jane' })} onChange={vi.fn()} />);
    expect(screen.queryByText(PAYEE_NAME_ERROR)).not.toBeInTheDocument();
  });

  it('treats a whitespace-only payee name as empty after blur', () => {
    render(<PaymentInput data={upi({ address: 'jane@okaxis', name: '   ' })} onChange={vi.fn()} />);
    fireEvent.blur(screen.getByLabelText('Payee Name'));
    expect(screen.getByText(PAYEE_NAME_ERROR)).toBeInTheDocument();
  });

  it('passes an axe check on the UPI form', async () => {
    const { container } = render(<PaymentInput data={upi({ address: 'jane@okaxis', name: 'Jane Doe' })} onChange={vi.fn()} />);
    expect((await axe(container)).violations).toEqual([]);
  });

  it('passes an axe check on the UPI form with its errors shown', async () => {
    const { container } = render(<PaymentInput data={upi({ address: 'jane' })} onChange={vi.fn()} />);
    fireEvent.blur(screen.getByLabelText('UPI ID'));
    fireEvent.blur(screen.getByLabelText('Payee Name'));
    expect(screen.getByText(UPI_ID_ERROR)).toBeInTheDocument();
    expect((await axe(container)).violations).toEqual([]);
  });
});
