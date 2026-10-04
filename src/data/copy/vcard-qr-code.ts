import type { ToolCopy } from './types';
import { NEVER_EXPIRES, staysInBrowser } from './shared';

/** The how-to steps and FAQs of the vcard-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
      "name": "How to Create a vCard QR Code",
      "description": "Create a digital business card that can be scanned to save contact info.",
      "steps": [
        {
          "name": "Enter Contact Info",
          "text": "Fill in your name, phone, email, and other contact details."
        },
        {
          "name": "Customize",
          "text": "Add your logo or choose colors to match your brand."
        },
        {
          "name": "Download",
          "text": "Download the QR code for your business cards."
        }
      ]
    },
  faqs: [
    {
      question: 'What happens when someone scans a vCard QR code?',
      answer:
        'Their phone shows your contact card and offers to save it, with your name, phone number, email address, company, job title, website and address already filled in. No app or internet connection is needed.',
    },
    {
      question: 'Does a vCard QR code work on iPhone and Android?',
      answer:
        'Yes. QRCraftly writes a standard vCard 3.0 contact, which the built-in camera apps on iPhone and Android can read and save to the address book.',
    },
    {
      question: 'Why is my vCard QR code so dense?',
      answer:
        'Every field is stored inside the code, so a long address or many filled-in fields make it bigger and harder to scan. Leave out fields you do not need, and print business-card codes at least 2 cm (0.8 in) wide.',
    },
    staysInBrowser('my contact information'),
    NEVER_EXPIRES,
  ],
};
