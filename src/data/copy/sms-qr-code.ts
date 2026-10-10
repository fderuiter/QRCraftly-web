import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the sms-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create an SMS QR Code',
    description: 'Make a code that opens a text message ready to send.',
    steps: [
      { name: 'Enter the number and message', text: 'Type the number that should receive the text and the words to send.' },
      { name: 'Style it', text: 'Pick colours and shapes if you like.' },
      { name: 'Download it', text: 'Save the code and print or share it.' },
    ],
  },
  faqs: [
    {
      question: 'What are SMS QR codes used for?',
      answer:
        'Text-to-join lists, booking and support requests, polls, and letting people report a problem without typing a number.',
    },
    {
      question: 'Does the person pay to send the text?',
      answer:
        'They pay whatever their own carrier charges for a normal text. QRCraftly never sends the message for them.',
    },
    NEVER_EXPIRES,
  ],
};
