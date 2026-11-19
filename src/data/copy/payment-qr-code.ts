import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the payment-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a Payment QR Code',
    description: 'Make a code that asks for a payment.',
    steps: [
      {
        name: 'Pick the payment type',
        text: 'Choose Bitcoin, Ethereum, Solana, Litecoin, SEPA Credit Transfer (EPC QR), UPI (India), PayPal, Venmo, Cash App, or Custom / Raw Address in Currency / Network.',
      },
      {
        name: 'Enter the required details',
        text: 'Enter your wallet address, username, SEPA IBAN and Beneficiary Name, or UPI ID and Payee Name, plus an optional amount.',
      },
      { name: 'Download it', text: 'Save the code, then send a small test payment before you print it.' },
    ],
  },
  faqs: [
    {
      question: 'Which payment types are supported?',
      answer:
        'Bitcoin (BIP 21), Ethereum (EIP-681), Solana, and Litecoin payment requests, SEPA Credit Transfer (EPC QR, requiring IBAN and Beneficiary Name), UPI (India) requests in INR (upi://pay, requiring UPI ID and Payee Name), PayPal.me, Venmo, and Cash App links, plus Custom / Raw Address for any other payment URI.',
    },
    {
      question: 'Can I request a specific amount?',
      answer:
        'Yes. Add an amount and apps that support it fill it in. The payer still checks and confirms the payment.',
    },
    {
      question: 'Is it safe to share a payment QR code?',
      answer:
        'It only holds details you share to get paid, such as a public address or IBAN. Check the preview before printing, and never put a private key or recovery phrase in a QR code.',
    },
    NEVER_EXPIRES,
  ],
};
