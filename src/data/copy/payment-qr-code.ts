import type { ToolCopy } from './types';
import { staysInBrowser } from './shared';

/** The how-to steps and FAQs of the payment-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Create a Payment QR Code",
      "description": "Generate a QR code to receive cryptocurrency payments.",
      "steps": [
        {
          "name": "Select Network",
          "text": "Choose the cryptocurrency network (e.g., Bitcoin, Ethereum)."
        },
        {
          "name": "Enter Address",
          "text": "Paste your wallet address and optional amount."
        },
        {
          "name": "Customize & Download",
          "text": "Style your QR code and save it."
        }
      ]
    },
  faqs: [
    {
      question: 'Which cryptocurrencies are supported?',
      answer:
        'Bitcoin, Ethereum, Solana and Litecoin, plus a custom option where you paste a payment link for any other network. For the listed networks the code uses the standard payment link format of each network (for example BIP 21 for Bitcoin and EIP-681 for Ethereum), which most wallet apps can read.',
    },
    {
      question: 'Can I request a specific amount?',
      answer:
        'Yes. Add an amount and the wallet app fills it in when the code is scanned. The payer still reviews and confirms the payment in their wallet.',
    },
    {
      question: 'Is it safe to share a payment QR code?',
      answer:
        'A payment QR code only contains your public receiving address, which is safe to share. Always check the address in the preview before printing, and never put a private key or recovery phrase in a QR code.',
    },
    staysInBrowser('my wallet address'),
  ],
};
