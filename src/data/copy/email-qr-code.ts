import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the email-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create an Email QR Code',
    description: 'Make a code that opens a ready-to-send email.',
    steps: [
      { name: 'Enter the email', text: 'Type the address, and a subject and message if you want them.' },
      { name: 'Style it', text: 'Pick colours and shapes if you like.' },
      { name: 'Download it', text: 'Save the code for a receipt, poster or product.' },
    ],
  },
  faqs: [
    {
      question: 'Can I leave the subject or message empty?',
      answer:
        'Yes. Only the address is needed. A subject such as “Feedback: spring menu” makes replies easier to sort.',
    },
    {
      question: 'Can I add CC and BCC addresses?',
      answer:
        'Yes. Most mail apps fill them in, but a few ignore them, so test the code with the apps your readers use.',
    },
    NEVER_EXPIRES,
  ],
};
