import type { ToolCopy } from './types';
import { NEVER_EXPIRES, staysInBrowser } from './shared';

/** The how-to steps and FAQs of the sms-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Create an SMS QR Code",
      "description": "Generate a QR code that opens a drafted text message.",
      "steps": [
        {
          "name": "Enter Details",
          "text": "Fill in the recipient number and the message text."
        },
        {
          "name": "Customize",
          "text": "Select a pattern and color for your QR code."
        },
        {
          "name": "Download",
          "text": "Download the image and share it."
        }
      ]
    },
  faqs: [
    {
      question: 'What happens when someone scans an SMS QR code?',
      answer:
        'Their phone opens its messaging app with a text to your number, and your message already typed. Nothing is sent until they tap Send.',
    },
    {
      question: 'What are SMS QR codes used for?',
      answer:
        'Common uses are text-to-join lists, support and booking requests, voting and competitions, and letting customers report a problem by text without typing a number.',
    },
    staysInBrowser('the phone number I enter'),
    NEVER_EXPIRES,
  ],
};
