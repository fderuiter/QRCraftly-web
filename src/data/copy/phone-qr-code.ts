import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the phone-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a Phone QR Code',
    description: 'Make a code that opens the dialler with your number.',
    steps: [
      { name: 'Enter the number', text: 'Type the number people should call, with its country code.' },
      { name: 'Style it', text: 'Pick colours and shapes if you like.' },
      { name: 'Download it', text: 'Save the code for print or screens.' },
    ],
  },
  faqs: [
    {
      question: 'Does scanning start the call?',
      answer:
        'No. The phone shows the number and the person decides whether to call.',
    },
    {
      question: 'Should I include the country code?',
      answer:
        'Yes, if anyone might scan it from abroad. Start with + and the country code, such as +1 for the US or +44 for the UK.',
    },
    NEVER_EXPIRES,
  ],
};
