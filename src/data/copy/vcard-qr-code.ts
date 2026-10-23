import type { ToolCopy } from './types';
import { NEVER_EXPIRES } from './shared';

/** The how-to steps and FAQs of the vcard-qr-code page. */
export const copy: ToolCopy = {
  howTo: {
    name: 'How to Create a vCard QR Code',
    description: 'Make a contact card people can save with one scan.',
    steps: [
      { name: 'Enter details', text: 'Fill in fields you want to share. Fewer fields keep the code smaller.' },
      { name: 'Style it', text: 'Add your custom colors or logo.' },
      { name: 'Download it', text: 'Save the code for your business card, badge or slides.' },
    ],
  },
  faqs: [
    {
      question: 'Does a vCard QR code work on iPhone and Android?',
      answer:
        'Yes. vCard 3.0 is supported natively on iOS and Android. You can also pick vCard 4.0, 2.1 or MECARD format.',
    },
    {
      question: 'Why is my vCard QR code so dense?',
      answer:
        'Every field is stored inside the code, so more details make it denser. Leave out unused fields, and print business-card codes at least 2 cm wide.',
    },
    NEVER_EXPIRES,
  ],
};

