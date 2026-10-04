import type { ToolCopy } from './types';
import { NEVER_EXPIRES, staysInBrowser } from './shared';

/** The how-to steps and FAQs of the text-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Create a Text QR Code",
      "description": "Convert plain text into a scannable QR code.",
      "steps": [
        {
          "name": "Enter Text",
          "text": "Type or paste your text content into the input field."
        },
        {
          "name": "Customize",
          "text": "Adjust colors, patterns, and add a logo if desired."
        },
        {
          "name": "Download",
          "text": "Download your QR code in PNG, JPEG, or WebP format."
        }
      ]
    },
  faqs: [
    {
      question: 'What happens when someone scans a text QR code?',
      answer:
        'The scanner shows your text on screen. It works offline and does not open any website, which makes it useful for notes, codes, instructions and labels.',
    },
    {
      question: 'How much text can a QR code hold?',
      answer:
        'Up to a few thousand characters, but short text scans far more reliably. Keep it to a few sentences, and use a larger print size for longer messages.',
    },
    staysInBrowser('my text'),
    NEVER_EXPIRES,
  ],
};
