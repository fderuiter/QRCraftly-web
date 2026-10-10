import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the text-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a Text QR Code',
    description: 'Turn plain text into a QR code.',
    steps: [
      { name: 'Type your text', text: 'Type or paste the text.' },
      { name: 'Style it', text: 'Pick colours, shapes or a logo if you like.' },
      { name: 'Download it', text: 'Save it as PNG, SVG, EPS, PDF, JPEG or WebP.' },
    ],
  },
  faqs: [
    {
      question: 'How much text can a QR code hold?',
      answer:
        'Up to a few thousand characters, but short text scans far more reliably. Keep it to a few sentences and print longer messages bigger.',
    },
    {
      question: 'Does scanning a text code need the internet?',
      answer:
        'No. The text is inside the code, so the phone shows it offline.',
    },
    NEVER_EXPIRES,
  ],
};
