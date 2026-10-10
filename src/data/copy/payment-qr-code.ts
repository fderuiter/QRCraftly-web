import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the payment-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a Payment QR Code',
    description: 'Make a code that asks for a payment.',
    steps: [
      { name: 'Pick the payment type', text: 'Choose a crypto network, a SEPA bank transfer, PayPal, Venmo or Cash App.' },
      { name: 'Enter your details', text: 'Paste your address, IBAN or username, and an amount if you want one.' },
      { name: 'Download it', text: 'Save the code, then send a small test payment before you print it.' },
    ],
  },
  faqs: [
    {
      question: 'Which payment types are supported?',
      answer:
        'Bitcoin, Ethereum, Solana and Litecoin payment links (BIP 21 for Bitcoin, EIP-681 for Ethereum), SEPA credit transfers in the EPC QR format, PayPal.me, Venmo and Cash App links, and a custom option for any other payment link.',
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
