import type { ToolCopy } from './types';
import { NEVER_EXPIRES, staysInBrowser } from './shared';

/** The how-to steps and FAQs of the phone-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Create a Phone QR Code",
      "description": "Create a QR code that prompts the user to dial a number.",
      "steps": [
        {
          "name": "Enter Number",
          "text": "Input the phone number you want people to call."
        },
        {
          "name": "Customize",
          "text": "Choose colors and styles for your QR code."
        },
        {
          "name": "Download",
          "text": "Download the image for print or digital use."
        }
      ]
    },
  faqs: [
    {
      question: 'What happens when someone scans a phone QR code?',
      answer:
        'Their phone shows your number and offers to call it. The call is not started automatically; they confirm it first.',
    },
    {
      question: 'Should I include the country code?',
      answer:
        'Yes, if people might scan the code from another country or on a roaming phone. Start the number with + and the country code, for example +1 for the United States or +44 for the United Kingdom.',
    },
    staysInBrowser('the phone number I enter'),
    NEVER_EXPIRES,
  ],
};
