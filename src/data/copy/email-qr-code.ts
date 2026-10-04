import type { ToolCopy } from './types';
import { NEVER_EXPIRES, staysInBrowser } from './shared';

/** The how-to steps and FAQs of the email-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Create an Email QR Code",
      "description": "Generate a QR code that opens a drafted email.",
      "steps": [
        {
          "name": "Enter Details",
          "text": "Fill in the recipient, subject, and body of the email."
        },
        {
          "name": "Customize",
          "text": "Choose a style and color for your QR code."
        },
        {
          "name": "Download",
          "text": "Save the QR code and print it on business cards or flyers."
        }
      ]
    },
  faqs: [
    {
      question: 'What happens when someone scans an email QR code?',
      answer:
        'Their phone opens its email app with a new message already addressed, with your subject line and message text filled in. They only have to tap Send.',
    },
    {
      question: 'Can I leave the subject or message empty?',
      answer:
        'Yes. Only the email address is needed. Pre-filling the subject makes it easier to sort replies, for example "Feedback: spring menu" or "Support request".',
    },
    staysInBrowser('the email address I enter'),
    NEVER_EXPIRES,
  ],
};
